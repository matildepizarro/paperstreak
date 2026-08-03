# PaperStreak — Ciencia real, todos los días

Web app (HTML/CSS/JS puro) que ayuda a formar el hábito de leer papers científicos reales de acceso abierto, con onboarding guiado, recomendación diaria, lectura in-app del texto completo, quiz de comprensión y gamificación.

## ⚠️ Antes de usarla: configura el login con Google

Esta versión requiere iniciar sesión con Google (vía Firebase Authentication) y ya NO
usa datos de ejemplo/mock: busca papers reales y abiertos en la API pública de
**Europe PMC** en tiempo real.

1. Crea un proyecto gratis en https://console.firebase.google.com/
2. Dentro del proyecto: **Authentication → Sign-in method → habilita "Google"**.
3. **Configuración del proyecto → Tus apps → agrega una app Web**, y copia el objeto
   `firebaseConfig` que te entrega dentro de `firebase-config.js`.
4. En **Authentication → Settings → Authorized domains**, agrega el dominio donde
   publiques la app (o `localhost` para probar en tu máquina).
5. Sirve la carpeta con un servidor estático (ej. `npx serve` o GitHub Pages) — el
   login con Google no funciona abriendo `index.html` con `file://`.

Sin este paso, la app muestra una pantalla explicando que falta configurar Firebase
en vez de romperse silenciosamente.

## Papers reales, no simulados

`data/papers.json` (el catálogo mock de 30 papers) ya no se usa para armar el feed.
`europepmc.js` consulta la API REST pública de Europe PMC
(`https://www.ebi.ac.uk/europepmc/webservices/rest/search`) filtrando por
`OPEN_ACCESS:Y`, según los temas de interés elegidos en el onboarding, y guarda el
resultado en caché local por 12 horas. Cada tarjeta enlaza a la página real del
artículo en Europe PMC (o a su DOI), así que nunca debería llevar a una fuente
inexistente.

## Progreso sincronizado entre dispositivos (Firestore)

El progreso (racha, XP, papers leídos, notas) ya no vive solo en el navegador:
cada usuario de Google tiene un documento propio en Cloud Firestore
(`profiles/{uid}`). `auth.js` lo guarda ahí en cada cambio (con un pequeño
debounce) y escucha cambios en tiempo real, así que si lees un paper en el
celular y luego abres PaperStreak en la computadora, ves la racha actualizada.
localStorage sigue existiendo como caché rápida y para funcionar offline.

**Paso obligatorio en la consola de Firebase para que esto funcione:**

1. Ve a **Build → Firestore Database → Crear base de datos**. Elige modo
   "producción" y la región que prefieras.
2. En la pestaña **Reglas**, reemplaza el contenido por esto, para que cada
   persona solo pueda leer/escribir su propio perfil:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /profiles/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Clic en **"Publicar"**.

Sin este paso, Firestore rechaza todas las lecturas/escrituras por defecto (modo
producción) y el progreso no se sincronizará — la app seguirá funcionando con la
copia local del navegador como respaldo.

## Lectura del texto completo, no resúmenes

El lector (`renderReader`) ya no reescribe el abstract como "resumen breve" ni
inventa "puntos clave" o "términos difíciles". Muestra el abstract real del
artículo y, cuando Europe PMC tiene indexado el texto completo (`fullTextXML`,
disponible para el subconjunto de artículos PMC de acceso abierto), lo renderiza
completo dentro de la app. Si Europe PMC no distribuye el texto completo para ese
artículo en particular, se lo dice explícitamente al usuario y ofrece el enlace
directo a la fuente original — nunca genera un resumen como sustituto.

## 1. Visión del producto

PaperStreak es "Duolingo para papers": cada día la app elige **un** artículo científico de acceso público publicado en los últimos 18 meses, relevante para los intereses del usuario, y lo entrega listo para leer en pocos minutos, con contexto ("por qué te lo recomendamos"), preguntas de comprensión y recompensas (XP, racha, logros). El objetivo es la constancia, no el volumen.

## 2. Arquitectura

- **Sin build step obligatorio**: HTML/CSS/JS vanilla, se sirve directo desde GitHub Pages.
- **Single Page App casera**: un router mínimo (`navigate(route)`) cambia `innerHTML` de `#view` según el estado.
- **Estado**: un objeto `PROFILE` en memoria, sincronizado con `localStorage` (`Store.save/load`) en cada mutación.
- **Datos**: `data/papers.json` (mock, 30 papers) y `data/topics.json` (taxonomía de áreas). Se cargan con `fetch` al iniciar.
- **Motor de recomendación**: módulo `RecommendationEngine`, puro y determinista dado el perfil + catálogo de papers (ver sección 6).
- **Gamificación**: módulo `Gamification` (XP, rachas, logros).
- **Onboarding**: módulo `Onboarding`, wizard de 5 pasos, overlay modal, guarda un "draft" hasta confirmar.
- **PWA opcional**: `manifest.json` + `sw.js` cachean el shell para uso offline básico.

No hay backend porque no hace falta: todo el ranking se calcula en el cliente sobre el JSON local, y la persistencia de usuario es 100% local.

## 3. Árbol de archivos

```
paperstreak/
├── index.html
├── styles.css
├── app.js
├── manifest.json
├── icon.svg
├── sw.js
├── README.md
└── data/
    ├── papers.json
    ├── topics.json
    └── sample-profile.json
```

## 4. Cómo funciona el onboarding

1. **Bienvenida**: explica qué hace la app, cuánto toma leer al día y que todo se guarda localmente.
2. **Intereses**: áreas principales, temas excluidos, idioma, nivel de lectura.
3. **Formato de lectura**: minutos diarios (slider), profundidad, longitud, tipos de paper preferidos.
4. **Estilo del feed**: destacado / reciente / variar / fácil / exigente — esto ajusta pesos y bonus en el motor de recomendación.
5. **Cierre**: resumen visual de las preferencias elegidas + preview del primer paper que se recomendaría (usa el motor real contra el catálogo mock).

Al confirmar, `Onboarding.finish()` copia el "draft" al `PROFILE` real, marca `onboardingCompleted = true`, persiste y nunca vuelve a mostrarse salvo que el usuario pulse "Reiniciar tour" en Ajustes.

## 5. Motor de recomendación

`RecommendationEngine.scorePaper(paper, profile)` calcula un score 0–1 (o `-1` si el paper queda descartado por reglas duras) combinando:

| Factor | Peso | Qué mide |
|---|---|---|
| Afinidad temática | 0.30 | Cuántos temas del paper coinciden con `interests.mainTopics` |
| Recencia | 0.15 | Mezcla de `recencyScore` del mock y antigüedad real en meses |
| Calidad / impacto | 0.15 | `qualitySignals`, señales de citación, flag `featured` |
| Accesibilidad | 0.15 | Ajuste dificultad↔nivel del usuario + tiempo de lectura vs meta diaria |
| Novedad | 0.15 | Penaliza papers ya leídos/vistos, premia diversidad si el usuario eligió "variar temas" |
| Tipo de artículo preferido | 0.10 | Coincidencia con `preferredPaperTypes` |

**Reglas duras (excluyen el paper, score = -1):**
- No es `isOpenAccess`.
- Antigüedad estimada > 18 meses (`monthsSincePublication`).
- Su tema está en `excludedTopics`.

El estilo de feed elegido en onboarding añade un pequeño bonus adicional (`styleBoost`) sin romper la transparencia del cálculo. El feed diario (`ensureDailyFeed`) ordena todos los papers válidos por score, toma el primero como principal y los siguientes 3 como alternativas, y **persiste esa elección por día** (no se recalcula en cada render, solo al cambiar de día o al pulsar "Posponer").

`RecommendationEngine.reasonText()` traduce el desglose del score a una frase legible ("Este paper fue elegido porque...") que se muestra en la tarjeta principal.

Extender el motor es directo: agregar un factor nuevo implica sumar una clave a `weights`, calcular su valor en `scorePaper` y sumarlo a la fórmula final.

## 6. Persistencia local

Todo vive bajo la key `paperstreak:profile:v1` en `localStorage`, como un único objeto JSON:

```js
{
  onboardingCompleted, interests, readingFormat, feedStyle,
  stats: { xp, level, currentStreak, maxStreak, papersRead, papersSaved,
           papersSeen, papersPostponed, topicMastery, weeklyHistory,
           achievements, lastAccessDate, notes, quizResults },
  settings: { theme },
  currentFeed: { date, mainId, altIds }
}
```

- `Store.load()` hace merge con un perfil por defecto, así que agregar campos nuevos en el futuro no rompe datos existentes.
- `Store.exportData()` descarga un `.json` de respaldo; `Store.importData()` lo restaura.
- El botón "Resetear" en Ajustes borra la key completa y regenera el perfil por defecto.
- Se eligió `localStorage` (no IndexedDB) porque el volumen de datos por usuario es pequeño (perfil + arrays de IDs), y mantiene el código simple para un MVP estático. Si el catálogo de papers creciera mucho (miles de registros) o se necesitara indexar full-text, IndexedDB sería la migración natural — la capa `Store` está aislada precisamente para facilitar ese cambio sin tocar el resto de la app.

## 7. Cómo correr localmente

No requiere `npm install`. Basta un servidor estático simple (por `fetch` de JSON, no funciona con `file://`):

```bash
cd paperstreak
python3 -m http.server 8080
# abrir http://localhost:8080
```

o con Node:

```bash
npx serve .
```

## 8. Deploy en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `paperstreak`.
2. Dentro de la carpeta `paperstreak/`:
   ```bash
   git init
   git add .
   git commit -m "PaperStreak MVP"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/paperstreak.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**.
4. Selecciona rama `main` y carpeta `/ (root)`. Guarda.
5. Espera 1–2 minutos; la app quedará disponible en `https://TU_USUARIO.github.io/paperstreak/`.
6. Si usas un dominio propio, agrega un archivo `CNAME` con el dominio en la raíz del repo.

No hay variables de entorno ni claves que configurar para el MVP: todo funciona con los JSON locales.

## 9. Cómo reemplazar el mock por datos reales

La capa de datos está aislada en `loadData()` (fetch a `data/papers.json`). Para conectar fuentes reales sin reescribir la UI ni el motor de recomendación:

1. Crea un módulo `dataSources.js` con funciones async que devuelvan arrays de papers **normalizados al mismo shape** que usa `papers.json` (mismos campos: `id, title, authors, year, journal, abstract, topics, paperType, difficulty, estimatedMinutes, openAccessUrl, pdfUrl, isOpenAccess, recencyScore, qualitySignals, citationSignals, featuredFlag`).
2. Fuentes recomendadas sin necesidad de API key (aptas para sitio estático):
   - **Europe PMC REST API** (`https://www.ebi.ac.uk/europepmc/webservices/rest/search`) — acceso abierto, sin key.
   - **Crossref API** (`https://api.crossref.org/works`) — sin key, buen soporte de filtros por fecha y licencia OA.
   - **OpenAlex** (`https://api.openalex.org/works`) — sin key, incluye señal de citas y OA status.
   - **arXiv API** — sin key, ideal para IA/física/matemáticas.
   - **Unpaywall** (requiere email como parámetro, no key secreta) — para verificar acceso abierto real de un DOI.
3. Semantic Scholar y PubMed/Entrez permiten uso sin key con límites de tasa bajos; si se agregan, deja el llamado detrás de un `try/catch` con fallback al mock, y documenta cómo añadir una key opcional vía variable de build (nunca hardcodeada en el repo).
4. En `loadData()`, reemplaza (o combina) el `fetch("data/papers.json")` por llamadas a estas APIs, normaliza la respuesta, y cachea el resultado en `localStorage` (p. ej. `paperstreak:papers-cache`) con una fecha de expiración de 24h para no golpear las APIs en cada carga.
5. El `RecommendationEngine` no necesita cambios: solo espera el array `PAPERS` con esos campos.

## 10. Cómo expandir el ranking y la recomendación

- Ajusta pesos en `RecommendationEngine.weights` para experimentar (ideal para un futuro panel de "modo debug" que muestre el `breakdown` crudo).
- Agrega nuevas señales (ej. "tiempo desde la última vez que el usuario leyó ese tema" para espaciar repaso) sumando un factor más a `scorePaper`.
- Para introducir **co-lectura social** (qué leen otros usuarios), se necesitaría un backend ligero o un servicio serverless — hoy el diseño es intencionalmente single-user y local-first.
- Para historial más largo/analítica más fina, considera migrar `stats` de `localStorage` a IndexedDB (ver sección 6).

## 11. Mejoras futuras

- Integración real y cacheada con Europe PMC / OpenAlex / Crossref.
- Modo "repaso espaciado" para temas con baja retención en el quiz.
- Panel de administración local para curar/editar el catálogo mock.
- Notificaciones push (via Web Push, requiere un pequeño backend o servicio tipo OneSignal) para recordar la racha.
- Compartir logros como imagen generada en canvas.
- Soporte multi-perfil en el mismo navegador (ej. familia o clase).
- Sincronización opcional entre dispositivos vía un backend mínimo (Supabase/Firebase) — opcional y desacoplado del modo local-first.

## 12. Riesgos técnicos y cómo se resuelven

| Riesgo | Mitigación |
|---|---|
| `localStorage` se borra (usuario limpia caché) | Botón de exportar/importar backup manual; se puede añadir recordatorio periódico de exportar. |
| APIs públicas cambian de esquema o caen | Capa `dataSources.js` aislada + fallback automático al mock JSON local. |
| Catálogo mock pequeño limita variedad real | Arquitectura de scoring ya soporta cualquier volumen de papers; solo se necesita más data, no más código. |
| CORS al llamar APIs externas desde el navegador | Europe PMC, Crossref, OpenAlex y arXiv soportan CORS para GET; si una fuente no lo soporta, usar un proxy propio o Cloudflare Worker gratuito como intermediario. |
| Cálculo de "18 meses" es aproximado (mock no tiene fecha exacta) | Documentado en `monthsSincePublication()`; al integrar APIs reales se debe usar la fecha de publicación exacta (`publication_date`) en vez de aproximar por año. |
| Accesibilidad / navegación por teclado | Botones nativos (`<button>`), `:focus-visible` visible, skip-link al contenido, buen contraste en ambos temas. |
