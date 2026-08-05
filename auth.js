/* =========================================================
   Auth — login OPCIONAL con Google (Firebase Authentication)
   para sincronizar el progreso entre dispositivos.

   IMPORTANTE (rediseño): esto ya NO bloquea la app. Antes, la
   app entera quedaba oculta hasta que el login con Google
   terminara con éxito — si Firebase no estaba configurado, si
   el popup se bloqueaba, si el dominio no estaba autorizado, o
   si simplemente no había conexión, la persona se quedaba
   viendo una pantalla vacía sin ningún paper ni selector de
   temas, sin ningún mensaje claro de qué pasaba.

   Ahora: la app (app.js → init()) arranca sola en cuanto carga
   la página, usando localStorage. Este archivo solo agrega un
   botón opcional en Ajustes ("Sincronización") para conectar
   una cuenta de Google si la persona quiere respaldar su
   progreso o usarlo en más de un dispositivo. Si algo de esto
   falla, la app sigue funcionando igual en modo local.
   ========================================================= */
const Auth = {
  currentUser: null,
  configured: false,
  db: null,
  status: "idle", // idle | signing-in | signed-in | error | unconfigured
  lastError: null,
  _syncTimer: null,
  _unsubscribeCloud: null,

  init() {
    this.configured = !!(
      window.firebase && typeof firebaseConfig !== "undefined" &&
      firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REEMPLAZA")
    );
    if (!this.configured) {
      this.status = "unconfigured";
      console.info("Auth: sincronización con Google no configurada (firebase-config.js). La app funciona igual en modo local.");
      return;
    }
    try {
      firebase.initializeApp(firebaseConfig);
      this.db = firebase.firestore();
      firebase.auth().onAuthStateChanged(user => {
        this.currentUser = user;
        if (user) {
          this.status = "signed-in";
          this.onSignedIn(user);
        } else {
          this.status = "idle";
          if (this._unsubscribeCloud) { this._unsubscribeCloud(); this._unsubscribeCloud = null; }
          if (typeof render === "function") render();
        }
      });
    } catch (err) {
      // Si el SDK de Firebase no llegó a cargar (bloqueado por la red, sin
      // internet al momento de cargar la página, etc.) no rompemos nada:
      // seguimos en modo local.
      this.status = "error";
      this.lastError = err;
      console.warn("Auth: no se pudo inicializar Firebase, la app sigue en modo local.", err);
    }
  },

  async signInWithGoogle() {
    if (!this.configured) return;
    this.status = "signing-in";
    this.lastError = null;
    if (typeof render === "function") render();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.error("Error de login con Google", err);
      this.status = "error";
      this.lastError = err.message || err.code || "No se pudo iniciar sesión.";
      if (typeof render === "function") render();
    }
  },

  signOut() {
    if (this.db && this._unsubscribeCloud) { this._unsubscribeCloud(); this._unsubscribeCloud = null; }
    if (window.firebase && firebase.auth) firebase.auth().signOut();
    this.status = "idle";
  },

  async onSignedIn(user) {
    // Namespacea el storage local por usuario (caché offline) y fusiona
    // con lo que haya en la nube, sin perder progreso local si la nube
    // está vacía o desactualizada.
    STORAGE_KEY = `paperstreak:profile:v1:${user.uid}`;
    const local = Store.load();

    let cloud = null;
    try {
      const doc = await this.db.collection("profiles").doc(user.uid).get();
      if (doc.exists) cloud = doc.data();
    } catch (e) {
      console.warn("No se pudo leer el progreso en la nube (¿sin conexión?). Se sigue usando la copia local.", e);
    }

    const merged = this.mergeProfiles(local, cloud);
    PROFILE = Object.assign(Store.defaultProfile(), merged);
    Store.save(PROFILE);

    if (typeof render === "function") render();
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

  // Pequeño bloque para Ajustes — reemplaza a la antigua pantalla completa
  // que tapaba toda la app. Se usa desde renderSettings() en app.js.
  renderSettingsBlock() {
    if (!this.configured) {
      return `
        <div class="settings-group">
          <h3>Sincronización</h3>
          <p class="field-hint">No configurada. Tu progreso se guarda igual en este dispositivo (localStorage).</p>
        </div>
      `;
    }
    if (this.status === "signed-in" && this.currentUser) {
      return `
        <div class="settings-group">
          <h3>Sincronización</h3>
          <p class="field-hint">Conectado como ${this.currentUser.email || this.currentUser.displayName || "usuario de Google"}. Tu progreso se respalda automáticamente.</p>
          <button class="btn" id="auth-signout-btn">Cerrar sesión</button>
        </div>
      `;
    }
    const errorHtml = this.lastError ? `<p class="auth-error">${this.lastError}</p>` : "";
    return `
      <div class="settings-group">
        <h3>Sincronización</h3>
        <p class="field-hint">Tu progreso ya se guarda en este dispositivo. Conecta Google si quieres respaldarlo o usarlo en más de un dispositivo (opcional).</p>
        <button class="btn btn-primary" id="auth-signin-btn" ${this.status === "signing-in" ? "disabled" : ""}>
          ${this.status === "signing-in" ? "Conectando…" : "Conectar con Google"}
        </button>
        ${errorHtml}
      </div>
    `;
  },
  attachSettingsEvents() {
    const signIn = document.getElementById("auth-signin-btn");
    if (signIn) signIn.addEventListener("click", () => this.signInWithGoogle());
    const signOut = document.getElementById("auth-signout-btn");
    if (signOut) signOut.addEventListener("click", () => this.signOut());
  },
};

document.addEventListener("DOMContentLoaded", () => Auth.init());
