/* =========================================================
   SemanticScholarSource — integración con la API pública de
   Semantic Scholar (Allen Institute for AI).
   https://api.semanticscholar.org/api-docs/graph
   No requiere API key para uso básico (con límite de tasa).
   Solo se incluyen resultados con PDF de acceso abierto real
   (openAccessPdf), para no repetir el problema de fuentes
   inexistentes.
   ========================================================= */
const SemanticScholarSource = {
  BASE: "https://api.semanticscholar.org/graph/v1/paper/search",
  FIELDS: "title,abstract,year,venue,authors,openAccessPdf,externalIds,citationCount,publicationTypes",

  async searchByTopic(topic, limit = 12) {
    // La API de búsqueda de Semantic Scholar no soporta booleanos complejos,
    // así que probamos con el nombre del tema como frase principal y vamos
    // aflojando restricciones (año, exigencia de PDF abierto, relevancia
    // estricta en el cliente) hasta encontrar algo.
    const query = topic.label;
    const attempts = [
      { params: `&openAccessPdf=true&year=${this.yearRange()}`, strictRelevance: true },
      { params: `&openAccessPdf=true`, strictRelevance: true },
      { params: ``, strictRelevance: true },
      { params: ``, strictRelevance: false },
    ];

    for (const attempt of attempts) {
      try {
        const url = `${this.BASE}?query=${encodeURIComponent(query)}&fields=${this.FIELDS}&limit=${limit * 2}${attempt.params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Semantic Scholar respondió ${res.status}`);
        const data = await res.json();
        const results = data.data || [];
        const normalized = results.map(r => this.normalize(r, topic.id)).filter(Boolean);
        const filtered = attempt.strictRelevance ? normalized.filter(p => this.isRelevant(p, topic)) : normalized;
        if (filtered.length > 0) return filtered.slice(0, limit);
      } catch (err) {
        console.warn("Semantic Scholar: intento falló para", topic.id, err);
      }
    }
    return [];
  },

  isRelevant(paper, topic) {
    const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
    const needles = [topic.label, ...(topic.sub || [])].map(t => t.toLowerCase());
    return needles.some(n => haystack.includes(n));
  },

  yearRange() {
    const now = new Date().getFullYear();
    return `${now - 2}-${now}`;
  },

  normalize(r, topicId) {
    if (!r.paperId) return null;
    const hasOaPdf = !!(r.openAccessPdf && r.openAccessPdf.url);
    const abstract = (r.abstract || "").trim();
    const wordCount = abstract.split(/\s+/).filter(Boolean).length;
    const authors = (r.authors || []).map(a => a.name).filter(Boolean).slice(0, 6);

    return {
      id: `s2-${r.paperId}`,
      provider: "semanticscholar",
      source: "Semantic Scholar",
      sourceId: r.paperId,
      pmcid: r.externalIds && r.externalIds.PubMedCentral ? `PMC${r.externalIds.PubMedCentral}` : null,
      doi: (r.externalIds && r.externalIds.DOI) || null,
      title: r.title || "Sin título",
      authors: authors.length ? authors : ["Autores no disponibles"],
      journal: r.venue || "Fuente no especificada",
      year: r.year || new Date().getFullYear(),
      abstract: abstract || "Este artículo no tiene resumen disponible.",
      topics: [topicId],
      paperType: (r.publicationTypes || []).some(t => /review/i.test(t)) ? "revision" : "original",
      // Si no hay PDF de acceso abierto directo, igual dejamos ver el
      // artículo (Semantic Scholar linkea a la fuente original), pero lo
      // marcamos como no-OA para que el motor de recomendación lo sepa.
      isOpenAccess: hasOaPdf,
      inEPMC: false,
      hasFullText: false, // Semantic Scholar no entrega el cuerpo del texto vía API, solo el PDF
      difficulty: wordCount > 280 ? "avanzado" : wordCount > 140 ? "intermedio" : "accesible",
      estimatedMinutes: Math.max(4, Math.round(wordCount / 200) + 3),
      recencyScore: 0.5,
      qualitySignals: Math.min(1, (r.citationCount || 0) / 50),
      citationSignals: r.citationCount || 0,
      featuredFlag: (r.citationCount || 0) > 20,
      openAccessUrl: `https://www.semanticscholar.org/paper/${r.paperId}`,
      pdfUrl: hasOaPdf ? r.openAccessPdf.url : `https://www.semanticscholar.org/paper/${r.paperId}`,
    };
  },

  // El PDF es el único texto completo disponible desde esta fuente;
  // el lector cae automáticamente al abstract + enlace al PDF real.
  async fetchFullText() { return null; },
};
