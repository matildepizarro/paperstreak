/* =========================================================
   Catalog — combina varias fuentes reales de papers de acceso
   abierto (Europe PMC, arXiv, Semantic Scholar) en un único
   catálogo, según qué fuentes tenga activadas el usuario en
   Ajustes. Cachea el resultado combinado en localStorage.

   Diseño a prueba de fallos, de más a menos preferido:
   1) Resultados en vivo de las fuentes activas para tus temas.
   2) Si eso viene vacío, una búsqueda amplia/genérica en las
      mismas fuentes (ver cada archivo *.js de fuente).
   3) Si AÚN así no hay nada (sin internet, API caída, dominio
      bloqueado por el navegador, etc.), un pequeño set local
      de papers reales y verificados que viaja con la app y no
      depende de ninguna conexión. Así la pantalla de "no
      encontramos papers" nunca debería aparecer, y cuando se
      usa este último recurso se lo decimos claramente al
      usuario (ver Catalog.lastUsedOfflineFallback).
   ========================================================= */
const Catalog = {
  CACHE_KEY: "paperstreak:catalog-cache:v1",
  CACHE_TTL_HOURS: 12,

  // Se llena en cada build() con lo que falló, para poder mostrarlo en la
  // interfaz (Ajustes) en vez de fallar en silencio.
  lastDiagnostics: [],
  lastUsedOfflineFallback: false,

  REGISTRY: {
    europepmc: { label: "Europe PMC", impl: () => window.EuropePMC },
    arxiv: { label: "arXiv", impl: () => window.ArXivSource },
    semanticscholar: { label: "Semantic Scholar", impl: () => window.SemanticScholarSource },
  },

  // Pequeño set de respaldo 100% real y verificado a mano (no inventado).
  // Se usa SOLO si las 3 fuentes en vivo fallan por completo. topics: []
  // hace que nunca quede excluido por ningún filtro de tema.
  OFFLINE_FALLBACK: [
    {
      id: "offline-1", provider: "offline", source: "Europe PMC (respaldo local)",
      title: "Effectiveness of Group Voice Therapy in Teachers with Hyperfunctional Voice Disorder",
      authors: ["Autores varios"], journal: "Journal of Clinical Medicine (MDPI, acceso abierto)", year: 2025,
      abstract: "Estudio que evalúa si la terapia de voz grupal mejora el comportamiento vocal y la calidad de voz en docentes con un trastorno de voz por esfuerzo excesivo, comparando mediciones antes y después del tratamiento.",
      topics: [], subtopics: [], paperType: "estudio original", difficulty: "intermedio", estimatedMinutes: 14,
      isOpenAccess: true, inEPMC: true, hasFullText: true,
      openAccessUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12840110/", pdfUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12840110/",
      whyItMatters: "Evidencia reciente y de acceso abierto sobre una intervención concreta de terapia vocal.",
    },
    {
      id: "offline-2", provider: "offline", source: "Europe PMC (respaldo local)",
      title: "Prevalence and Risk Factors of Voice Disorders Among Teachers in Saudi Arabia",
      authors: ["Alharbi N.S.", "et al."], journal: "Cureus (acceso abierto)", year: 2024,
      abstract: "Encuesta que mide qué tan frecuentes son los problemas de voz en profesores y qué factores de su entorno laboral se asocian a un mayor riesgo.",
      topics: [], subtopics: [], paperType: "estudio original", difficulty: "accesible", estimatedMinutes: 10,
      isOpenAccess: true, inEPMC: true, hasFullText: true,
      openAccessUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11026995/", pdfUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11026995/",
      whyItMatters: "Datos actuales y accesibles sobre salud vocal ocupacional.",
    },
    {
      id: "offline-3", provider: "offline", source: "arXiv (respaldo local)",
      title: "Open-world machine learning: A review and new outlooks",
      authors: ["Zhu F.", "et al."], journal: "arXiv (preprint, acceso abierto)", year: 2024,
      abstract: "Revisión sobre cómo hacer que los modelos de machine learning sigan funcionando bien cuando el mundo real no se comporta como los datos de entrenamiento: detectar lo desconocido, descubrir novedades y seguir aprendiendo con el tiempo.",
      topics: [], subtopics: [], paperType: "revision", difficulty: "avanzado", estimatedMinutes: 20,
      isOpenAccess: true, inEPMC: false, hasFullText: true,
      openAccessUrl: "https://arxiv.org/abs/2403.01759", pdfUrl: "https://arxiv.org/pdf/2403.01759",
      whyItMatters: "Panorama amplio y actual de un problema central en IA aplicada.",
    },
    {
      id: "offline-4", provider: "offline", source: "PMC (respaldo local)",
      title: "Occupational voice is a work in progress: active risk management, habilitation and rehabilitation",
      authors: ["Autores varios"], journal: "PMC (acceso abierto)", year: 2019,
      abstract: "Revisión de la literatura reciente sobre el uso profesional de la voz y cómo prevenir, manejar y rehabilitar los trastornos de voz asociados al trabajo.",
      topics: [], subtopics: [], paperType: "revision", difficulty: "intermedio", estimatedMinutes: 16,
      isOpenAccess: true, inEPMC: true, hasFullText: true,
      openAccessUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6867679/", pdfUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6867679/",
      whyItMatters: "Buen punto de entrada para entender el estado actual de la salud vocal ocupacional.",
    },
  ],

  activeSourceKeys(sourcesPrefs) {
    const prefs = sourcesPrefs || { europepmc: true, arxiv: true, semanticscholar: true };
    return Object.keys(this.REGISTRY).filter(k => prefs[k] !== false);
  },

  async build(topicsArr, mainTopicIds, sourcesPrefs, subTopicsArr) {
    this.lastDiagnostics = [];
    this.lastUsedOfflineFallback = false;

    const topicIds = (mainTopicIds && mainTopicIds.length ? mainTopicIds : topicsArr.slice(0, 3).map(t => t.id));
    const sourceKeys = this.activeSourceKeys(sourcesPrefs);
    const subTopics = subTopicsArr || [];

    const cached = this.readCache();
    const sameTopics = cached && cached.topicIds.slice().sort().join(",") === topicIds.slice().sort().join(",");
    const sameSources = cached && cached.sourceKeys.slice().sort().join(",") === sourceKeys.slice().sort().join(",");
    const sameSubTopics = cached && (cached.subTopics || []).slice().sort().join(",") === subTopics.slice().sort().join(",");
    const fresh = cached && (Date.now() - cached.savedAt) < this.CACHE_TTL_HOURS * 3600 * 1000;
    if (cached && sameTopics && sameSources && sameSubTopics && fresh) return cached.papers;

    if (sourceKeys.length === 0) {
      this.lastDiagnostics.push("No hay ninguna fuente activada en Ajustes.");
      this.lastUsedOfflineFallback = true;
      return this.OFFLINE_FALLBACK;
    }

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
      if (!source) {
        this.lastDiagnostics.push(`${this.REGISTRY[key].label}: el script de esta fuente no cargó en la página.`);
        return;
      }
      chosenTopics.forEach(topic => {
        jobs.push(
          source.searchByTopic(topic).catch(err => {
            this.lastDiagnostics.push(`${this.REGISTRY[key].label} (${topic.label}): ${err && err.message ? err.message : "error de red"}`);
            return [];
          })
        );
      });
    });

    let flat = (await Promise.all(jobs)).flat();

    // Paso 2: si nada trajo resultados, intentamos una búsqueda amplia y
    // genérica en las mismas fuentes (cada fuente ya sabe ir aflojando sus
    // propios filtros; aquí solo cambiamos el término de búsqueda).
    if (flat.length === 0) {
      const genericTopics = [
        { id: (chosenTopics[0] && chosenTopics[0].id) || "general", label: "science", sub: [] },
        { id: (chosenTopics[0] && chosenTopics[0].id) || "general", label: "research", sub: [] },
      ];
      const fallbackJobs = [];
      sourceKeys.forEach(key => {
        const source = this.REGISTRY[key].impl();
        if (!source) return;
        genericTopics.forEach(topic => {
          fallbackJobs.push(
            source.searchByTopic(topic).catch(err => {
              this.lastDiagnostics.push(`${this.REGISTRY[key].label} (búsqueda genérica): ${err && err.message ? err.message : "error de red"}`);
              return [];
            })
          );
        });
      });
      flat = (await Promise.all(fallbackJobs)).flat();
    }

    // Paso 3: red de seguridad final, sin depender de internet en absoluto.
    if (flat.length === 0) {
      this.lastUsedOfflineFallback = true;
      this.writeCache({ savedAt: Date.now(), topicIds, sourceKeys, subTopics, papers: this.OFFLINE_FALLBACK });
      return this.OFFLINE_FALLBACK;
    }

    const seenIds = new Set();
    const seenDois = new Set();
    const papers = [];
    flat.forEach(p => {
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
