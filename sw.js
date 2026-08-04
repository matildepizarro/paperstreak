/* CACHE_NAME sube de versión con cada cambio relevante en los archivos
   estáticos. Al cambiar, el navegador detecta que sw.js es distinto,
   instala esta versión nueva, borra la caché vieja (ver "activate" más
   abajo) y así una actualización de la app SIEMPRE llega a quien la usa,
   en vez de quedar atascada sirviendo JS desactualizado para siempre. */
const CACHE_NAME = "paperstreak-cache-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./util.js",
  "./app.js",
  "./auth.js",
  "./game.js",
  "./europepmc.js",
  "./arxiv.js",
  "./semanticscholar.js",
  "./local-catalog.js",
  "./sources.js",
  "./firebase-config.js",
  "./manifest.json",
  "./data/topics.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Estrategia "network-first": para archivos propios de la app, siempre se
   intenta traer la versión más nueva de la red primero, y solo si eso
   falla (sin conexión) se usa lo último guardado en caché. Así la persona
   siempre ve el código actualizado cuando tiene internet, y la app sigue
   funcionando offline cuando no. (Antes era "cache-first": una vez
   guardado un archivo, se servía esa misma copia para siempre y nunca se
   volvía a pedir a la red, aunque la app se actualizara.) */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Las llamadas a APIs externas (Europe PMC, arXiv, Semantic Scholar,
  // Firebase) nunca deben servirse desde cache: necesitamos siempre el
  // paper/estado real.
  const isSameOrigin = new URL(event.request.url).origin === self.location.origin;
  if (!isSameOrigin) return; // deja pasar directo a la red

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
