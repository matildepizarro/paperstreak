/* =========================================================
   EuropePMC — integración real con la API pública de Europe PMC
   https://europepmc.org/RestfulWebService
   Reemplaza el catálogo mock por artículos de acceso abierto
   reales, verificables, y permite leer el texto completo
   in-app (no solo un resumen) cuando Europe PMC lo ofrece.
   ========================================================= */
const EuropePMC = {
  BASE: "https://www.ebi.ac.uk/europepmc/webservices/rest",
  CACHE_KEY: "paperstreak:epmc-cache:v1",

  async searchByTopic(topic, pageSize = 15) {
    // Vamos ampliando la consulta en pasos hasta encontrar algo. El primer
    // intento es el más preciso (título/resumen, acceso abierto, reciente);
    // si un tema no trae resultados así, es mejor mostrar algo un poco menos
    // exacto que no mostrar nada.
    const termsQuoted = [topic.label, ...(topic.sub || [])]
      .map(t => `TITLE:"${t}" OR ABSTRACT:"${t}"`)
      .join(" OR ");
    const termsFree = [topic.label, ...(topic.sub || [])].join(" OR ");

    const attempts = [
      { query: `(${termsQuoted}) AND OPEN_ACCESS:Y AND IN_EPMC:Y AND (FIRST_PDATE:[${this.dateFrom()} TO ${this.dateTo()}])`, strictRelevance: true },
      { query: `(${termsQuoted}) AND OPEN_ACCESS:Y`, strictRelevance: true },
      { query: `(${termsQuoted})`, strictRelevance: true },
      { query: `(${termsFree})`, strictRelevance: false },
    ];

    for (const attempt of attempts) {
      try {
        const url = `${this.BASE}/search?query=${encodeURIComponent(attempt.query)}&format=json&resultType=core&pageSize=${pageSize}&sort=CITED%20desc`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`Europe PMC respondió ${res.status}`);
        const data = await res.json();
        const results = (data.resultList && data.resultList.result) || [];
        const normalized = results.map(r => this.normalize(r, topic.id)).filter(Boolean);
        const filtered = attempt.strictRelevance ? normalized.filter(p => this.isRelevant(p, topic)) : normalized;
        if (filtered.length > 0) return filtered;
      } catch (err) {
        console.warn("Europe PMC: intento falló para", topic.id, err);
      }
    }
    return [];
  },

  /* Segundo filtro de precisión en el cliente: exige que el título o el
     resumen contengan realmente el tema o alguno de sus subtemas, en vez
     de confiar únicamente en el ranking del buscador. */
  isRelevant(paper, topic) {
    const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
    const needles = [topic.label, ...(topic.sub || [])].map(t => t.toLowerCase());
    return needles.some(n => haystack.includes(n));
  },

  dateFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 18);
    return d.toISOString().slice(0, 10);
  },
  dateTo() { return new Date().toISOString().slice(0, 10); },

  /* ---------- Normalización al esquema interno de PaperStreak ---------- */
  normalize(r, topicId) {
    if (!r.id || !r.source) return null;
    const abstract = this.stripTags(r.abstractText) || "Este artículo no tiene resumen disponible en Europe PMC.";
    const wordCount = abstract.split(/\s+/).filter(Boolean).length;
    const citedByCount = r.citedByCount || 0;
    const isPmc = r.source === "PMC" || (r.fullTextIdList && r.fullTextIdList.fullTextId && r.fullTextIdList.fullTextId.includes("PMC"));
    const pmcid = r.pmcid || (isPmc ? r.id : null);

    const oaUrl = this.pickUrl(r, "Open access") ||
      (pmcid ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/, "")}` : `https://europepmc.org/article/${r.source}/${r.id}`);
    const pdfUrl = this.pickUrl(r, "pdf") || (pmcid ? `https://europepmc.org/articles/${pmcid}/pdf` : oaUrl);

    return {
      id: `${r.source}-${r.id}`,
      provider: "europepmc",
      source: r.source,
      sourceId: r.id,
      pmcid,
      doi: r.doi || null,
      title: this.stripTags(r.title) || "Sin título",
      authors: (r.authorString || "Autores no disponibles").split(", ").slice(0, 6),
      journal: r.journalTitle || (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || "Revista no especificada",
      year: parseInt(r.pubYear, 10) || new Date().getFullYear(),
      abstract,
      topics: [topicId],
      paperType: /review/i.test(r.pubType || "") ? "revision" : "original",
      isOpenAccess: r.isOpenAccess === "Y",
      inEPMC: r.inEPMC === "Y",
      hasFullText: r.inEPMC === "Y" && r.source === "PMC",
      difficulty: wordCount > 280 ? "avanzado" : wordCount > 140 ? "intermedio" : "accesible",
      estimatedMinutes: Math.max(4, Math.round(wordCount / 200) + 3),
      recencyScore: 0.5,
      qualitySignals: Math.min(1, citedByCount / 50),
      citationSignals: citedByCount,
      featuredFlag: citedByCount > 20,
      openAccessUrl: oaUrl,
      pdfUrl,
    };
  },

  pickUrl(r, availabilityOrStyle) {
    const list = r.fullTextUrlList && r.fullTextUrlList.fullTextUrl;
    if (!list) return null;
    const match = list.find(u => u.availability === availabilityOrStyle || u.documentStyle === availabilityOrStyle);
    return match ? match.url : null;
  },

  stripTags(s) {
    if (!s) return "";
    return s.replace(/<[^>]+>/g, "").trim();
  },

  /* ---------- Texto completo real (no resumen) ---------- */
  async fetchFullText(paper) {
    if (!paper.hasFullText || !paper.pmcid) return null;
    try {
      const res = await fetch(`${this.BASE}/PMC/${paper.pmcid}/fullTextXML`);
      if (!res.ok) return null;
      const xml = await res.text();
      return this.xmlToHtml(xml);
    } catch (e) {
      console.warn("EuropePMC: no se pudo obtener el texto completo", e);
      return null;
    }
  },

  xmlToHtml(xmlText) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(xmlText, "text/xml");
    } catch (e) { return null; }
    const body = doc.querySelector("body");
    if (!body) return null;

    const walk = (node, depth) => {
      let out = "";
      node.childNodes.forEach(child => {
        if (child.nodeType !== 1) return;
        const tag = child.tagName.toLowerCase();
        if (tag === "sec") {
          out += walk(child, depth + 1);
        } else if (tag === "title") {
          const level = Math.min(6, depth + 2);
          out += `<h${level}>${this.escapeHtml(child.textContent.trim())}</h${level}>`;
        } else if (tag === "p") {
          out += `<p>${this.escapeHtml(child.textContent.trim())}</p>`;
        } else if (tag === "list") {
          out += `<ul>${Array.from(child.querySelectorAll("list-item")).map(li => `<li>${this.escapeHtml(li.textContent.trim())}</li>`).join("")}</ul>`;
        }
      });
      return out;
    };

    const html = walk(body, 0);
    return html.trim() ? html : null;
  },

  escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  // Se mantiene solo para que "Actualizar catálogo ahora" en Ajustes pueda
  // limpiar cualquier resto de una versión anterior que sí usaba esta caché
  // por separado. El catálogo combinado real vive en Catalog (sources.js).
  clearCache() {
    localStorage.removeItem(this.CACHE_KEY);
  },
};
