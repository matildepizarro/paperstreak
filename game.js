/* =========================================================
   PaperGame — "Adivina el paper del día"
   Inspirado en Wordle / Spotle / Bandle / Dialed: cada día hay
   UN paper objetivo (sacado de tu propio catálogo, según tus
   temas), oculto detrás de pistas que se van revelando. Tienes
   6 intentos: buscas y eliges un paper candidato, y el juego te
   dice qué tan "cerca" está de la respuesta (tema, año, tipo,
   dificultad, fuente) además de revelar más del resumen.
   Todo el estado vive en PROFILE.game (localStorage).
   ========================================================= */
const PaperGame = {
  MAX_ATTEMPTS: 6,
  MIN_ABSTRACT_WORDS: 30,

  /* ---------- Selección determinística del paper del día ---------- */
  hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  },

  eligiblePapers() {
    return (PAPERS || []).filter(p => {
      const words = (p.abstract || "").split(/\s+/).filter(Boolean).length;
      return words >= this.MIN_ABSTRACT_WORDS && p.title && p.title !== "Sin título";
    });
  },

  pickDailyPaper(dateStr) {
    const pool = this.eligiblePapers();
    if (pool.length === 0) return null;
    const sorted = pool.slice().sort((a, b) => a.id.localeCompare(b.id)); // orden estable
    const idx = this.hashStr(dateStr) % sorted.length;
    return sorted[idx];
  },

  /* ---------- Estado del juego (persistido en el perfil) ---------- */
  ensureTodayGame() {
    const today = todayStr();
    if (!PROFILE.game || PROFILE.game.date !== today) {
      const paper = this.pickDailyPaper(today);
      PROFILE.game = {
        date: today,
        paperId: paper ? paper.id : null,
        guesses: [],       // array de ids adivinados
        solved: null,       // true / false / null (en curso)
        finishedAt: null,
      };
      persist();
    }
    return PROFILE.game;
  },

  targetPaper() {
    const game = this.ensureTodayGame();
    if (!game.paperId) return null;
    return (PAPERS || []).find(p => p.id === game.paperId) || null;
  },

  topicCategory(topicId) {
    const t = (TOPICS || []).find(x => x.id === topicId);
    return t ? t.category : null;
  },

  /* Compara un candidato contra el objetivo y devuelve una fila de pistas */
  compare(candidate, target) {
    const topicHit = candidate.topics[0] === target.topics[0]
      ? "hit" : (this.topicCategory(candidate.topics[0]) === this.topicCategory(target.topics[0]) ? "close" : "miss");

    const yearDiff = Math.abs((candidate.year || 0) - (target.year || 0));
    const yearHit = yearDiff === 0 ? "hit" : yearDiff <= 1 ? "close" : "miss";

    const typeHit = candidate.paperType === target.paperType ? "hit" : "miss";
    const difficultyHit = candidate.difficulty === target.difficulty ? "hit" : "miss";
    const sourceHit = candidate.provider === target.provider ? "hit" : "miss";

    return {
      candidate,
      topic: { status: topicHit, label: topicLabel(candidate.topics[0]) },
      year: { status: yearHit, label: String(candidate.year), arrow: candidate.year < target.year ? "▲" : candidate.year > target.year ? "▼" : "" },
      type: { status: typeHit, label: capitalize(candidate.paperType) },
      difficulty: { status: difficultyHit, label: capitalize(candidate.difficulty) },
      source: { status: sourceHit, label: candidate.source },
      correct: candidate.id === target.id,
    };
  },

  /* Cuánto del abstract revelar según el número de intentos usados */
  revealedAbstract(target, attemptsUsed) {
    const words = target.abstract.split(/\s+/).filter(Boolean);
    const fraction = Math.min(1, 0.18 + attemptsUsed * 0.16);
    const cut = Math.max(8, Math.round(words.length * fraction));
    const shown = words.slice(0, cut).join(" ");
    return attemptsUsed >= this.MAX_ATTEMPTS || cut >= words.length ? target.abstract : shown + " […]";
  },

  submitGuess(paperId) {
    const game = this.ensureTodayGame();
    if (game.solved !== null) return; // ya terminó
    if (game.guesses.includes(paperId)) return; // ya lo intentó

    const target = this.targetPaper();
    if (!target) return;

    game.guesses.push(paperId);

    if (paperId === target.id) {
      game.solved = true;
      game.finishedAt = Date.now();
      this.onWin(game.guesses.length);
    } else if (game.guesses.length >= this.MAX_ATTEMPTS) {
      game.solved = false;
      game.finishedAt = Date.now();
      this.onLose();
    }
    persist();
  },

  onWin(attemptsUsed) {
    const xp = Math.max(15, 65 - (attemptsUsed - 1) * 10);
    Gamification.addXp(PROFILE, xp);
    const s = PROFILE.stats;
    s.gameStreak = (s.gameStreak || 0) + 1;
    s.maxGameStreak = Math.max(s.maxGameStreak || 0, s.gameStreak);
    s.gamesWon = (s.gamesWon || 0) + 1;
    s.gamesPlayed = (s.gamesPlayed || 0) + 1;
    Gamification.checkNewAchievements(PROFILE);
  },

  onLose() {
    const s = PROFILE.stats;
    s.gameStreak = 0;
    s.gamesPlayed = (s.gamesPlayed || 0) + 1;
  },

  /* ---------- Render ---------- */
  render() {
    const game = this.ensureTodayGame();
    const target = this.targetPaper();

    if (!target) {
      return `<div class="container"><div class="empty-state">
        <h2>Aún no hay papers suficientes para jugar</h2>
        <p>Vuelve a "Hoy" para que se cargue tu catálogo, o elige más temas en Ajustes.</p>
        <button class="btn btn-primary" data-route="home">Ir a Hoy</button>
      </div></div>`;
    }

    const attemptsUsed = game.guesses.length;
    const finished = game.solved !== null;
    const abstractShown = this.revealedAbstract(target, finished ? this.MAX_ATTEMPTS : attemptsUsed);
    const rows = game.guesses.map(id => {
      const c = (PAPERS || []).find(p => p.id === id) || { id, title: id, topics: [], year: "?", paperType: "?", difficulty: "?", source: "?", provider: "?" };
      return this.compare(c, target);
    });

    const s = PROFILE.stats;

    return `
      <div class="container game-container">
        <div class="hero-header">
          <h1>🧩 Adivina el paper del día</h1>
          <p>Tienes ${this.MAX_ATTEMPTS} intentos. Cada intento revela más del resumen y te dice qué tan cerca estás.</p>
        </div>

        <div class="game-stats-row">
          <div class="streak-pill" title="Racha de juego">🔥 ${s.gameStreak || 0}</div>
          <div class="streak-pill" title="Mejor racha">🏆 ${s.maxGameStreak || 0}</div>
          <div class="streak-pill" title="Ganados">✅ ${s.gamesWon || 0}/${s.gamesPlayed || 0}</div>
          <div class="streak-pill" title="Intento">🎯 ${Math.min(attemptsUsed, this.MAX_ATTEMPTS)}/${this.MAX_ATTEMPTS}</div>
        </div>

        <div class="game-clue-card">
          <h3>Resumen (parcial)</h3>
          <p class="game-abstract">${escapeHtml(abstractShown)}</p>
        </div>

        ${!finished ? `
          <div class="game-guess-box">
            <input type="text" id="game-search" class="topic-picker-search" placeholder="Busca por título de paper…" autocomplete="off">
            <div id="game-suggestions" class="game-suggestions"></div>
          </div>
        ` : ""}

        <div class="game-rows">
          ${rows.map((r, i) => this.renderRow(r, i)).join("")}
        </div>

        ${finished ? this.renderResult(game, target, rows) : ""}
      </div>
    `;
  },

  renderRow(r, i) {
    const cellClass = s => s === "hit" ? "hit" : s === "close" ? "close" : "miss";
    return `
      <div class="game-row ${r.correct ? "correct" : ""}">
        <div class="game-row-title">${i + 1}. ${escapeHtml(r.candidate.title)}</div>
        <div class="game-cells">
          <div class="game-cell ${cellClass(r.topic.status)}" title="Tema">${r.topic.label}</div>
          <div class="game-cell ${cellClass(r.year.status)}" title="Año">${r.year.label} ${r.year.arrow}</div>
          <div class="game-cell ${cellClass(r.type.status)}" title="Tipo de artículo">${r.type.label}</div>
          <div class="game-cell ${cellClass(r.difficulty.status)}" title="Dificultad">${r.difficulty.label}</div>
          <div class="game-cell ${cellClass(r.source.status)}" title="Fuente">${r.source.label}</div>
        </div>
      </div>
    `;
  },

  renderResult(game, target, rows) {
    const grid = rows.map(r => r.correct ? "🟩🟩🟩🟩🟩" :
      [r.topic, r.year, r.type, r.difficulty, r.source].map(c => c.status === "hit" ? "🟩" : c.status === "close" ? "🟨" : "⬜").join("")
    ).join("\n");
    return `
      <div class="game-result ${game.solved ? "won" : "lost"}">
        <h3>${game.solved ? "🎉 ¡Lo lograste!" : "😅 Se acabaron los intentos"}</h3>
        <p><b>${escapeHtml(target.title)}</b></p>
        <p class="game-result-meta">${(target.authors || []).slice(0, 3).join(", ")} · ${target.year} · ${target.journal || target.source}</p>
        <a href="${target.openAccessUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Ver paper completo</a>
        <button class="btn btn-primary btn-sm" id="game-share-btn">Compartir resultado</button>
        <pre class="game-share-preview">PaperStreak 🧩 ${game.date} — ${game.solved ? `${game.guesses.length}/${this.MAX_ATTEMPTS}` : `X/${this.MAX_ATTEMPTS}`}\n${grid}</pre>
      </div>
    `;
  },

  attachEvents() {
    const input = document.getElementById("game-search");
    const box = document.getElementById("game-suggestions");
    const game = this.ensureTodayGame();

    if (input && box) {
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { box.innerHTML = ""; return; }
        const already = new Set(game.guesses);
        const matches = (PAPERS || [])
          .filter(p => !already.has(p.id) && p.title.toLowerCase().includes(q))
          .slice(0, 8);
        box.innerHTML = matches.map(p => `
          <button type="button" class="game-suggestion" data-guess="${p.id}">
            ${escapeHtml(p.title)} <span class="game-suggestion-meta">(${p.year})</span>
          </button>
        `).join("") || `<div class="game-suggestion game-suggestion-empty">Sin coincidencias en tu catálogo actual</div>`;
        box.querySelectorAll("[data-guess]").forEach(btn => {
          btn.addEventListener("click", () => {
            this.submitGuess(btn.dataset.guess);
            render();
          });
        });
      });
    }

    const shareBtn = document.getElementById("game-share-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        const pre = document.querySelector(".game-share-preview");
        const text = pre ? pre.textContent : "";
        if (navigator.clipboard && text) {
          navigator.clipboard.writeText(text).then(() => showToast("Resultado copiado 📋"));
        } else {
          showToast("No se pudo copiar automáticamente");
        }
      });
    }

    document.querySelectorAll("[data-route]").forEach(btn => {
      btn.addEventListener("click", () => navigate(btn.dataset.route));
    });
  },
};
