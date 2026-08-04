/* =========================================================
   Catalog — combina varias fuentes reales de papers de acceso
   abierto (Europe PMC, arXiv, Semantic Scholar) en un único
   catálogo, según qué fuentes tenga activadas el usuario en
   Ajustes. Cachea el resultado combinado en localStorage.
   ========================================================= */
const Catalog = {
  CACHE_KEY: "paperstreak:catalog-cache:v1",
  CACHE_TTL_HOURS: 12,

  REGISTRY: {
    europepmc: { label: "Europe PMC", impl: () => window.EuropePMC },
    arxiv: { label: "arXiv", impl: () => window.ArXivSource },
    semanticscholar: { label: "Semantic Scholar", impl: () => window.SemanticScholarSource },
  },

  activeSourceKeys(sourcesPrefs) {
    const prefs = sourcesPrefs || { europepmc: true, arxiv: true, semanticscholar: true };
    return Object.keys(this.REGISTRY).filter(k => prefs[k] !== false);
  },

  async build(topicsArr, mainTopicIds, sourcesPrefs, subTopicsArr) {
    const topicIds = (mainTopicIds && mainTopicIds.length ? mainTopicIds : topicsArr.slice(0, 3).map(t => t.id));
    const sourceKeys = this.activeSourceKeys(sourcesPrefs);
    const subTopics = subTopicsArr || [];

    const cached = this.readCache();
    const sameTopics = cached && cached.topicIds.slice().sort().join(",") === topicIds.slice().sort().join(",");
    const sameSources = cached && cached.sourceKeys.slice().sort().join(",") === sourceKeys.slice().sort().join(",");
    const sameSubTopics = cached && (cached.subTopics || []).slice().sort().join(",") === subTopics.slice().sort().join(",");
    const fresh = cached && (Date.now() - cached.savedAt) < this.CACHE_TTL_HOURS * 3600 * 1000;
    if (cached && sameTopics && sameSources && sameSubTopics && fresh) return cached.papers;

    // Si el usuario marcó subáreas específicas dentro de un tema, restringimos
    // la búsqueda de ese tema a esas subáreas (más preciso); si no marcó
    // ninguna, seguimos usando el tema completo con todos sus subtemas.
    const chosenTopics = topicsArr
      .filter(t => topicIds.includes(t.id))
      .map(t => {
        const picked = subTopics
          .filter(s => s.startsWith(`${t.id}::`))
          .map(s => s.slice(t.id.length + 2));
        return picked.length ? { ...t, sub: picked } : t;
      });

    const jobs = [];
    sourceKeys.forEach(key => {
      const source = this.REGISTRY[key].impl();
      if (!source) return; // el script de esa fuente no cargó
      chosenTopics.forEach(topic => {
        jobs.push(
          source.searchByTopic(topic).catch(err => {
            console.warn(`Catalog: fallo en ${this.REGISTRY[key].label} para el tema ${topic.id}`, err);
            return [];
          })
        );
      });
    });

    const batches = await Promise.all(jobs);
    const seenIds = new Set();
    const seenDois = new Set();
    const papers = [];
    batches.flat().forEach(p => {
      if (!p) return;
      if (seenIds.has(p.id)) return;
      if (p.doi && seenDois.has(p.doi)) return; // mismo paper indexado en dos fuentes
      seenIds.add(p.id);
      if (p.doi) seenDois.add(p.doi);
      papers.push(p);
    });

    this.writeCache({ savedAt: Date.now(), topicIds, sourceKeys, subTopics, papers });
    return papers;
  },

  // Despacha la búsqueda de texto completo a la fuente correcta del paper.
  async fetchFullText(paper) {
    const entry = this.REGISTRY[paper.provider];
    const source = entry ? entry.impl() : null;
    if (!source || typeof source.fetchFullText !== "function") return null;
    return source.fetchFullText(paper);
  },

  readCache() {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  writeCache(obj) {
    try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(obj)); } catch (e) {}
  },
  clearCache() {
    localStorage.removeItem(this.CACHE_KEY);
  },
};
