/* =========================================================
   Auth — login real con Google usando Firebase Authentication
   Firebase actúa como el "backend" de autenticación (no hace
   falta que tú operes un servidor propio). El estado de cada
   paper/racha sigue viviendo en localStorage, pero ahora
   separado por usuario (uid de Google).
   ========================================================= */
const Auth = {
  currentUser: null,
  _configured: false,

  init() {
    this._configured = !!(window.firebase && firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REEMPLAZA"));
    if (!this._configured) {
      console.warn("Auth: falta configurar firebase-config.js con las credenciales reales de tu proyecto Firebase.");
      this.renderConfigMissing();
      return;
    }
    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(user => {
      this.currentUser = user;
      if (user) {
        this.onSignedIn(user);
      } else {
        this.renderLoginScreen();
      }
    });
  },

  async signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.error("Error de login con Google", err);
      const box = document.getElementById("auth-error");
      if (box) box.textContent = "No se pudo iniciar sesión: " + (err.message || err.code || "error desconocido");
    }
  },

  signOut() {
    firebase.auth().signOut();
  },

  onSignedIn(user) {
    // Namespacea el storage por usuario para que cada cuenta de Google
    // tenga su propio perfil, racha y XP.
    STORAGE_KEY = `paperstreak:profile:v1:${user.uid}`;
    PROFILE = Store.load();
    document.getElementById("auth-gate")?.remove();
    document.getElementById("app-shell").style.display = "";
    init();
  },

  renderLoginScreen() {
    document.getElementById("app-shell").style.display = "none";
    let gate = document.getElementById("auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "auth-gate";
      document.body.appendChild(gate);
    }
    gate.innerHTML = `
      <div class="auth-card">
        <div class="brand"><span class="dot"></span> PaperStreak</div>
        <p>Inicia sesión con tu cuenta de Google para guardar tu racha, tu XP y tus notas.</p>
        <button class="btn btn-primary" id="google-signin-btn">Continuar con Google</button>
        <p id="auth-error" class="auth-error"></p>
      </div>
    `;
    document.getElementById("google-signin-btn").addEventListener("click", () => this.signInWithGoogle());
  },

  renderConfigMissing() {
    document.getElementById("app-shell").style.display = "none";
    let gate = document.getElementById("auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "auth-gate";
      document.body.appendChild(gate);
    }
    gate.innerHTML = `
      <div class="auth-card">
        <div class="brand"><span class="dot"></span> PaperStreak</div>
        <p><strong>El login con Google todavía no está configurado.</strong></p>
        <p>Edita <code>firebase-config.js</code> con las credenciales de tu propio proyecto de Firebase
        (Authentication → Sign-in method → Google) y recarga la página.</p>
      </div>
    `;
  },
};

document.addEventListener("DOMContentLoaded", () => Auth.init());
