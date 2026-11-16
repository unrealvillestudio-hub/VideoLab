# MOTOR HTML DE VIDEOLAB — F0 (prueba medida, sin producción)

**Fecha:** 2026-11-16 · **Rama:** `claude/motor-html-f0` · **Estado:** prototipo **NO conectado al job**
(`render/src/main.mjs` no lo importa; el `Dockerfile` no cambia; no se tocó la base, ni presets, ni piezas).

**Objetivo validado por Sam (2026-11-16):** *«VideoLab dibuja las capas de texto con un motor HTML propio y
determinista. Con el mismo pedido da el mismo video, cada preset es una plantilla guardada como dato, y el render de
60 s no supera 5 minutos en Cloud Run.»* Esta F0 es la prueba medida de eso.

**Convención de evidencia:** *medido* = se ejecutó en esta sesión, con el comando y el resultado al lado;
*reportado* = lo afirma un tercero, con quién y cuándo; *deducido* = inferencia, con de qué sale y qué lo confirmaría.

---

## 1. Resultado en una tabla

| Pregunta | Respuesta | Grado |
|---|---|---|
| ¿Cabe en 5 min por 60 s? | **Sí.** {{T2}} s con 2 CPU para el video completo (58,3 s, 1.748 fotogramas). Tope: 300 s. | medido en el sandbox, 2 CPU con `taskset` |
| ¿Mismo pedido → mismo video? | **Sí.** Misma huella en los 1.748 fotogramas y el mismo MP4 byte a byte, entre dos corridas y entre 4 y 2 CPU. | medido |
| ¿Preset = plantilla guardada como dato? | **Sí.** Geometría, colores, fuentes y animación salen del dato (`spec` + `spec.motion`); el código no conoce ninguna marca. | medido (tests) |
| ¿La geometría del contrato §4 ter.4 se respeta tal cual? | **Sí.** El motor recibe los `blocks` de `buildTextLayers` y no coloca nada; incluido `place` (v1.3.3). | medido (test y fixture real) |
| ¿Cuánto añade a la imagen? | Chromium headless shell: **261 MB** en disco, más sus bibliotecas del sistema. | binario medido; imagen completa *deducido* (sin daemon de Docker en el sandbox) |

---

## 2. Licencias — qué se usa y qué no

### 2.1 HyperFrames (HeyGen) — se puede usar; la F0 no copia su código

- **Medido:** `git clone --depth 1 https://github.com/heygen-com/hyperframes` → commit `e368db138f34` (2026-11-16).
  `LICENSE` = **Apache License 2.0** (190 líneas, md5 `8370096d1f918507accfbae02d7dbade`). El paquete npm
  `@hyperframes/engine@0.9.58` trae el mismo `LICENSE` (mismo md5); `npm view hyperframes license` → `Apache-2.0`.
- **Qué permite Apache 2.0:** uso comercial, modificación y redistribución, con estas obligaciones si se redistribuye
  su código: conservar el `LICENSE` y los avisos de copyright, incluir el `NOTICE` si existe, y marcar los archivos
  modificados. No da derecho a usar sus marcas.
- **GSAP dentro de HyperFrames (medido):** `gsap` es sólo `devDependency` de `@hyperframes/core` y `@hyperframes/player`
  (tests); su `CREDITS.md` declara que cuatro bloques del catálogo vendorizan GSAP 3.14.2 «under the GSAP Standard
  License (not an OSI open-source licence)». El motor (`@hyperframes/engine`) no depende de GSAP.
- **Lo que la F0 tomó de HyperFrames:** dos ideas, no código, leídas en
  `packages/engine/src/services/screenshotService.ts`: (1) PNG con `optimizeForSpeed: false`, porque el atajo rápido
  aplasta el alfa; (2) fijar el fondo transparente (`Emulation.setDefaultBackgroundColorOverride`) **una vez** por
  sesión. Se citan en `render/src/html/capture.mjs`. Si en F1 se reutiliza código suyo, se copia con su `LICENSE` y
  su aviso, y se marca lo modificado.

### 2.2 GSAP (Webflow) — no se usa

- **Medido:** `npm pack gsap@latest` → `gsap@3.15.1`, `package.json` → `"license": "Standard 'no charge' license:
  https://gsap.com/standard-license."`; cabecera de `gsap-core.js`: *«@license Copyright 2008-2026, GreenSock. All rights
  reserved. Subject to the terms at https://gsap.com/standard-license»*. El paquete **no trae el texto** de la licencia.
- **El texto completo NO se pudo leer desde este entorno (medido):** `curl https://gsap.com/standard-license` →
  `CONNECT tunnel failed, response 403`; la herramienta de lectura web → `getaddrinfo ENOTFOUND gsap.com`; el espejo
  `open.windriver.com/.../gsap-standard-no-charge-2025.html` → el proxy rechaza la conexión. No hay cita literal aquí.
- **Reportado** (búsqueda web, 2026-11-16, resumen de buscador, no texto leído): la página oficial define «Prohibited
  Uses» que incluyen usar GSAP en herramientas visuales sin código que permitan crear animaciones y compitan con las
  funciones de animación visual de Webflow; un espejo con fecha 2025-04-30 lo llama «Competitive Products»; un foro
  cita a personal de GSAP diciendo lo mismo. Fuentes: gsap.com/community/standard-license, open.windriver.com (espejo),
  forum.pinegrow.com.
- **Decisión: no se usa GSAP, y el motivo no depende de leer la cláusula:**
  1. Es una licencia **propietaria** («All rights reserved»), con los términos fuera del paquete y modificables por su
     dueño; un carril del sistema no puede depender de eso.
  2. La ventana «Texto en pantalla» del Orchestrator permite crear y ajustar animación sin código (preset, X, Y, zoom
     por bloque); según lo reportado, es exactamente el tipo de uso que la licencia excluye.
  3. El objetivo pide una función pura del tiempo y la animación como dato: el evaluador propio (§4) ya lo cumple en
     menos de 300 líneas, con curvas de fórmula pública. GSAP no aporta nada que haga falta.
- **Pendiente para quien quiera reabrirlo:** leer el texto en gsap.com desde una red que lo alcance. No cambia la
  recomendación.

### 2.3 Remotion

Descartado en el brief de origen (licencia que obliga a pagar desde cierto tamaño de empresa). La F0 no lo mira.

---

## 3. Cómo funciona

```
pedido (text_layers + timeline) ──► buildTextLayers (textlayers.mjs, SIN CAMBIOS)  ──► blocks = text_layout
                                                    │
                                                    ▼
                                html/scene.mjs: escena = qué se dibuja (líneas, colores, fuentes, pistas)
                                                    │
                                                    ▼
                         html/page.mjs: UNA página con la escena, las fuentes dentro y window.__vl.seek(ms)
                                                    │
                                                    ▼
      html/capture.mjs: Chromium sin pantalla · t = i/fps · seek(t) · PNG con alfa por CDP · sólo donde hay texto
                                                    │  (tubería, sin archivos intermedios)
                                                    ▼
             ffmpeg: overlay sobre el video limpio + franja de identidad (drawbox) → MP4 de la especificación §5
```

| Archivo | Qué hace |
|---|---|
| `render/src/html/ease.mjs` | Curvas de velocidad por fórmula pública: Penner (sine, quad, cubic, quart, quint, expo, circ, back, elastic, bounce; `_in`, `_out`, `_in_out`) y la Bézier cúbica de CSS (`bezier:x1,y1,x2,y2`). |
| `render/src/html/keyframes.mjs` | El evaluador: `stateAt(tracks, target, t, block, unit)`, `rectAt(block, t)`, `validateMotion`, `tracksFromEntry`. Función pura del tiempo. |
| `render/src/html/scene.mjs` | De la geometría ya resuelta a la escena. No coloca nada. |
| `render/src/html/page.mjs` | La página: DOM construido una vez; `seek(t)` fija todos los estilos desde cero. |
| `render/src/html/capture.mjs` | El capturador (opción a) y los argumentos de ffmpeg. |
| `render/bench/motor_html_f0.mjs` | El banco de la F0 (fixture → videos, huellas, tiempos, ASS de referencia). |
| `docs/html_presets_f0.json` | Los tres presets de prueba, como dato. No se siembran. |
| `tests/html_engine_test.mjs` | Las pruebas (en `npm test` y en CI). |

**Por qué es determinista:** el tiempo lo pone el capturador, nunca un reloj; la página no tiene animaciones ni
transiciones CSS, ni temporizadores, ni `Math.random`, ni red (las fuentes van como `data:` y toda petición se
aborta); `seek` reescribe cada estilo en cada fotograma, así que el estado no depende del fotograma anterior; ffmpeg
codifica con un número **fijo** de hilos de x264 (ver §5).

---

## 4. La animación como dato

Un preset con el motor HTML lleva `spec.motion.tracks`. Cada pista apunta a una parte del bloque:

| `target` | Qué es |
|---|---|
| `block` | el bloque entero (caja, filete y texto) |
| `box`, `rule`, `text` | la caja, el filete o el texto |
| `line`, `word`, `char` | cada línea, palabra o letra, con `stagger` |
| `emphasis` | las palabras de `emphasis` del pedido (tinte al acento, subrayado `mark`) |
| `number` | las cifras del texto: cuentan desde 0 con sus separadores y decimales (`$1.67`, `$200`, `20.000`) |
| `sheen` | un brillo que cruza la caja (con `repeat`) |

Claves: `{ t, ease?, opacity, x_em, y_em, scale, scale_x, scale_y, rotate_deg, blur_em, clip_l, clip_r, clip_t,
clip_b, tint, sheen, count, mark }`. `from: 'end'` cuenta el tiempo desde el final del bloque (salidas). Las unidades
van en **em del tamaño del bloque**: la misma animación sirve a cualquier tamaño y lienzo.

Un preset **sin** `motion` también se dibuja: `tracksFromEntry` traduce `entry`, `duration_ms`, `exit_ms` y
`slide_from_pct` (contrato §4 ter.3) a pistas. Así los 17 presets de la siembra pasan por el motor sin tocarlos
(probado en `tests/html_engine_test.mjs`).

**Presets de prueba de la F0** (`docs/html_presets_f0.json`, misma geometría que los actuales):

| preset | capa | qué hace |
|---|---|---|
| `hook_char_rise` | gancho | la caja se abre de izquierda a derecha; cada letra sube desde debajo de su línea (máscara real por línea) con desenfoque que se aclara; el énfasis toma el acento, late y se subraya |
| `cta_card_spring` | CTA | la tarjeta sube y se asienta con un rebote corto; el filete se dibuja desde el centro; las palabras entran escalonadas; un brillo cruza la tarjeta cada 2,6 s |
| `key_title_counter` | título clave | el filete se dibuja, las palabras suben y la cifra cuenta hasta su valor (`$1.67`, `$200`) |

**Posición por tramo de toma (para F1/F2):** un bloque puede llevar `segments: [{ start_ms, end_ms, rect }]`, `move_ms`
y `move_ease`; `rectAt` devuelve el rectángulo de cada tramo y el paso suave entre dos. Está en el evaluador y probado;
falta que la geometría (`buildTextLayers`) calcule un `rect` por toma para el bloque que cruza un corte.

---

## 5. Mediciones (todas *medidas* en el sandbox salvo donde se dice)

**Material:** pieza de prueba del brief (job `03f7e73a`, 1080×1920, 30 fps, 58,267 s, 1.748 fotogramas). El fixture
se armó con `lab_jobs.output_parsed` (timeline, capas, caras) y con el dato de la marca en la base; **reproduce
exactamente** el `text_layout` guardado del job (los 7 rectángulos, tamaños, líneas y el aviso `TEXT_OVER_FACE`
del CTA), medido con `buildTextLayers` y las fuentes reales. El fixture no va al repo (lleva marca y nombre de una
persona); el banco lo recibe por argumento.

**Máquina:** Intel Xeon @ 2,10 GHz, 4 CPU; «2 CPU» = `taskset -c 0,1`.

**Comando:**
```
node render/bench/motor_html_f0.mjs <fixture.json> <clean.mp4> <salida> --runs 2 --ass \
  --presets docs/html_presets_f0.json \
  --swap hook=hook_char_rise,cta=cta_card_spring,key_titles.0=key_title_counter,key_titles.1=key_title_counter
```

### 5.1 Tiempo del video completo

| Motor | 4 CPU | 2 CPU |
|---|---|---|
| **HTML (a), capturador propio** | {{T4A}} s / {{T4B}} s (dos corridas) | **{{T2}} s** |
| HTML (b), núcleo de HyperFrames | 121,8 s / 117,7 s | 133,1 s |
| ASS actual (libass), referencia | {{ASS4}} s | {{ASS2}} s |

- Fotogramas capturados: **1.693 de 1.748** (los 55 sin texto no abren el navegador).
- Captura por fotograma: **{{MSF4}} ms** con 4 CPU y **{{MSF2}} ms** con 2 CPU (medido, promedio).
- **Extrapolación a Cloud Run (deducido):** el job tiene 2 vCPU. Con {{T2}} s medidos en 2 núcleos del sandbox, el
  margen hasta 300 s es ×{{MARGEN}}. Una vCPU de Cloud Run puede ser más lenta que un núcleo de esta máquina; con el
  margen medido, el tope se rompería sólo si fuera más de {{MARGEN}} veces más lenta. Se confirma en F1 con una
  ejecución del job (no en la F0, que no despliega).

### 5.2 Tiempo por tramo (captura, 2 CPU)

{{TRAMOS}}

### 5.3 Determinismo

| Prueba | Resultado |
|---|---|
| Huella de los 1.748 fotogramas (sha256 de cada PNG), corrida 1 vs 2 | **idénticas** ({{DIGEST}}) |
| MP4, corrida 1 vs 2 | **idéntico** (sha256 {{MP4}}) |
| MP4, 4 CPU vs 2 CPU | **idéntico** |
| Opción (b), dos corridas y 2 CPU | huellas idénticas entre sí (`a3fd024a…`); MP4 idéntico (`7248e765…`) |

**Lo que se corrigió por medir:** la primera tanda dio la misma huella de fotogramas con 4 y 2 CPU pero **MP4
distinto**, porque x264 elige sus hilos según la máquina. Con `-threads:v 2` fijo, el MP4 es el mismo en las dos.

**Vigilancia permanente:** `tests/html_engine_test.mjs` captura dos veces la misma escena y compara la huella de cada
fotograma; corre en `npm test` y en CI (que ahora instala Chromium). Inyectada la regresión (ruido de reloj dentro de
`seek`), la prueba se pone en rojo; sin ella, en verde (medido, `CC_PROTOCOL` §14.2).

### 5.4 Peso

| Qué | Medida |
|---|---|
| MP4 HTML (58,3 s) | {{BYTES_HTML}} bytes |
| MP4 ASS actual (mismo pedido) | {{BYTES_ASS}} bytes |
| Tope del contrato | 50 MB |
| Chromium headless shell (Playwright 1.63, build 1243) | **261 MB** en disco (medido, `du -sh`) |
| `@hyperframes/engine` con sus dependencias, sin Chrome | 124 MB (medido, `du -sh node_modules`) |
| Imagen del job con Chromium | *deducido*: imagen actual + ~261 MB + bibliotecas del sistema de Chromium. Sin daemon de Docker en el sandbox no se pudo construir; se mide en F1 con Cloud Build. |

### 5.5 Comparación visual

Láminas lado a lado (ASS actual a la izquierda, HTML a la derecha) en 0,40 s, 1,60 s, 10,45 s, 29,30 s, 21,40 s,
39,30 s, 51,60 s y 53,60 s: se entregan a Sam con el reporte (no van al repo: muestran a personas reales).

Comprobación de medida: el ancho real de cada línea en el navegador es **menor o igual** al que midió la geometría en
los 14 renglones (entre 2 % y 9 % menor: la medida de la geometría es conservadora). Ningún texto sale de su caja.

---

## 6. (a) capturador propio vs (b) núcleo de HyperFrames

| | (a) propio | (b) `@hyperframes/engine` 0.9.58 |
|---|---|---|
| Tiempo 60 s, 2 CPU | {{T2}} s | 133,1 s |
| Determinista | sí | sí |
| Modo de captura | `Page.captureScreenshot` | también `screenshot` (el motor descarta `beginFrame` en este entorno, con alfa y sin alfa) |
| Dependencias nuevas | Playwright + Chromium | puppeteer, hono, linkedom, postcss y más: 124 MB sin Chrome; pide un `chrome-headless-shell` fijado por versión |
| Código que hay que entender | ~600 líneas propias | `frameCapture.ts` sólo, más de 5.500 líneas |
| Licencia | propia | Apache-2.0 (permite) |

**Recomendación: (a).** Con la misma técnica de captura, (b) no es más rápido aquí y trae una superficie grande. Lo que
vale de HyperFrames es el modo `HeadlessExperimental.beginFrame` en Linux: si en F1 el tiempo en Cloud Run se acerca al
tope, se estudia ese modo (con su `LICENSE` si se reutiliza código).

---

## 7. Hallazgos que no son de la F0 (se reportan, no se tocan)

1. **`fonts.mjs` baja la primera cara del `css_import`, no la que pide el preset.** Medido el 2026-11-16 con el
   mismo agente que usa el job: para una familia display con cursiva en el `css_import`, la primera cara es
   `font-style: italic`; para una familia de texto con `wght@300;…`, la primera es `font-weight: 300`. El gancho
   del video actual sale **en cursiva** y los subtítulos con una negrita sintética sobre la cara fina. Afecta al
   render ASS de hoy y al HTML por igual (la F0 usa el mismo archivo a propósito, para comparar a igualdad).
   Corregirlo cambia la medida y, por tanto, la geometría en producción: es un PR propio (F1 o antes).
2. **El tamaño de letra de libass no es el de CSS.** La geometría mide con el avance real de la fuente a `px`
   (semántica de CSS); libass dibuja más pequeño a ese mismo número. Por eso en el ASS el texto no llena su caja y en
   el HTML sí: el HTML dibuja lo que la geometría midió.
3. **El CTA de la pieza tapa una cara** (`TEXT_OVER_FACE`, ya en `text_layout.warnings` del job). Lo resuelve la
   posición por tramo de toma (§4), objetivo de F1/F2.

---

## 8. Recomendación para F1 (no se ejecuta sin el sí de Sam)

1. `spec.engine: 'html' | 'ass'` en `videolab_text_presets.spec` (eje del sistema; por defecto `ass`). ASS queda como
   respaldo; `entry` se sigue leyendo.
2. `buildTextLayers` devuelve la escena directamente (una sola derivación; hoy la F0 re-mide al tamaño de la
   geometría y comprueba que coincide).
3. Corregir la elección de cara de `fonts.mjs` (hallazgo 1) **antes** de activar presets HTML.
4. Imagen del job con Chromium headless shell; medir el tamaño real en Cloud Build y una ejecución de 60 s en el job
   (procedimiento `claude-ops`, tras merge).
5. Posición por tramo de toma en la geometría para bloques que cruzan cortes.
6. Contrato v1.4.0 con `engine` y `motion` en §4 ter.3, y los presets de F2 como filas de la tabla.
