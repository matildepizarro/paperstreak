/* =========================================================
   Configuración de Firebase — REEMPLAZA estos valores
   ========================================================= */
// 1. Ve a https://console.firebase.google.com/ y crea un proyecto (gratis).
// 2. Dentro del proyecto: Authentication → Sign-in method → habilita "Google".
// 3. En Configuración del proyecto → "Tus apps" → agrega una app Web (</>).
// 4. Copia aquí el objeto firebaseConfig que te entrega Firebase:
const firebaseConfig = {
  apiKey: "REEMPLAZA_apiKey",
  authDomain: "REEMPLAZA_authDomain.firebaseapp.com",
  projectId: "REEMPLAZA_projectId",
  storageBucket: "REEMPLAZA_projectId.appspot.com",
  messagingSenderId: "REEMPLAZA_messagingSenderId",
  appId: "REEMPLAZA_appId",
};

// 5. En Authentication → Settings → "Authorized domains", agrega el dominio
//    donde publiques esta app (ej: tuusuario.github.io) o "localhost" para probar.
