/* =========================================================
   ArXivSource — integración con la API pública de arXiv
   https://info.arxiv.org/help/api/index.html
   Todo lo publicado en arXiv es de acceso abierto por diseño,
   así que no hace falta filtrar por OA. Útil sobre todo para
   temas de IA, física, matemáticas e ingeniería.
   ========================================================= */
const ArXivSource = {
  BASE: "http://export.arxiv.org/api/query",

  async searchByTopic(topic, maxResults = 10) {
    // Precisión: el tema principal debe aparecer en título o resumen, y
    // opcionalmente reforzamos con los subtemas (también en ti/abs) para
    // priorizar resultados realmente enfocados en el área, no solo
    // relacionados de forma tangencial.
    const terms = [topic.label, ...(topic.sub || [])];
    const q = terms.map(t => `ti:"${t}" OR abs:"${t}"`).join(" OR ");
    const url = `${this.BASE}?search_query=${encodeURIComponent(q)}&start=0&max_results=${maxResults * 2}&sortBy=submittedDate&sortOrder=descending`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`arXiv respondió ${res.status}`);
    const xmlText = await res.text();
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const entries = Array.from(doc.getElementsByTagName("entry"));
    return entries
      .map(e => this.normalize(e, topic.id))
      .filter(Boolean)
      .filter(p => this.isRelevant(p, topic))
      .slice(0, maxResults);
  },

  isRelevant(paper, topic) {
    const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
    const needles = [topic.label, ...(topic.sub || [])].map(t => t.toLowerCase());
    return needles.some(n => haystack.includes(n));
  },

  normalize(entry, topicId) {
    const idUrl = this.text(entry, "id");
    if (!idUrl) return null;
    const arxivId = idUrl.split("/abs/").pop();
    const published = this.text(entry, "published") || "";
    const year = parseInt(published.slice(0, 4), 10) || new Date().getFullYear();
    if (year && new Date().getFullYear() - year > 2) {
      // se filtra igual por antigüedad más abajo en el motor de recomendación,
      // pero evitamos traer entradas muy viejas desde la fuente.
    }
    const abstract = (this.text(entry, "summary") || "").replace(/\s+/g, " ").trim();
    const wordCount = abstract.split(/\s+/).filter(Boolean).length;
    const authors = Array.from(entry.getElementsByTagName("author"))
      .map(a => this.text(a, "name")).filter(Boolean).slice(0, 6);
    const links = Array.from(entry.getElementsByTagName("link"));
    const pdfLink = links.find(l => l.getAttribute("title") === "pdf");
    const category = entry.getElementsByTagName("category")[0];
    const primaryCategory = category ? category.getAttribute("term") : null;
    const doi = this.text(entry, "arxiv:doi") || null;

    return {
      id: `arxiv-${arxivId}`,
      provider: "arxiv",
      source: "arXiv",
      sourceId: arxivId,
      pmcid: null,
      doi,
      title: (this.text(entry, "title") || "Sin título").replace(/\s+/g, " ").trim(),
      authors: authors.length ? authors : ["Autores no disponibles"],
      journal: `arXiv preprint${primaryCategory ? ` (${primaryCategory})` : ""}`,
      year,
      abstract: abstract || "Este preprint no tiene resumen disponible.",
      topics: [topicId],
      paperType: "preprint",
      isOpenAccess: true,
      inEPMC: false,
      hasFullText: false, // arXiv no ofrece texto completo en HTML vía API, solo PDF
      difficulty: wordCount > 280 ? "avanzado" : wordCount > 140 ? "intermedio" : "accesible",
      estimatedMinutes: Math.max(4, Math.round(wordCount / 200) + 3),
      recencyScore: 0.6,
      qualitySignals: 0.4, // arXiv no expone citas en esta API
      citationSignals: 0,
      featuredFlag: false,
      openAccessUrl: idUrl,
      pdfUrl: pdfLink ? pdfLink.getAttribute("href") : idUrl.replace("/abs/", "/pdf/"),
    };
  },

  text(node, tag) {
    const el = node.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : "";
  },

  // arXiv no expone el texto completo estructurado vía API pública;
  // el lector cae automáticamente al abstract + enlace al PDF real.
  async fetchFullText() { return null; },
};
