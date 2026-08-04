/* =========================================================
   Utilidades compartidas.

   fetchWithTimeout: envuelve fetch() con un límite de tiempo real.
   Sin esto, si una API externa (Europe PMC, arXiv, Semantic Scholar)
   se queda "colgada" sin responder ni fallar, la promesa nunca se
   resuelve y Promise.all() en Catalog.build espera para siempre:
   la persona se queda mirando el spinner sin que ningún fallback
   (ni el catálogo local) llegue a activarse. Con esto, cada pedido
   tiene un plazo máximo y, si se pasa, se aborta y se trata como
   una fuente que falló (lo cual ya está contemplado en todos lados
   con .catch(() => [])).
   ========================================================= */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
window.fetchWithTimeout = fetchWithTimeout;
