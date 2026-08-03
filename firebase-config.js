/* =========================================================
   Configuración de Firebase — REEMPLAZA estos valores
   ========================================================= */
// 1. Ve a https://console.firebase.google.com/ y crea un proyecto (gratis).
// 2. Dentro del proyecto: Authentication → Sign-in method → habilita "Google".
// 3. En Configuración del proyecto → "Tus apps" → agrega una app Web (</>).
// 4. Copia aquí el objeto firebaseConfig que te entrega Firebase:
const firebaseConfig = {
  apiKey: "AIzaSyBhvlK2d8B6f9ZmBh8-hCnWNdUL2Crvvd8",
  authDomain: "paperstreak-8edf8.firebaseapp.com",
  projectId: "paperstreak-8edf8",
  storageBucket: "paperstreak-8edf8.firebasestorage.app",
  messagingSenderId: "855900368092",
  appId: "1:855900368092:web:bc95c67b9a43b241ac9819",
};

// 5. En Authentication → Settings → "Authorized domains", agrega el dominio
//    donde publiques esta app (ej: tuusuario.github.io) o "localhost" para probar.
