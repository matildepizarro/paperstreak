/* =========================================================
   PaperStreak — app.js
   Todo el estado vive en localStorage. Sin backend.
   ========================================================= */

const STORAGE_PREFIX = "paperstreak:profile:v1";
const AUTH_KEY = "paperstreak:auth:v1";
const THEME_KEY = "paperstreak:theme";

/* ---------------------------------------------------------
   Autenticación con Google (Google Identity Services)
   No hay backend: el ID token se decodifica en el cliente solo
   para leer nombre/correo/foto y así separar perfiles locales
   por cuenta en el mismo navegador. Esto NO es una verificación
   criptográfica segura de identidad (no hay servidor que la
   valide); para eso haría falta un backend que verifique la
   firma del token contra Google.
   --------------------------------------------------------- */
const Auth = {
  current: null, // { sub, name, email, picture } | null (null = invitado)

  load() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      this.current = raw ? JSON.parse(raw) : null;
    } catch (e) {
      this.current = null;
    }
    return this.current;
  },

  persist() {
    if (this.current) localStorage.setItem(AUTH_KEY, JSON.stringify(this.current));
    else localStorage.removeItem(AUTH_KEY);
  },

  decodeJwt(token) {
    try {
      const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
      );
      return JSON.parse(json);
    } catch (e) {
      console.error("No se pudo decodificar el token de Google", e);
      return null;
    }
  },

  handleCredentialResponse(response) {
    const payload = this.decodeJwt(response.credential);
    if (!payload) return;
    this.current = {
      sub: payload.sub,
      name: payload.name || payload.email,
      email: payload.email,
      picture: payload.picture || "",
    };
    this.persist();
    onAuthChanged();
  },

  loginAsGuest() {
    this.current = { sub: "guest", name: "Invitado", email: "", picture: "", isGuest: true };
    this.persist();
    onAuthChanged();
  },

  logout() {
    this.current = null;
    this.persist();
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    onAuthChanged();
  },

  storageKey() {
    const id = this.current ? this.current.sub : "guest";
    return `${STORAGE_PREFIX}:${id}`;
  },

  isReady() {
    return !!(window.PAPERSTREAK_CONFIG && window.PAPERSTREAK_CONFIG.GOOGLE_CLIENT_ID &&
      !window.PAPERSTREAK_CONFIG.GOOGLE_CLIENT_ID.startsWith("TU_"));
  },

  initGis() {
    if (!this.isReady() || !window.google || !google.accounts || !google.accounts.id) return;
    google.accounts.id.initialize({
      client_id: window.PAPERSTREAK_CONFIG.GOOGLE_CLIENT_ID,
      callback: (resp) => this.handleCredentialResponse(resp),
      auto_select: false,
    });
  },

  renderButton(elId) {
    if (!this.isReady() || !window.google || !google.accounts || !google.accounts.id) return false;
    const el = document.getElementById(elId);
    if (!el) return false;
    google.accounts.id.renderButton(el, {
      type: "standard", theme: "outline", size: "large", text: "signin_with",
      shape: "pill", logo_alignment: "left", width: 280,
    });
    return true;
  },
};

const ACHIEVEMENTS = [
  { id: "streak3", name: "3 días seguidos", emoji: "🔥", check: s => s.currentStreak >= 3 },
  { id: "streak7", name: "7 días seguidos", emoji: "🔥", check: s => s.currentStreak >= 7 },
  { id: "streak14", name: "14 días seguidos", emoji: "🔥", check: s => s.currentStreak >= 14 },
  { id: "read10", name: "10 papers leídos", emoji: "📚", check: s => s.papersRead.length >= 10 },
  { id: "sametopic5", name: "5 papers de un tema", emoji: "🎯", check: s => Object.values(s.topicMastery || {}).some(v => v.read >= 5) },
  { id: "xp1000", name: "1000 XP", emoji: "⭐", check: s => s.xp >= 1000 },
  { id: "weeks4", name: "4 semanas activas", emoji: "🗓️", check: s => (s.weeklyHistory || []).filter(w => w.count > 0).length >= 4 },
  { id: "perfectweek", name: "Semana perfecta", emoji: "🏆", check: s => (s.weeklyHistory || []).some(w => w.count >= 7) },
];

/* ---------------------------------------------------------
   Persistencia
   --------------------------------------------------------- */
const Store = {
  defaultProfile() {
    return {
      onboardingCompleted: false,
      interests: {
        mainTopics: [],
        subTopics: [],
        excludedTopics: [],
        favoriteAuthors: [],
        favoriteJournals: [],
        language: "es",
        preferredPaperTypes: [],
        readingLevel: "intermedio",
      },
      readingFormat: { dailyMinutes: 10, depth: "resumen extendido", lengthPreference: "mediano" },
      feedStyle: "destacado",
      stats: {
        xp: 0, level: 1, currentStreak: 0, maxStreak: 0,
        papersRead: [], papersSaved: [], papersSeen: [], papersPostponed: [],
        topicMastery: {}, weeklyHistory: [], achievements: [], lastAccessDate: null,
        notes: {}, quizResults: {},
      },
      settings: { theme: "light" },
      currentFeed: null, // { date, mainId, altIds }
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(Auth.storageKey());
      if (!raw) return this.defaultProfile();
      const parsed = JSON.parse(raw);
      return Object.assign(this.defaultProfile(), parsed);
    } catch (e) {
      console.error("Error leyendo perfil", e);
      return this.defaultProfile();
    }
  },
  save(profile) {
    localStorage.setItem(Auth.storageKey(), JSON.stringify(profile));
  },
  reset() {
    localStorage.removeItem(Auth.storageKey());
  },
  exportData() {
    const data = localStorage.getItem(Auth.storageKey()) || "{}";
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paperstreak-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  importData(jsonText) {
    const parsed = JSON.parse(jsonText);
    localStorage.setItem(Auth.storageKey(), JSON.stringify(parsed));
  },
};

/* ---------------------------------------------------------
   Estado global de la app
   --------------------------------------------------------- */
Auth.load();
let PROFILE = Store.load();
let PAPERS = [];
let TOPICS = [];
let currentRoute = "home";
let currentReadingPaper = null;
let readerNotesDraft = "";

function onAuthChanged() {
  PROFILE = Store.load();
  currentRoute = "home";
  render();
}

function persist() { Store.save(PROFILE); }

/* ---------------------------------------------------------
   Utilidades de fecha
   --------------------------------------------------------- */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function isoWeekKey(dateStr) {
  const d = new Date(dateStr);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

/* ---------------------------------------------------------
   Motor de recomendación
   --------------------------------------------------------- */
const RecommendationEngine = {
  /**
   * Calcula un score transparente para un paper dado el perfil.
   * Factores (pesos ajustables):
   *  - afinidad temática        0.30
   *  - recencia                 0.15
   *  - calidad/impacto          0.15
   *  - accesibilidad/dificultad 0.15
   *  - novedad vs historial     0.15
   *  - tipo de artículo pref.   0.10
   */
  weights: {
    affinity: 0.30,
    recency: 0.15,
    quality: 0.15,
    accessibility: 0.15,
    novelty: 0.15,
    typeMatch: 0.10,
  },

  scorePaper(paper, profile, opts = {}) {
    const interests = profile.interests;
    const seen = new Set(profile.stats.papersSeen || []);
    const read = new Set(profile.stats.papersRead || []);
    const excluded = new Set(interests.excludedTopics || []);

    if (paper.topics.some(t => excluded.has(t))) return { score: -1, breakdown: {} };
    if (!paper.isOpenAccess) return { score: -1, breakdown: {} };

    const ageMonths = monthsSincePublication(paper.year);
    if (ageMonths > 18) return { score: -1, breakdown: {} };

    // Afinidad temática: proporción de temas del paper que coinciden con intereses
    const mainTopics = new Set(interests.mainTopics || []);
    const overlap = paper.topics.filter(t => mainTopics.has(t)).length;
    const affinity = mainTopics.size > 0 ? Math.min(1, overlap / Math.max(1, Math.min(paper.topics.length, 2))) : 0.4;

    // Recencia: usa recencyScore del mock + antigüedad real
    const recencyFromAge = Math.max(0, 1 - ageMonths / 18);
    const recency = (paper.recencyScore * 0.5) + (recencyFromAge * 0.5);

    // Calidad / impacto
    const citationBoost = paper.citationSignals ? Math.min(1, paper.citationSignals / 100) : 0.3;
    const quality = (paper.qualitySignals * 0.7) + (citationBoost * 0.3) + (paper.featuredFlag ? 0.15 : 0);

    // Accesibilidad: dificultad adecuada al nivel del usuario + tiempo de lectura vs preferencia
    const levelMap = { accesible: 1, intermedio: 2, avanzado: 3 };
    const userLevel = levelMap[interests.readingLevel] || 2;
    const paperLevel = levelMap[paper.difficulty] || 2;
    const levelDelta = Math.abs(userLevel - paperLevel);
    const accessibility = levelDelta === 0 ? 1 : levelDelta === 1 ? 0.6 : 0.25;
    const timeFit = paper.estimatedMinutes <= (profile.readingFormat.dailyMinutes + 6) ? 1 : 0.5;
    const accessibilityFinal = (accessibility * 0.7) + (timeFit * 0.3);

    // Novedad: penaliza si ya se vio o leyó, premia diversidad temática
    let novelty = 1;
    if (read.has(paper.id)) novelty = 0;
    else if (seen.has(paper.id)) novelty = 0.3;
    if (profile.feedStyle === "variar") {
      const masteredTopics = Object.keys(profile.stats.topicMastery || {})
        .filter(t => (profile.stats.topicMastery[t].read || 0) >= 3);
      if (paper.topics.some(t => !masteredTopics.includes(t))) novelty = Math.min(1, novelty + 0.2);
    }

    // Tipo de artículo preferido
    const prefTypes = interests.preferredPaperTypes || [];
    const typeMatch = prefTypes.length === 0 ? 0.6 : (prefTypes.includes(paper.paperType) ? 1 : 0.3);

    // Ajustes por estilo de feed elegido en onboarding
    let styleBoost = 0;
    if (profile.feedStyle === "destacado" && paper.featuredFlag) styleBoost += 0.08;
    if (profile.feedStyle === "reciente") styleBoost += recency * 0.1;
    if (profile.feedStyle === "facil" && paper.difficulty === "accesible") styleBoost += 0.1;
    if (profile.feedStyle === "exigente" && paper.difficulty === "avanzado") styleBoost += 0.1;

    const w = this.weights;
    const score = (affinity * w.affinity) + (recency * w.recency) + (quality * w.quality) +
      (accessibilityFinal * w.accessibility) + (novelty * w.novelty) + (typeMatch * w.typeMatch) + styleBoost;

    return {
      score,
      breakdown: { affinity, recency, quality, accessibility: accessibilityFinal, novelty, typeMatch, styleBoost },
    };
  },

  buildDailyFeed(papers, profile) {
    const scored = papers
      .map(p => ({ paper: p, ...this.scorePaper(p, profile) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { main: null, alternatives: [] };

    const main = scored[0];
    const alternatives = scored.slice(1, 4);
    return { main, alternatives };
  },

  reasonText(breakdown, paper) {
    const parts = [];
    if (breakdown.affinity > 0.6) parts.push("coincide fuertemente con tus áreas de interés");
    else if (breakdown.affinity > 0.3) parts.push("se relaciona con tus temas de interés");
    if (breakdown.recency > 0.7) parts.push("es muy reciente");
    if (breakdown.quality > 0.7) parts.push("tiene señales de alta calidad");
    if (paper.featuredFlag) parts.push("está destacado en su área");
    if (breakdown.accessibility > 0.8) parts.push("su dificultad se ajusta a tu nivel de lectura");
    if (breakdown.novelty > 0.8) parts.push("es un tema que aún no has explorado a fondo");
    if (parts.length === 0) parts.push("es una opción balanceada dentro de los últimos 18 meses");
    return "Este paper fue elegido porque " + parts.slice(0, 3).join(", ") + ".";
  },
};

function monthsSincePublication(year) {
  const now = new Date();
  const pubYear = year;
  // Aproximación: asumimos publicación a mitad de año si no hay más data.
  const pubDate = new Date(pubYear, 5, 15);
  const diffMonths = (now.getFullYear() - pubDate.getFullYear()) * 12 + (now.getMonth() - pubDate.getMonth());
  return Math.max(0, diffMonths);
}

/* ---------------------------------------------------------
   Gamificación
   --------------------------------------------------------- */
const Gamification = {
  XP_READ: 40,
  XP_QUIZ_CORRECT: 15,
  XP_STREAK_BONUS: 10,

  registerDailyVisit(profile) {
    const today = todayStr();
    const last = profile.stats.lastAccessDate;
    if (last === today) return; // ya contado hoy
    if (last) {
      const gap = daysBetween(last, today);
      if (gap === 1) {
        profile.stats.currentStreak += 1;
      } else if (gap > 1) {
        profile.stats.currentStreak = 1;
      }
    } else {
      profile.stats.currentStreak = 1;
    }
    profile.stats.maxStreak = Math.max(profile.stats.maxStreak, profile.stats.currentStreak);
    profile.stats.lastAccessDate = today;

    const wk = isoWeekKey(today);
    let week = profile.stats.weeklyHistory.find(w => w.week === wk);
    if (!week) {
      week = { week: wk, count: 0, minutes: 0 };
      profile.stats.weeklyHistory.push(week);
    }
  },

  addXp(profile, amount) {
    profile.stats.xp += amount;
    profile.stats.level = 1 + Math.floor(profile.stats.xp / 250);
  },

  markPaperRead(profile, paper) {
    if (!profile.stats.papersRead.includes(paper.id)) {
      profile.stats.papersRead.push(paper.id);
      this.addXp(profile, this.XP_READ);
      const wk = isoWeekKey(todayStr());
      let week = profile.stats.weeklyHistory.find(w => w.week === wk);
      if (!week) {
        week = { week: wk, count: 0, minutes: 0 };
        profile.stats.weeklyHistory.push(week);
      }
      week.count += 1;
      week.minutes += paper.estimatedMinutes;

      paper.topics.forEach(t => {
        if (!profile.stats.topicMastery[t]) profile.stats.topicMastery[t] = { read: 0, correct: 0, total: 0 };
        profile.stats.topicMastery[t].read += 1;
      });
    }
  },

  registerQuizResult(profile, paper, correctCount, totalCount) {
    profile.stats.quizResults[paper.id] = { correctCount, totalCount, date: todayStr() };
    this.addXp(profile, correctCount * this.XP_QUIZ_CORRECT);
    paper.topics.forEach(t => {
      if (!profile.stats.topicMastery[t]) profile.stats.topicMastery[t] = { read: 0, correct: 0, total: 0 };
      profile.stats.topicMastery[t].correct += correctCount;
      profile.stats.topicMastery[t].total += totalCount;
    });
  },

  checkNewAchievements(profile) {
    const unlocked = new Set(profile.stats.achievements);
    const fresh = [];
    ACHIEVEMENTS.forEach(a => {
      if (!unlocked.has(a.id) && a.check(profile.stats)) {
        unlocked.add(a.id);
        fresh.push(a);
      }
    });
    profile.stats.achievements = Array.from(unlocked);
    return fresh;
  },
};

/* ---------------------------------------------------------
   Carga de datos
   --------------------------------------------------------- */
async function loadData() {
  const [papersRes, topicsRes] = await Promise.all([
    fetch("data/papers.json"),
    fetch("data/topics.json"),
  ]);
  PAPERS = await papersRes.json();
  TOPICS = await topicsRes.json();
}

function topicLabel(id) {
  const t = TOPICS.find(x => x.id === id);
  return t ? t.label : id;
}

function paperById(id) { return PAPERS.find(p => p.id === id); }

/* ---------------------------------------------------------
   Feed diario (persistente por día)
   --------------------------------------------------------- */
function ensureDailyFeed() {
  const today = todayStr();
  if (PROFILE.currentFeed && PROFILE.currentFeed.date === today) {
    // Verificar que exista aún el paper principal (posponer lo remueve)
    if (PROFILE.currentFeed.mainId) return PROFILE.currentFeed;
  }
  const { main, alternatives } = RecommendationEngine.buildDailyFeed(PAPERS, PROFILE);
  if (!main) {
    PROFILE.currentFeed = { date: today, mainId: null, altIds: [] };
  } else {
    PROFILE.currentFeed = {
      date: today,
      mainId: main.paper.id,
      altIds: alternatives.map(a => a.paper.id),
    };
    markSeen(main.paper.id);
    alternatives.forEach(a => markSeen(a.paper.id));
  }
  persist();
  return PROFILE.currentFeed;
}

function markSeen(id) {
  if (!PROFILE.stats.papersSeen.includes(id)) PROFILE.stats.papersSeen.push(id);
}

function postponeMain() {
  const feed = PROFILE.currentFeed;
  if (!feed || !feed.mainId) return;
  if (!PROFILE.stats.papersPostponed.includes(feed.mainId)) {
    PROFILE.stats.papersPostponed.push(feed.mainId);
  }
  // recalcular excluyendo el pospuesto temporalmente de main
  const excludeIds = new Set([feed.mainId]);
  const candidates = PAPERS.filter(p => !excludeIds.has(p.id));
  const { main, alternatives } = RecommendationEngine.buildDailyFeed(candidates, PROFILE);
  if (main) {
    PROFILE.currentFeed = { date: feed.date, mainId: main.paper.id, altIds: alternatives.map(a => a.paper.id) };
    markSeen(main.paper.id);
  }
  persist();
  render();
}

function toggleSave(id) {
  const idx = PROFILE.stats.papersSaved.indexOf(id);
  if (idx >= 0) PROFILE.stats.papersSaved.splice(idx, 1);
  else PROFILE.stats.papersSaved.push(id);
  persist();
  render();
}

/* ---------------------------------------------------------
   Router simple
   --------------------------------------------------------- */
function navigate(route, params = {}) {
  currentRoute = route;
  window.__params = params;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------------------------------------------------
   Toast
   --------------------------------------------------------- */
function showToast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------------------------------------------------------
   Render principal
   --------------------------------------------------------- */
function render() {
  document.documentElement.setAttribute("data-theme", PROFILE.settings.theme);

  const view = document.getElementById("view");

  if (!Auth.current) {
    document.getElementById("topbar").innerHTML = "";
    view.innerHTML = renderLoginGate();
    attachLoginGateEvents();
    return;
  }

  renderTopbar();

  if (!PROFILE.onboardingCompleted) {
    view.innerHTML = "";
    Onboarding.mount();
    return;
  }
  Gamification.registerDailyVisit(PROFILE);
  persist();

  switch (currentRoute) {
    case "home": view.innerHTML = renderHome(); attachHomeEvents(); break;
    case "reader": view.innerHTML = renderReader(); attachReaderEvents(); break;
    case "quiz": view.innerHTML = renderQuiz(); attachQuizEvents(); break;
    case "stats": view.innerHTML = renderStats(); break;
    case "settings": view.innerHTML = renderSettings(); attachSettingsEvents(); break;
    case "saved": view.innerHTML = renderSaved(); attachHomeEvents(); break;
    default: view.innerHTML = renderHome(); attachHomeEvents();
  }
}

function renderTopbar() {
  const bar = document.getElementById("topbar");
  if (!PROFILE.onboardingCompleted) { bar.innerHTML = ""; return; }
  const user = Auth.current;
  const avatar = user && user.picture
    ? `<img src="${user.picture}" alt="" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`
    : `<div class="icon-btn" style="width:30px;height:30px;font-size:0.8rem;">${(user && user.name ? user.name[0] : "?").toUpperCase()}</div>`;
  bar.innerHTML = `
    <div class="brand"><span class="dot"></span> PaperStreak</div>
    <nav class="nav-tabs" aria-label="Navegación principal">
      <button data-route="home" class="${currentRoute === "home" ? "active" : ""}">Hoy</button>
      <button data-route="saved" class="${currentRoute === "saved" ? "active" : ""}">Guardados</button>
      <button data-route="stats" class="${currentRoute === "stats" ? "active" : ""}">Progreso</button>
      <button data-route="settings" class="${currentRoute === "settings" ? "active" : ""}">Ajustes</button>
    </nav>
    <div class="topbar-right">
      <div class="streak-pill" title="Racha actual">🔥 ${PROFILE.stats.currentStreak}</div>
      <div class="streak-pill" title="XP">⭐ ${PROFILE.stats.xp}</div>
      <button class="icon-btn" id="theme-toggle" aria-label="Cambiar tema">${PROFILE.settings.theme === "light" ? "🌙" : "☀️"}</button>
      <button class="icon-btn" id="user-menu-btn" title="${user ? (user.isGuest ? "Invitado" : user.name) : ""}" aria-label="Cuenta">${avatar}</button>
    </div>
  `;
  bar.querySelectorAll("[data-route]").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
  document.getElementById("theme-toggle").addEventListener("click", () => {
    PROFILE.settings.theme = PROFILE.settings.theme === "light" ? "dark" : "light";
    persist();
    render();
  });
  document.getElementById("user-menu-btn").addEventListener("click", () => navigate("settings"));
}

/* ---------- Pantalla de login ---------- */
function renderLoginGate() {
  const googleReady = Auth.isReady();
  return `
    <div class="container" style="max-width:420px; padding-top:14vh;">
      <div class="hero-header" style="text-align:center;">
        <div class="brand" style="justify-content:center; font-size:1.5rem; margin-bottom:8px;"><span class="dot"></span> PaperStreak</div>
        <p>Inicia sesión para guardar tu racha y tu progreso en este navegador.</p>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:16px; margin-top:24px;">
        <div id="google-signin-btn"></div>
        ${!googleReady ? `
          <p style="font-size:0.8rem; color:var(--text-muted); text-align:center;">
            El botón de Google aún no está configurado (falta el Client ID en <code>config.js</code>).
            Mientras tanto puedes continuar como invitado.
          </p>
        ` : ""}
        <button class="btn btn-ghost" id="guest-login-btn">Continuar sin cuenta</button>
      </div>
    </div>
  `;
}

function attachLoginGateEvents() {
  Auth.initGis();
  const rendered = Auth.renderButton("google-signin-btn");
  if (!rendered) {
    const el = document.getElementById("google-signin-btn");
    if (el) el.innerHTML = `<button class="btn btn-primary" disabled>Iniciar sesión con Google</button>`;
  }
  document.getElementById("guest-login-btn").addEventListener("click", () => Auth.loginAsGuest());
}

/* ---------- Home / Feed ---------- */
function renderHome() {
  const feed = ensureDailyFeed();
  if (!feed.mainId) {
    return `<div class="container"><div class="empty-state">
      <h2>No encontramos papers dentro de tus criterios actuales</h2>
      <p>Prueba ajustando tus intereses o excluidos en Ajustes.</p>
      <button class="btn btn-primary" onclick="navigate('settings')">Ir a ajustes</button>
    </div></div>`;
  }
  const main = paperById(feed.mainId);
  const { breakdown } = RecommendationEngine.scorePaper(main, PROFILE);
  const reason = RecommendationEngine.reasonText(breakdown, main);
  const isRead = PROFILE.stats.papersRead.includes(main.id);
  const isSaved = PROFILE.stats.papersSaved.includes(main.id);

  const alts = feed.altIds.map(id => paperById(id)).filter(Boolean);

  return `
    <div class="container">
      <div class="hero-header">
        <h1>Tu paper de hoy</h1>
        <p>${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · meta diaria: ${PROFILE.readingFormat.dailyMinutes} min</p>
      </div>

      <article class="paper-card featured">
        <span class="paper-badge">${main.featuredFlag ? "Destacado" : "Recomendado"}</span>
        <h2 class="paper-title">${main.title}</h2>
        <div class="paper-meta">
          <span>✍️ ${main.authors.join(", ")}</span>
          <span>📅 ${main.year}</span>
          <span>📰 ${main.journal}</span>
          <span>⏱️ ${main.estimatedMinutes} min</span>
          <span>🎚️ ${capitalize(main.difficulty)}</span>
          <span>${isRead ? "✅ Leído" : "🕓 Pendiente"}</span>
        </div>
        <div class="tag-row">${main.topics.map(t => `<span class="tag">${topicLabel(t)}</span>`).join("")}</div>
        <div class="paper-why">💡 ${reason}</div>
        <div class="paper-actions">
          <button class="btn btn-primary" data-open="${main.id}">Leer ahora</button>
          <button class="btn btn-secondary" data-save="${main.id}">${isSaved ? "Guardado ✓" : "Guardar"}</button>
          <button class="btn btn-ghost" data-postpone="1">Posponer</button>
          <a class="btn btn-ghost" href="${main.openAccessUrl}" target="_blank" rel="noopener">Abrir fuente ↗</a>
        </div>
      </article>

      <h3 class="section-title">Alternativas de hoy</h3>
      <div class="alt-grid">
        ${alts.map(p => `
          <div class="alt-card">
            <h4>${p.title}</h4>
            <div class="alt-meta">${p.year} · ${p.journal} · ${p.estimatedMinutes} min · ${capitalize(p.difficulty)}</div>
            <div class="tag-row">${p.topics.slice(0, 2).map(t => `<span class="tag">${topicLabel(t)}</span>`).join("")}</div>
            <div class="paper-actions">
              <button class="btn btn-sm btn-primary" data-open="${p.id}">Leer</button>
              <button class="btn btn-sm btn-secondary" data-save="${p.id}">${PROFILE.stats.papersSaved.includes(p.id) ? "Guardado ✓" : "Guardar"}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function attachHomeEvents() {
  document.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => openReader(btn.dataset.open));
  });
  document.querySelectorAll("[data-save]").forEach(btn => {
    btn.addEventListener("click", () => toggleSave(btn.dataset.save));
  });
  const pp = document.querySelector("[data-postpone]");
  if (pp) pp.addEventListener("click", postponeMain);
}

function renderSaved() {
  const saved = PROFILE.stats.papersSaved.map(id => paperById(id)).filter(Boolean);
  if (saved.length === 0) {
    return `<div class="container"><div class="empty-state"><h2>Aún no guardaste papers</h2><p>Cuando encuentres algo interesante, guárdalo para leer más tarde.</p></div></div>`;
  }
  return `<div class="container">
    <div class="hero-header"><h1>Guardados</h1><p>${saved.length} paper(s)</p></div>
    <div class="alt-grid">
      ${saved.map(p => `
        <div class="alt-card">
          <h4>${p.title}</h4>
          <div class="alt-meta">${p.year} · ${p.journal} · ${p.estimatedMinutes} min</div>
          <div class="paper-actions">
            <button class="btn btn-sm btn-primary" data-open="${p.id}">Leer</button>
            <button class="btn btn-sm btn-secondary" data-save="${p.id}">Quitar</button>
          </div>
        </div>
      `).join("")}
    </div>
  </div>`;
}

/* ---------- Reader ---------- */
function openReader(id) {
  currentReadingPaper = id;
  readerNotesDraft = (PROFILE.stats.notes && PROFILE.stats.notes[id]) || "";
  navigate("reader");
}

function renderReader() {
  const paper = paperById(currentReadingPaper || (PROFILE.currentFeed && PROFILE.currentFeed.mainId));
  if (!paper) return `<div class="container"><p>No se encontró el paper.</p></div>`;
  const keyPoints = generateKeyPoints(paper);
  const terms = generateTerms(paper);
  const isRead = PROFILE.stats.papersRead.includes(paper.id);

  return `
    <div class="container">
      <button class="btn btn-ghost btn-sm" onclick="navigate('home')">← Volver al feed</button>
      <div class="reader-header" style="margin-top:16px;">
        <h1 class="reader-title">${paper.title}</h1>
        <div class="reader-meta">${paper.authors.join(", ")} · ${paper.journal} · ${paper.year} · ${paper.estimatedMinutes} min · ${capitalize(paper.difficulty)}</div>
      </div>

      <div class="reader-toggle" role="tablist">
        <button class="active" data-mode="rapida">Lectura rápida</button>
        <button data-mode="profunda">Lectura profunda</button>
      </div>

      <details class="reader-block" open>
        <summary>Resumen breve en lenguaje claro</summary>
        <p>${paper.abstract}</p>
      </details>

      <details class="reader-block" id="deep-abstract" style="display:none;">
        <summary>Abstract original</summary>
        <p>${paper.abstract}</p>
      </details>

      <details class="reader-block" open>
        <summary>Puntos clave</summary>
        <ul class="key-points">${keyPoints.map(k => `<li>${k}</li>`).join("")}</ul>
      </details>

      <details class="reader-block" id="deep-terms" style="display:none;">
        <summary>Términos difíciles</summary>
        <dl class="terms-list">
          ${terms.map(t => `<dt>${t.term}</dt><dd>${t.def}</dd>`).join("")}
        </dl>
      </details>

      <details class="reader-block">
        <summary>Mis notas</summary>
        <textarea class="notes-area" id="notes-area" placeholder="Escribe tus notas sobre este paper...">${escapeHtml(readerNotesDraft)}</textarea>
      </details>

      <div class="reader-actions">
        <button class="btn btn-primary" id="mark-read">${isRead ? "Ya marcado como leído ✓" : "Marcar como leído"}</button>
        <button class="btn btn-secondary" id="go-quiz">Responder preguntas</button>
        <a class="btn btn-ghost" href="${paper.pdfUrl}" target="_blank" rel="noopener">Abrir original ↗</a>
        <button class="btn btn-ghost" id="save-notes">Guardar notas</button>
      </div>
    </div>
  `;
}

function attachReaderEvents() {
  const paper = paperById(currentReadingPaper || (PROFILE.currentFeed && PROFILE.currentFeed.mainId));
  document.querySelectorAll(".reader-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".reader-toggle button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const deep = btn.dataset.mode === "profunda";
      document.getElementById("deep-abstract").style.display = deep ? "block" : "none";
      document.getElementById("deep-terms").style.display = deep ? "block" : "none";
      if (deep) {
        document.getElementById("deep-abstract").open = true;
        document.getElementById("deep-terms").open = true;
      }
    });
  });
  document.getElementById("mark-read").addEventListener("click", () => {
    if (!PROFILE.stats.papersRead.includes(paper.id)) {
      Gamification.markPaperRead(PROFILE, paper);
      persist();
      showToast(`+${Gamification.XP_READ} XP · ¡Buen trabajo!`);
      checkAndCelebrateAchievements();
      render();
    }
  });
  document.getElementById("go-quiz").addEventListener("click", () => navigate("quiz"));
  document.getElementById("save-notes").addEventListener("click", () => {
    const val = document.getElementById("notes-area").value;
    if (!PROFILE.stats.notes) PROFILE.stats.notes = {};
    PROFILE.stats.notes[paper.id] = val;
    persist();
    showToast("Notas guardadas");
  });
}

function generateKeyPoints(paper) {
  return [
    `Aborda ${paper.title.toLowerCase()} desde un enfoque de tipo ${paper.paperType}.`,
    `Publicado en ${paper.journal} (${paper.year}), con acceso abierto verificado.`,
    `Relevante para: ${paper.topics.map(topicLabel).join(", ")}.`,
    paper.whyItMatters,
  ];
}

function generateTerms(paper) {
  const generic = [
    { term: "Acceso abierto", def: "Publicación disponible de forma gratuita y legal para cualquier lector." },
    { term: paper.paperType, def: `Tipo de artículo: ${paper.paperType}, con implicancias distintas en el nivel de evidencia.` },
  ];
  return generic;
}

/* ---------- Quiz ---------- */
function buildQuizForPaper(paper) {
  return [
    { type: "comprehension", q: `¿Cuál es el tema principal de "${paper.title}"?`, options: shuffle([
      topicLabel(paper.topics[0]), "Historia del arte", "Finanzas corporativas", "Astronomía observacional",
    ]), correct: topicLabel(paper.topics[0]) },
    { type: "comprehension", q: `¿Qué tipo de artículo es este trabajo?`, options: shuffle([
      paper.paperType, "poema", "receta de cocina", "manual técnico no científico",
    ]), correct: paper.paperType },
    { type: "comprehension", q: `¿En qué fuente fue publicado?`, options: shuffle([
      paper.journal, "Fuente inventada A", "Fuente inventada B", "Fuente inventada C",
    ]), correct: paper.journal },
    { type: "application", q: `¿En qué contexto aplicarías mejor los hallazgos de este paper?`, options: shuffle([
      `En la práctica o investigación relacionada con ${topicLabel(paper.topics[0])}`,
      "En marketing digital", "En finanzas personales", "En diseño gráfico",
    ]), correct: `En la práctica o investigación relacionada con ${topicLabel(paper.topics[0])}` },
  ];
}

let quizState = null;

function renderQuiz() {
  const paper = paperById(currentReadingPaper || (PROFILE.currentFeed && PROFILE.currentFeed.mainId));
  if (!paper) return `<div class="container"><p>No hay paper seleccionado.</p></div>`;
  if (!quizState || quizState.paperId !== paper.id) {
    quizState = { paperId: paper.id, questions: buildQuizForPaper(paper), answers: [], confidence: null, submitted: false };
  }
  const q = quizState.questions;
  return `
    <div class="container">
      <button class="btn btn-ghost btn-sm" onclick="navigate('reader')">← Volver a lectura</button>
      <div class="hero-header" style="margin-top:16px;"><h1>Comprueba tu comprensión</h1><p>${paper.title}</p></div>
      <form id="quiz-form">
        ${q.map((item, i) => `
          <div class="quiz-card">
            <div class="quiz-q">${i + 1}. ${item.q}</div>
            <div class="quiz-options" data-qindex="${i}">
              ${item.options.map(opt => `<button type="button" class="quiz-option" data-value="${escapeHtml(opt)}">${opt}</button>`).join("")}
            </div>
          </div>
        `).join("")}
        <div class="quiz-card">
          <div class="quiz-q">¿Qué tan seguro te sientes de tu comprensión de este paper?</div>
          <div class="confidence-row" id="confidence-row">
            ${["Poco seguro", "Algo seguro", "Muy seguro"].map(c => `<button type="button" class="quiz-option" data-conf="${c}">${c}</button>`).join("")}
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="submit-quiz">Enviar respuestas</button>
      </form>
      <div id="quiz-result"></div>
    </div>
  `;
}

function attachQuizEvents() {
  const paper = paperById(currentReadingPaper || (PROFILE.currentFeed && PROFILE.currentFeed.mainId));
  document.querySelectorAll(".quiz-options").forEach(group => {
    group.querySelectorAll(".quiz-option").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".quiz-option").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        btn.style.borderColor = "var(--accent)";
        group.querySelectorAll(".quiz-option").forEach(b => { if (b !== btn) b.style.borderColor = ""; });
        quizState.answers[Number(group.dataset.qindex)] = btn.dataset.value;
      });
    });
  });
  document.querySelectorAll("#confidence-row .quiz-option").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#confidence-row .quiz-option").forEach(b => b.style.borderColor = "");
      btn.style.borderColor = "var(--accent)";
      quizState.confidence = btn.dataset.conf;
    });
  });
  document.getElementById("submit-quiz").addEventListener("click", () => {
    if (quizState.answers.length < quizState.questions.length || !quizState.confidence) {
      showToast("Responde todas las preguntas antes de enviar");
      return;
    }
    let correctCount = 0;
    quizState.questions.forEach((item, i) => {
      const group = document.querySelector(`.quiz-options[data-qindex="${i}"]`);
      group.querySelectorAll(".quiz-option").forEach(btn => {
        if (btn.dataset.value === item.correct) btn.classList.add("correct");
        else if (btn.classList.contains("selected") && btn.dataset.value !== item.correct) btn.classList.add("incorrect");
      });
      if (quizState.answers[i] === item.correct) correctCount++;
    });
    Gamification.registerQuizResult(PROFILE, paper, correctCount, quizState.questions.length);
    persist();
    const total = quizState.questions.length;
    const resultBox = document.getElementById("quiz-result");
    let suggestion = "";
    if (correctCount < total) {
      suggestion = `<p>Te recomendamos repasar el resumen y explorar papers relacionados con ${topicLabel(paper.topics[0])}.</p>`;
    } else {
      suggestion = `<p>¡Excelente comprensión! Sigamos explorando más de ${topicLabel(paper.topics[0])}.</p>`;
    }
    resultBox.innerHTML = `
      <div class="quiz-card">
        <h3>Resultado: ${correctCount} / ${total} correctas</h3>
        <p>+${correctCount * Gamification.XP_QUIZ_CORRECT} XP</p>
        ${suggestion}
        <button class="btn btn-primary" onclick="navigate('home')">Volver al feed</button>
      </div>
    `;
    document.getElementById("submit-quiz").disabled = true;
    checkAndCelebrateAchievements();
  });
}

function checkAndCelebrateAchievements() {
  const fresh = Gamification.checkNewAchievements(PROFILE);
  persist();
  fresh.forEach((a, i) => setTimeout(() => showToast(`🏅 Nuevo logro: ${a.name}`), i * 900));
}

/* ---------- Stats ---------- */
function renderStats() {
  const s = PROFILE.stats;
  const totalMinutes = s.papersRead.reduce((sum, id) => {
    const p = paperById(id); return sum + (p ? p.estimatedMinutes : 0);
  }, 0);

  const topicCounts = {};
  s.papersRead.forEach(id => {
    const p = paperById(id);
    if (p) p.topics.forEach(t => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
  });
  const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxTopicCount = Math.max(1, ...topTopics.map(t => t[1]));

  const typeCounts = {};
  s.papersRead.forEach(id => {
    const p = paperById(id);
    if (p) typeCounts[p.paperType] = (typeCounts[p.paperType] || 0) + 1;
  });

  const last8Weeks = s.weeklyHistory.slice(-8);

  return `
    <div class="container">
      <div class="hero-header"><h1>Tu progreso</h1><p>Un panorama claro de tu constancia científica</p></div>

      <div class="stats-grid">
        <div class="stat-box"><div class="num">${s.currentStreak}</div><div class="lbl">Racha actual</div></div>
        <div class="stat-box"><div class="num">${s.maxStreak}</div><div class="lbl">Racha máxima</div></div>
        <div class="stat-box"><div class="num">${s.papersRead.length}</div><div class="lbl">Papers leídos</div></div>
        <div class="stat-box"><div class="num">${s.papersSaved.length}</div><div class="lbl">Guardados</div></div>
        <div class="stat-box"><div class="num">${totalMinutes}</div><div class="lbl">Minutos totales</div></div>
        <div class="stat-box"><div class="num">Nv. ${s.level}</div><div class="lbl">${s.xp} XP</div></div>
      </div>

      <h3 class="section-title">Temas más frecuentes</h3>
      ${topTopics.length === 0 ? `<p style="color:var(--text-muted)">Aún no hay lecturas registradas.</p>` :
        topTopics.map(([t, c]) => `
          <div class="bar-row">
            <div class="label">${topicLabel(t)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(c / maxTopicCount) * 100}%"></div></div>
            <div>${c}</div>
          </div>
        `).join("")}

      <h3 class="section-title">Distribución por tipo de paper</h3>
      ${Object.keys(typeCounts).length === 0 ? `<p style="color:var(--text-muted)">Sin datos aún.</p>` :
        Object.entries(typeCounts).map(([t, c]) => `
          <div class="bar-row">
            <div class="label">${capitalize(t)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(c / Math.max(1, s.papersRead.length)) * 100}%"></div></div>
            <div>${c}</div>
          </div>
        `).join("")}

      <h3 class="section-title">Evolución semanal</h3>
      ${last8Weeks.length === 0 ? `<p style="color:var(--text-muted)">Vuelve mañana para ver tu evolución.</p>` :
        last8Weeks.map(w => `
          <div class="bar-row">
            <div class="label">${w.week}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (w.count / 7) * 100)}%"></div></div>
            <div>${w.count} papers</div>
          </div>
        `).join("")}

      <h3 class="section-title">Logros</h3>
      <div class="achv-grid">
        ${ACHIEVEMENTS.map(a => `
          <div class="achv ${s.achievements.includes(a.id) ? "unlocked" : ""}">
            <div class="emoji">${a.emoji}</div>
            <div class="name">${a.name}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/* ---------- Settings ---------- */
function renderSettings() {
  const user = Auth.current;
  return `
    <div class="container">
      <div class="hero-header"><h1>Ajustes</h1><p>Gestiona tu perfil y tus datos</p></div>

      <div class="settings-group">
        <h3>Cuenta</h3>
        <div class="settings-row">
          <span>${user && user.isGuest ? "Estás como invitado (datos solo en este navegador)" : `Sesión iniciada como <b>${user ? user.name : ""}</b>${user && user.email ? ` (${user.email})` : ""}`}</span>
          <button class="btn btn-ghost btn-sm" id="logout-btn">Cerrar sesión</button>
        </div>
      </div>

      <div class="settings-group">
        <h3>Intereses principales</h3>
        <div class="chip-grid" id="settings-topics">
          ${TOPICS.map(t => `<button type="button" class="chip ${PROFILE.interests.mainTopics.includes(t.id) ? "selected" : ""}" data-topic="${t.id}">${t.label}</button>`).join("")}
        </div>
      </div>

      <div class="settings-group">
        <h3>Estilo de feed</h3>
        <div class="chip-grid" id="settings-feedstyle">
          ${[["destacado", "Lo más destacado"], ["reciente", "Lo más reciente"], ["variar", "Variar temas"], ["facil", "Papers fáciles"], ["exigente", "Papers exigentes"]]
            .map(([val, label]) => `<button type="button" class="chip ${PROFILE.feedStyle === val ? "selected" : ""}" data-feedstyle="${val}">${label}</button>`).join("")}
        </div>
      </div>

      <div class="settings-group">
        <h3>Minutos diarios objetivo</h3>
        <div class="range-row">
          <input type="range" id="minutes-range" min="5" max="30" step="1" value="${PROFILE.readingFormat.dailyMinutes}">
          <strong id="minutes-value">${PROFILE.readingFormat.dailyMinutes} min</strong>
        </div>
      </div>

      <div class="settings-group">
        <h3>Datos</h3>
        <div class="settings-row"><span>Exportar mis datos</span><button class="btn btn-secondary btn-sm" id="export-btn">Exportar JSON</button></div>
        <div class="settings-row"><span>Importar datos</span><label class="btn btn-secondary btn-sm" style="cursor:pointer;">Importar<input type="file" id="import-input" accept="application/json" style="display:none;"></label></div>
        <div class="settings-row"><span>Reiniciar tour de bienvenida</span><button class="btn btn-ghost btn-sm" id="restart-onboarding">Reiniciar tour</button></div>
        <div class="settings-row"><span>Borrar todos los datos</span><button class="btn btn-ghost btn-sm" id="reset-btn" style="color:var(--accent);border-color:var(--accent);">Resetear</button></div>
      </div>
    </div>
  `;
}

function attachSettingsEvents() {
  document.getElementById("logout-btn").addEventListener("click", () => {
    if (confirm("¿Cerrar sesión? Tus datos quedan guardados para la próxima vez que inicies sesión con esta misma cuenta.")) {
      Auth.logout();
    }
  });
  document.querySelectorAll("#settings-topics .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.topic;
      const arr = PROFILE.interests.mainTopics;
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
      persist();
      render();
    });
  });
  document.querySelectorAll("#settings-feedstyle .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      PROFILE.feedStyle = chip.dataset.feedstyle;
      persist();
      render();
    });
  });
  const range = document.getElementById("minutes-range");
  range.addEventListener("input", () => {
    document.getElementById("minutes-value").textContent = `${range.value} min`;
  });
  range.addEventListener("change", () => {
    PROFILE.readingFormat.dailyMinutes = Number(range.value);
    persist();
  });
  document.getElementById("export-btn").addEventListener("click", () => Store.exportData());
  document.getElementById("import-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        Store.importData(reader.result);
        PROFILE = Store.load();
        showToast("Datos importados correctamente");
        render();
      } catch (err) {
        showToast("Error al importar el archivo");
      }
    };
    reader.readAsText(file);
  });
  document.getElementById("restart-onboarding").addEventListener("click", () => {
    PROFILE.onboardingCompleted = false;
    Onboarding.reset();
    persist();
    render();
  });
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (confirm("¿Seguro que quieres borrar todos tus datos? Esta acción no se puede deshacer.")) {
      Store.reset();
      PROFILE = Store.load();
      Onboarding.reset();
      render();
    }
  });
}

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------------------------------------------------------
   Onboarding wizard
   --------------------------------------------------------- */
const Onboarding = {
  step: 0,
  totalSteps: 5,
  draft: null,

  reset() { this.step = 0; this.draft = null; },

  mount() {
    if (!this.draft) {
      this.draft = JSON.parse(JSON.stringify(PROFILE));
      this.draft.interests.mainTopics = this.draft.interests.mainTopics.length ? this.draft.interests.mainTopics : [];
    }
    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";
    overlay.innerHTML = this.renderStep();
    document.body.appendChild(overlay);
    this._overlay = overlay;
    this.attachEvents();
  },

  unmount() {
    if (this._overlay) this._overlay.remove();
  },

  renderProgress() {
    let dots = "";
    for (let i = 0; i < this.totalSteps; i++) {
      dots += `<span class="${i <= this.step ? "done" : ""}"></span>`;
    }
    return `<div class="ob-progress">${dots}</div>`;
  },

  renderStep() {
    const d = this.draft;
    let body = "";
    if (this.step === 0) {
      body = `
        <h2 class="ob-step-title">Bienvenido a PaperStreak</h2>
        <p class="ob-step-sub">Ciencia real, todos los días, en pocos minutos.</p>
        <ul style="line-height:1.9;">
          <li>📄 Cada día te recomendamos <b>un paper</b> de acceso público publicado en los últimos 18 meses.</li>
          <li>⏱️ Leer toma entre 6 y 20 minutos, según tu ritmo.</li>
          <li>🔒 Todo se guarda <b>localmente en tu navegador</b>: sin cuentas, sin servidores.</li>
          <li>🔥 Ganas XP y mantienes una racha, como un hábito real.</li>
        </ul>
      `;
    } else if (this.step === 1) {
      body = `
        <h2 class="ob-step-title">¿Qué te interesa?</h2>
        <p class="ob-step-sub">Elige tus áreas principales (puedes elegir varias).</p>
        <div class="chip-grid" id="ob-main-topics">
          ${TOPICS.map(t => `<button type="button" class="chip ${d.interests.mainTopics.includes(t.id) ? "selected" : ""}" data-topic="${t.id}">${t.label}</button>`).join("")}
        </div>
        <div class="field-label">Temas a excluir (opcional)</div>
        <div class="chip-grid" id="ob-excluded-topics">
          ${TOPICS.map(t => `<button type="button" class="chip ${d.interests.excludedTopics.includes(t.id) ? "selected" : ""}" data-topic="${t.id}">${t.label}</button>`).join("")}
        </div>
        <div class="field-label">Idioma preferido</div>
        <div class="chip-grid" id="ob-language">
          ${[["es", "Español"], ["en", "Inglés"]].map(([v, l]) => `<button type="button" class="chip ${d.interests.language === v ? "selected" : ""}" data-lang="${v}">${l}</button>`).join("")}
        </div>
        <div class="field-label">Nivel de lectura</div>
        <div class="chip-grid" id="ob-level">
          ${[["accesible", "Accesible"], ["intermedio", "Intermedio"], ["avanzado", "Avanzado"]].map(([v, l]) => `<button type="button" class="chip ${d.interests.readingLevel === v ? "selected" : ""}" data-level="${v}">${l}</button>`).join("")}
        </div>
      `;
    } else if (this.step === 2) {
      body = `
        <h2 class="ob-step-title">Formato de lectura</h2>
        <p class="ob-step-sub">Ajustemos tu ritmo ideal.</p>
        <div class="field-label">Minutos diarios ideales: <span id="ob-minutes-label">${d.readingFormat.dailyMinutes}</span> min</div>
        <div class="range-row"><input type="range" id="ob-minutes" min="5" max="30" step="1" value="${d.readingFormat.dailyMinutes}"></div>
        <div class="field-label">Profundidad preferida</div>
        <div class="chip-grid" id="ob-depth">
          ${["abstract", "resumen extendido", "lectura completa"].map(v => `<button type="button" class="chip ${d.readingFormat.depth === v ? "selected" : ""}" data-depth="${v}">${capitalize(v)}</button>`).join("")}
        </div>
        <div class="field-label">Longitud preferida</div>
        <div class="chip-grid" id="ob-length">
          ${["corto", "mediano", "largo"].map(v => `<button type="button" class="chip ${d.readingFormat.lengthPreference === v ? "selected" : ""}" data-length="${v}">${capitalize(v)}</button>`).join("")}
        </div>
        <div class="field-label">Tipos de paper preferidos</div>
        <div class="chip-grid" id="ob-types">
          ${["estudio original", "review", "metaanálisis", "ensayo clínico", "estudio piloto", "caso clínico", "preprint"].map(v => `<button type="button" class="chip ${d.interests.preferredPaperTypes.includes(v) ? "selected" : ""}" data-ptype="${v}">${capitalize(v)}</button>`).join("")}
        </div>
      `;
    } else if (this.step === 3) {
      body = `
        <h2 class="ob-step-title">Estilo del feed</h2>
        <p class="ob-step-sub">¿Cómo quieres que elijamos tu paper diario?</p>
        <div class="chip-grid" id="ob-feedstyle">
          ${[
            ["destacado", "Lo más destacado y popular de mi área"],
            ["reciente", "Lo más reciente"],
            ["variar", "Variar temas"],
            ["facil", "Papers fáciles de leer"],
            ["exigente", "Papers más exigentes"],
          ].map(([v, l]) => `<button type="button" class="chip ${d.feedStyle === v ? "selected" : ""}" data-feedstyle="${v}" style="width:100%;text-align:left;">${l}</button>`).join("")}
        </div>
      `;
    } else if (this.step === 4) {
      const preview = pickPreviewPaper(d);
      body = `
        <h2 class="ob-step-title">Todo listo</h2>
        <p class="ob-step-sub">Este es un resumen de tus preferencias.</p>
        <ul class="summary-list">
          <li><b>Áreas</b> ${d.interests.mainTopics.map(topicLabel).join(", ") || "—"}</li>
          <li><b>Nivel</b> ${capitalize(d.interests.readingLevel)}</li>
          <li><b>Minutos diarios</b> ${d.readingFormat.dailyMinutes} min</li>
          <li><b>Estilo de feed</b> ${d.feedStyle}</li>
        </ul>
        ${preview ? `
          <div class="field-label" style="margin-top:20px;">Tu primer paper recomendado sería:</div>
          <div class="paper-card" style="margin-top:8px;">
            <h3 class="paper-title" style="font-size:1.1rem;">${preview.title}</h3>
            <div class="paper-meta"><span>${preview.year}</span><span>${preview.estimatedMinutes} min</span></div>
          </div>
        ` : ""}
      `;
    }
    return `
      <div class="onboarding-card">
        ${this.renderProgress()}
        ${body}
        <div class="ob-actions">
          ${this.step > 0 ? `<button class="btn btn-ghost btn-sm" id="ob-back">Atrás</button>` : `<span></span>`}
          <button class="btn btn-primary" id="ob-next">${this.step === this.totalSteps - 1 ? "Empezar hoy" : "Continuar"}</button>
        </div>
      </div>
    `;
  },

  refresh() {
    this._overlay.innerHTML = this.renderStep();
    this.attachEvents();
  },

  attachEvents() {
    const d = this.draft;
    const q = sel => this._overlay.querySelectorAll(sel);

    q("#ob-main-topics .chip").forEach(c => c.addEventListener("click", () => {
      toggleInArray(d.interests.mainTopics, c.dataset.topic); this.refresh();
    }));
    q("#ob-excluded-topics .chip").forEach(c => c.addEventListener("click", () => {
      toggleInArray(d.interests.excludedTopics, c.dataset.topic); this.refresh();
    }));
    q("#ob-language .chip").forEach(c => c.addEventListener("click", () => {
      d.interests.language = c.dataset.lang; this.refresh();
    }));
    q("#ob-level .chip").forEach(c => c.addEventListener("click", () => {
      d.interests.readingLevel = c.dataset.level; this.refresh();
    }));
    const minutesInput = this._overlay.querySelector("#ob-minutes");
    if (minutesInput) minutesInput.addEventListener("input", () => {
      d.readingFormat.dailyMinutes = Number(minutesInput.value);
      this._overlay.querySelector("#ob-minutes-label").textContent = minutesInput.value;
    });
    q("#ob-depth .chip").forEach(c => c.addEventListener("click", () => { d.readingFormat.depth = c.dataset.depth; this.refresh(); }));
    q("#ob-length .chip").forEach(c => c.addEventListener("click", () => { d.readingFormat.lengthPreference = c.dataset.length; this.refresh(); }));
    q("#ob-types .chip").forEach(c => c.addEventListener("click", () => { toggleInArray(d.interests.preferredPaperTypes, c.dataset.ptype); this.refresh(); }));
    q("#ob-feedstyle .chip").forEach(c => c.addEventListener("click", () => { d.feedStyle = c.dataset.feedstyle; this.refresh(); }));

    const back = this._overlay.querySelector("#ob-back");
    if (back) back.addEventListener("click", () => { this.step--; this.refresh(); });

    const next = this._overlay.querySelector("#ob-next");
    next.addEventListener("click", () => {
      if (this.step < this.totalSteps - 1) { this.step++; this.refresh(); }
      else this.finish();
    });
  },

  finish() {
    this.draft.onboardingCompleted = true;
    PROFILE = Object.assign(PROFILE, this.draft);
    persist();
    this.unmount();
    this.reset();
    currentRoute = "home";
    render();
    showToast("¡Bienvenido a PaperStreak! 🎉");
  },
};

function toggleInArray(arr, val) {
  const idx = arr.indexOf(val);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
}

function pickPreviewPaper(draftProfile) {
  const tempProfile = JSON.parse(JSON.stringify(draftProfile));
  const { main } = RecommendationEngine.buildDailyFeed(PAPERS, tempProfile);
  return main ? main.paper : PAPERS[0];
}

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */
async function init() {
  await loadData();
  document.documentElement.setAttribute("data-theme", PROFILE.settings.theme || "light");
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

window.navigate = navigate;
document.addEventListener("DOMContentLoaded", init);
