/* =========================================================
   Configuración pública de PaperStreak.
   No pongas secretos aquí: este archivo es visible en el navegador.
   ========================================================= */

// 1. Ve a https://console.cloud.google.com/apis/credentials
// 2. Crea un "OAuth 2.0 Client ID" de tipo "Web application".
// 3. En "Authorized JavaScript origins" agrega:
//      http://localhost:8080
//      https://TU_USUARIO.github.io
// 4. Copia el Client ID (termina en .apps.googleusercontent.com) abajo.
window.PAPERSTREAK_CONFIG = {
  GOOGLE_CLIENT_ID: "TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
};
