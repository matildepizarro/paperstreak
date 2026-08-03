/* =========================================================
   Auth — login real con Google (Firebase Authentication) +
   sincronización del progreso entre dispositivos (Firestore).
   Cada usuario de Google tiene un documento propio
   profiles/{uid} en la nube. localStorage sigue existiendo
   como caché rápida/offline, pero Firestore es la fuente de
   verdad cuando hay conexión.
   ========================================================= */
const Auth = {
  currentUser: null,
  _configured: false,
  db: null,
  _syncTimer: null,
  _unsubscribeCloud: null,

  init() {
    this._configured = !!(window.firebase && firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REEMPLAZA"));
    if (!this._configured) {
      console.warn("Auth: falta configurar firebase-config.js con las credenciales reales de tu proyecto Firebase.");
      this.renderConfigMissing();
      return;
    }
    firebase.initializeApp(firebaseConfig);
    this.db = firebase.firestore();
    firebase.auth().onAuthStateChanged(user => {
      this.currentUser = user;
      if (user) {
        this.onSignedIn(user);
      } else {
        if (this._unsubscribeCloud) { this._unsubscribeCloud(); this._unsubscribeCloud = null; }
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

  async onSignedIn(user) {
    // Namespacea el storage local por usuario (caché offline).
    STORAGE_KEY = `paperstreak:profile:v1:${user.uid}`;
    const local = Store.load();

    let cloud = null;
    try {
      const doc = await this.db.collection("profiles").doc(user.uid).get();
      if (doc.exists) cloud = doc.data();
    } catch (e) {
      console.warn("No se pudo leer el progreso en la nube (¿sin conexión?). Se usa la copia local.", e);
    }

    PROFILE = this.mergeProfiles(local, cloud);
    Store.save(PROFILE);

    document.getElementById("auth-gate")?.remove();
    document.getElementById("app-shell").style.display = "";
    await init();

    this.pushToCloud(PROFILE); // asegura que la nube tenga la versión fusionada
    this.startCloudListener(user.uid);
  },

  // Si hay datos en ambos lados, gana el más reciente (según updatedAt).
  // Si el perfil local nunca completó onboarding, se prioriza la nube
  // (típico caso: la persona ya usaba la app en otro dispositivo).
  mergeProfiles(local, cloud) {
    if (!cloud) return local;
    if (!local || !local.onboardingCompleted) return cloud;
    const localTs = local.updatedAt || 0;
    const cloudTs = cloud.updatedAt || 0;
    return cloudTs > localTs ? cloud : local;
  },

  // Escucha cambios en tiempo real: si el usuario abre PaperStreak en otro
  // dispositivo y lee un paper allá, este dispositivo también se actualiza.
  startCloudListener(uid) {
    if (this._unsubscribeCloud) this._unsubscribeCloud();
    this._unsubscribeCloud = this.db.collection("profiles").doc(uid).onSnapshot(doc => {
      if (!doc.exists) return;
      const cloud = doc.data();
      if ((cloud.updatedAt || 0) > (PROFILE.updatedAt || 0)) {
        PROFILE = cloud;
        Store.save(PROFILE);
        if (typeof render === "function") render();
        if (typeof showToast === "function") showToast("Progreso sincronizado desde otro dispositivo");
      }
    }, err => console.warn("Listener de Firestore falló", err));
  },

  // Debounced: evita escribir en Firestore en cada tecla/click.
  queueCloudSync(profile) {
    if (!this.currentUser || !this.db) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.pushToCloud(profile), 1200);
  },

  async pushToCloud(profile) {
    if (!this.currentUser || !this.db) return;
    try {
      await this.db.collection("profiles").doc(this.currentUser.uid).set(profile);
    } catch (e) {
      console.warn("No se pudo sincronizar el progreso con la nube", e);
    }
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
        <p>Inicia sesión con tu cuenta de Google para guardar tu racha, tu XP y tus notas, sincronizados en todos tus dispositivos.</p>
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
