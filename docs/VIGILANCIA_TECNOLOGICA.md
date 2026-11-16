# VIGILANCIA TECNOLÓGICA — MOTORES DE VIDEOLAB

**Qué es:** el registro, por rondas, de lo que se revisa fuera (prácticas, modelos, librerías, licencias, datos de
impacto) para que los motores propios de VideoLab mejoren con evidencia. Pedido de Sam, 2026-11-16: *«seguir de cerca
las mejores prácticas y modelos que resultan mejor y con impacto positivo en los números y así actualizar nuestros
motores»*, y *«la primera ronda … debería ser ahora que lo estás construyendo»*.

**Regla de cada ronda:** lo que se adopta se **mide aquí** contra lo que ya tenemos (mismo pedido, misma máquina) antes
de entrar a un motor. Lo que sólo afirma un proveedor queda como *reportado* y no cambia nada hasta medirlo.
**Las rondas no se borran:** una ronda nueva va arriba; las anteriores quedan debajo.

**Convención de evidencia:** *medido* = ejecutado en la ronda, con comando y resultado; *reportado* = lo afirma una
fuente externa, nombrada; *deducido* = inferencia, con su origen.

---

## RONDA 1 — 2026-11-16 · motor HTML de texto (antes de la F1)

### R1.1 Captura determinista: `beginFrame` es un 33 % más rápido y da el mismo píxel — ADOPTAR en F1

- **Reportado:** HyperFrames y otras herramientas usan `HeadlessExperimental.beginFrame` con `chrome-headless-shell` y
  `--deterministic-mode` ([HeyGen, html-to-video](https://www.heygen.com/research/html-to-video),
  [HyperFrames engine](https://hyperframes.heygen.com/packages/engine)). Overcrank dice que es de 2 a 3 veces más rápido
  que las capturas de CDP ([overcrank](https://github.com/upspawn/overcrank)). El README de puppeteer-capture califica
  de moderado a alto el riesgo a largo plazo: `beginFrame` sólo existe en `chrome-headless-shell`, no en `--headless=new`
  ([puppeteer-capture](https://cdn.jsdelivr.net/npm/puppeteer-capture@1.58.0/README.md)).
- **Medido aquí** (`render/bench/captura_beginframe.mjs`, misma página del motor, mismos fotogramas, Chromium headless
  shell build 1243, 2 CPU con `taskset`):

  | Tramo (240 fotogramas) | `captureScreenshot` | `beginFrame` | Huella de los 240 fotogramas |
  |---|---|---|---|
  | CTA, 51,0–59,0 s | 83,3 ms/fotograma | **55,4** y 56,4 (dos pasadas) | **idéntica** en los dos modos (`d91481f11ac8ca01`) |
  | títulos y subtítulos, 10,0–18,0 s | 62,3 ms/fotograma | **42,4** | **idéntica** (`26382300705082b9`) |

  Con 4 CPU: 86,9 frente a 58,5 ms en el tramo del CTA (misma huella).
- **Decisión propuesta para F1:** capturar con `beginFrame` y dejar `captureScreenshot` como respaldo automático. Como
  los dos modos dan el mismo píxel (medido), el respaldo no cambia el video, y una prueba puede exigirlo: misma huella
  por fotograma en los dos modos. Eso convierte el riesgo de que `beginFrame` desaparezca en un aviso, no en una caída.
  **Deducido:** con el 33 % menos de captura, el video de 60 s bajaría de ~130 s a ~90 s con 2 CPU. Se confirma en el
  job.
- **La lección de HyperFrames que sí aplica:** el entorno también tiene que ser determinista, no sólo el HTML
  (fuentes dentro de la página, sin red, sin reloj). Eso ya lo cumple el motor (medido en la F0: misma huella en 4 y 2 CPU).

### R1.2 Animación: resortes físicos como curva — ADOPTAR en F1, como dato

- **Reportado:** las librerías de motion (Motion, anime.js, Popmotion) modelan el «spring» como un oscilador armónico
  amortiguado con rigidez, amortiguación y masa. La razón de amortiguación es ζ = c / (2√(k·m)): con ζ < 1 rebota y con
  ζ = 1 llega sin rebote. Valores orientativos de Motion: con rigidez 300, amortiguación 5 rebota mucho, 10 es el
  rebote por defecto y 40 o más no rebota ([Motion, springs](https://www.mintlify.com/motiondivision/motion/guides/spring-animations),
  [física de los springs](https://blog.maximeheckel.com/posts/the-physics-behind-spring-animations/),
  [anime.js spring](https://www.mintlify.com/juliangarnier/anime/easings/spring)).
- **Por qué importa:** el «asentarse con rebote» que hoy el CTA hace con `back_out` (una cúbica fija) es lo que el ojo
  reconoce como motion design de calidad. Un resorte, además, se ajusta con dos números que cualquiera entiende
  (rápido o lento, con o sin rebote).
- **Decisión propuesta:** una curva más en `ease.mjs`, `spring:<rigidez>,<amortiguación>,<masa>`, con la **solución
  analítica** del oscilador (fórmula cerrada, sin integrar paso a paso). Así sigue siendo una función pura del tiempo:
  mismo `t`, mismo valor, en Node y en el navegador. Ninguna librería: la fórmula es pública.

### R1.3 Librerías y motores abiertos — no hace falta ninguno; licencias verificadas

**Medido** (`npm view <paquete> version license`, 2026-11-16):

| Paquete | Versión | Licencia | Lectura |
|---|---|---|---|
| `@motion-canvas/core` | 3.17.2 | MIT | motor completo de animación por código. **Reportado:** sus mantenedores debatieron pasarse a GPL ([discusión #1015](https://github.com/orgs/motion-canvas/discussions/1015)); no se pudo confirmar en qué quedó. Riesgo de licencia. |
| `@revideo/core` | 0.11.0 | MIT | fork de Motion Canvas pensado para render parametrizado ([revideo](https://github.com/redotvideo/revideo)) |
| `animejs` | 4.5.0 | MIT | librería de animación del navegador |
| `motion` | 14.14.0 | MIT | ídem (antes Framer Motion) |
| `@theatre/core` / `@theatre/studio` | 0.7.2 | Apache-2.0 / **AGPL-3.0** | el editor es AGPL: no apto para un producto cerrado |
| `lottie-web`, `@lottiefiles/dotlottie-web` | 5.13.0 / 0.83.2 | MIT | reproductor de animaciones hechas en After Effects |
| `@rive-app/canvas` | 2.51.0 | MIT | el reproductor es MIT, pero el formato y el editor son de Rive (reportado: [Rive](https://rive.app/docs/runtimes)) |
| `remotion` | — | propia | **reportado:** gratis hasta 3 empleados; empresa con licencia de pago ([licencia](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)). Sigue descartado. |

**Decisión:** el motor propio sigue siendo el camino. Las librerías de animación del navegador corren con un reloj real y
habría que domarlas para la captura por fotograma, mientras que nuestro evaluador ya es una función pura del tiempo.
Lottie queda como **posibilidad para F2**: reproducir dentro del motor animaciones hechas por un diseñador (MIT), si
algún día hace falta un gráfico que no convenga escribir como pistas.

### R1.4 Subtítulos: velocidad de lectura — dato para F2

- **Reportado:** las guías de Netflix fijan 17 caracteres por segundo para adultos en varios idiomas europeos, y
  42 caracteres por línea; la BBC, entre 160 y 180 palabras por minuto, y dos líneas como máximo
  ([Netflix, guía portuguesa](https://backlothelp.netflix.com/hc/en-us/articles/216787938-Portuguese-Timed-Text-Style-Guide),
  [Netflix, guía croata](https://backlothelp.netflix.com/hc/en-us/articles/115002790368),
  [resumen de la BBC](https://clevercast.com/bbc-subtitling-guidelines)). Son guías de subtítulos de lectura. El karaoke
  sigue a la voz, que también se oye, así que no se aplican tal cual.
- **Medido en la pieza de prueba** (escena de la F0, `caption_karaoke_accent`): 40 grupos, mediana de 15,6 caracteres
  por segundo, máximo de 23,6; **14 grupos pasan de 17** y 2 están menos de 800 ms en pantalla.
- **Propuesta para F2 (no para F1):** en los presets de karaoke, mantener el grupo en pantalla hasta que entra el
  siguiente si la pausa es corta, y avisar en `text_layout.warnings` cuando un grupo pase de un tope de lectura
  declarado como dato del preset. Antes, medir si cambia la retención (R1.6).

### R1.5 Zonas seguras — sin cambio

- **Reportado:** no hay cifras oficiales para publicaciones orgánicas; las guías de anuncios de Meta citan 14 % arriba,
  35 % abajo y 6 % a los lados, y los proveedores no coinciden entre sí
  ([Jon Loomer](https://www.jonloomer.com/tiktok-instagram-reels-safe-zones-templates/),
  [reap.video](https://reap.video/blog/short-form-video-safe-zones)). Un proveedor reporta que TikTok ensanchó la
  columna de botones de la derecha en enero de 2026.
- **Medido:** la zona del canal que usa la pieza de prueba es 14 % arriba, 37 % abajo, 6 % a la izquierda y 22 % a la
  derecha (`imagelab_overlay_tokens`), más prudente que esas cifras. Es dato, así que un cambio de plataforma se
  corrige con un `UPDATE`, no con código. Nada que cambiar.

### R1.6 Impacto en los números — lo que hay fuera no sirve; hay que medirlo con lo nuestro

- **Reportado:** casi todo son blogs de proveedores con cifras propias. Por ejemplo, «+5 a +15 % de retención con
  subtítulos animados» ([ClipSpeed](https://www.clipspeed.ai/blog/11-caption-styles-ranked-viral-performance-2026.html))
  o «+34 % de tiempo de visionado» en 80 videos sin control declarado
  ([FluxNote](https://fluxnote.io/blog/ai-captions-that-improve-watch-time)). El estudio más citado (Verizon
  Media/Publicis, 2019, n = 5.616) habla de subtítulos en general, no de animados frente a estáticos. **No se encontró
  ningún estudio independiente** que mida subtítulos animados frente a estáticos en video corto en 2025–2026.
- **Decisión propuesta:** que la mejora se pruebe con **nuestros** números. En F1, cada pieza guarda con qué motor y
  qué presets se dibujó, y así se comparan sus métricas de plataforma (visionado medio, retención, alcance) entre
  motores y presets, por marca. Nombres de campo propuestos, todavía no escritos: `text_engine` y `text_presets`.
  *Deducido:* el ecosistema ya tiene acceso a las métricas de Instagram por publicación (conector de Meta), pero falta
  confirmar dónde se guardan por pieza; lo que sí se sabe es que hoy la pieza no dice con qué motor se dibujó. Sin esa
  etiqueta, «mejor motion design» no se puede demostrar.

### Resumen de la ronda 1

| # | Qué | Decisión | Dónde |
|---|---|---|---|
| R1.1 | Captura con `beginFrame` (−33 %, mismo píxel) | adoptar, con respaldo y prueba de igualdad | F1 |
| R1.2 | Curva de resorte analítica | adoptar como dato (`spring:k,c,m`) | F1 |
| R1.3 | Librerías y motores externos | no adoptar; Lottie queda como posibilidad | F2 |
| R1.4 | Velocidad de lectura de los subtítulos | medir y proponer un tope como dato del preset | F2 |
| R1.5 | Zonas seguras | sin cambio (ya son dato) | — |
| R1.6 | Etiqueta de motor y presets en cada pieza | adoptar para poder medir el impacto | F1 |

**Próxima ronda:** al cerrar la F1, con el tiempo medido en el job y las primeras piezas etiquetadas.
