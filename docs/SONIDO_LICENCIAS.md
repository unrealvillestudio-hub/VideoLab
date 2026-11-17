# Capa de sonido para Reels/TikTok/Shorts — fuentes, licencias y herramientas

Investigación de solo lectura del 2026-11-17. Sin compras, sin altas de cuenta y sin código escrito.

**Etiquetas de evidencia**
- `medido`: leído en una fuente primaria (se da la URL y una cita).
- `reportado`: viene de un resumen de buscador o de una fuente secundaria. No se leyó el texto primario.
- `deducido`: inferencia propia a partir de lo medido.
- `no verificado`: no se pudo confirmar.

**Límites de red de esta sesión (medido).** Desde la sesión **se alcanzaron**:
- `raw.githubusercontent.com`
- `elevenlabs.io`

**No resolvieron** (`ENOTFOUND` o `000`, por política de red de la sesión):
- `freesound.org`, `pixabay.com`, `mixkit.co`, `zapsplat.com`, `sonniss.com`
- `sound-effects.bbcrewind.co.uk`, `api.openverse.org`, `docs.openverse.org`
- `ffmpeg.org`, `trac.ffmpeg.org`, `youtube.com`

Donde la página oficial quedó bloqueada se usó el código fuente o la documentación del propio proyecto en GitHub:
- Freesound: `MTG/freesound`.
- Openverse: `WordPress/openverse`.
- FFmpeg: `FFmpeg/FFmpeg`.

Si no había ni eso, el dato se marca como `reportado`. Para verificar lo pendiente hay que permitir esos dominios en la red de la sesión.

---

## Tabla resumen

| # | Fuente | Tipo | Licencia del código / servicio | Licencia del audio | Uso comercial | Atribución | API | Recomendación |
|---|---|---|---|---|---|---|---|---|
| 1 | **earshot** (Leonxlnx/earshot) | Herramienta OSS (CLI, Python, MCP) | MIT (medido) | Banco de 252 SFX **sintetizados por código**: el código es MIT. 15 SFX ajustados a partir de grabaciones CC0 (medido) | Sí (MIT; deducido para los renders) | No (MIT pide conservar el aviso en las copias del software, no en los videos) | Local, sin red | **REUTILIZAR**: `measure`, `timeline`/`sync`, banco `sfx`/`kit` y el patrón del mixer |
| 2 | **"Real SFX"**: sin producto con ese nombre (no verificado). El mejor candidato es la skill **`real-sound`** de earshot | Proceso/skill OSS | MIT (mismo repo) | Usa grabaciones de terceros con licencia propia | Según cada ítem | Según cada ítem | Local | **REUTILIZAR el diseño** (cues por frame, `licences.py`, `audit.py`, `credits.py`). **CONSTRUIR** el mixer sobre ffmpeg |
| 3 | **Openverse** | Buscador / API (agregador) | Código MIT (medido). Términos: Openverse no verifica licencias (reportado) | Por ítem: `cc0`, `pdm`, `by`, `by-sa`, `by-nd`, `by-nc*`, `sampling+` (medido) | Por ítem | Por ítem (campo `attribution`) | Sí, con OAuth2; límites en el código (medido) | **REUTILIZAR** solo como buscador, filtrando `license=cc0,pdm,by` y verificando en el origen |
| 4a | **ElevenLabs Sound Effects** | Servicio IA (API) | Términos ElevenLabs | Output del usuario; comercial solo en plan de pago (medido) | Sí desde Starter | No | `POST /v1/sound-generation` (medido) | **REUTILIZAR** (ya hay cuenta) para SFX a medida, sin vender ni redistribuir los sonidos sueltos |
| 4b | **ElevenLabs Music** | Servicio IA (API) | Music Terms (2026-10-09) | Output del usuario; Starter: comercial salvo cine/TV/radio, sin distribución a plataformas de streaming musical, **«For Individual Use Only»** (medido) | Sí, con matices | Solo en el plan Free | Music API solo para suscriptores de pago (medido) | **REUTILIZAR con condición**: confirmar con ElevenLabs que un estudio que trabaja para clientes cabe en el plan, o usar Scale o superior |
| 5 | **Freesound** | Base de datos + API | Código AGPL-3.0 (medido) | Por sonido: CC0, CC BY 4.0 (y 3.0), CC BY-NC 4.0 (y 3.0), Sampling+ (medido) | CC0 y BY sí; NC no | BY sí | API gratuita **solo no comercial**; uso comercial bajo licencia negociada con UPF (medido) | **REUTILIZAR** sonidos CC0/BY por curaduría manual. **DESCARTAR** la API en el pipeline sin acuerdo comercial |
| 6 | **Pixabay audio** | Base de datos | Pixabay Content License | Música y SFX bajo la Content License (reportado) | Sí (reportado) | No (reportado) | **No hay endpoint de audio**: solo imágenes y video (reportado) | **REUTILIZAR** a mano, sin API |
| 7a | **Mixkit** | Base de datos | Mixkit Free License | SFX y música gratis, comercial, sin atribución (reportado) | Sí (reportado) | No (reportado) | No hay API pública (reportado/no verificado) | **REUTILIZAR** a mano |
| 7b | **ZapSplat** | Base de datos | Standard License | Comercial; la cuenta gratuita exige crédito y la Premium no (reportado) | Sí (reportado) | Free sí / Premium no | No hay API (no verificado) | **REUTILIZAR** solo con cuenta Premium (requiere compra: decisión de Sam) |
| 7c | **Sonniss GDC bundles** | Paquete descargable | EULA por año | Royalty-free comercial, sin atribución. Desde 2024 prohíbe entrenar IA (reportado) | Sí (reportado) | No (reportado) | No | **REUTILIZAR** tras leer el EULA del año concreto |
| 7d | **BBC Sound Effects (RemArc)** | Base de datos | Licencia RemArc | Personal, educativo o de investigación; **no comercial** (reportado) | **No** | Sí | No | **DESCARTAR** (la versión comercial es de pago, vía Pro Sound Effects) |
| 8 | **FFmpeg** (loudnorm, sidechaincompress, adelay, amix, ebur128, alimiter…) | Biblioteca/CLI OSS | LGPL 2.1+ (GPL si se activa `--enable-gpl`) (medido) | — | Sí | No | Local | **REUTILIZAR**: es el motor del mixer determinista |

**Objetivo de loudness por plataforma.** Ninguna plataforma publica una especificación oficial que se haya podido leer:
- YouTube y Shorts: −14 LUFS integrados, con baja de volumen solo a lo que suena más fuerte. Es una medición de terceros (`reportado`).
- TikTok e Instagram Reels: no hay especificación oficial. La convención de la industria es −14 LUFS (`reportado`).
- Propuesta: **−14 LUFS integrados y −1,5 dBTP de techo** (la misma compuerta que usa earshot, `medido`) en un único máster para las tres plataformas (`deducido`).

---

## 1. "Earshot" → `Leonxlnx/earshot`

**Identificación.**
- Hay un candidato fuerte: **earshot**, de Leon Lin, en https://github.com/Leonxlnx/earshot.
- Su README (medido, `raw.githubusercontent.com/Leonxlnx/earshot/main/README.md`):
  > "earshot turns sound into evidence an agent can reason about … a second-by-second listening transcript of a whole film … It runs locally on CPU, as a CLI, a Python API and an MCP server."
- Encaja con «escucha un video, lo mide y genera el sonido que falta»:
  - `timeline FILE --video V --cues C`: sincronía de sonido contra cortes y frames.
  - `critique` y `measure`: LUFS, true peak, LRA.
  - `sfx`/`kit`: genera el SFX que falta.
- La búsqueda no devolvió otro producto llamado «Earshot» del ámbito audio/video (reportado). En la búsqueda aparecieron otras herramientas de video-a-SFX que no se llaman así: ElevenLabs video-to-sound, Sonilo, Mirelo, Adobe Project Super Sonic.

**Qué es.** Una herramienta y librería OSS. No es un servicio ni un dataset.

**Licencia del código (medido).**
- `LICENSE` en `main`: «MIT License — Copyright (c) 2026 Leon Lin».
- README, sección «Licence»: *"MIT for the code … CLAP (`laion/larger_clap_general`) Apache-2.0, AST (`MIT/ast-finetuned-audioset-10-10-0.4593`) BSD-3-Clause."*
- Los modelos se descargan aparte, unos 1,1 GB.

**Licencia del audio producido.**
- Medido, README:
  > "The forge's delivered sounds ship as a bank of 252 that renders by id, with no models and no network … 15 sounds fitted from CC0 recordings."
- Medido, `docs/CREDITS_FIT.md`: los 15 *fits* proceden de grabaciones de Freesound, todas **CC0 1.0**. *"A fit stores the structure of a sound … not its samples: no recording ships with earshot."*
- Medido, `docs/SFX.md`: *"NC or ND licences are always refused: a fit is a derivative of its recording and the bank ships in an MIT package."*
- Deducido: los WAV que se rendericen son output de software MIT a partir de parámetros MIT o CC0. No llevan una licencia de audio aparte, así que se pueden usar comercialmente dentro de videos de clientes sin atribución. **No hay una cláusula explícita sobre la licencia del audio renderizado** (no verificado). Conviene guardar `license: "MIT-generated"` y el `sha1` en el catálogo.

**Uso comercial / redistribución dentro de videos.** Sí (deducido, por MIT).

**Restricciones.**
- Las referencias del *forge* son grabaciones con licencia que no van en el repo.
- La skill `real-sound` excluye por política el audio generado por IA o por código. Es una regla interna de esa skill, no una restricción legal (medido, `skills/real-sound/references/licences.md`).

**API / precio.** Gratis y local. La única llamada externa es `llm` (Gemini, con clave propia y opt-in) (medido).

**Encaje con el pipeline determinista (medido).**
- `kit render` escribe *"deterministic, cached takes and a lock with each take's measured sync points"*.
- `kit.place(take, role, cue_s)` y `kit.gain_db(...)` sobre `bed_level`.
- `offset_ms` por rol: tap −60 ms, click −11, whoosh peak +37.
- `min_gap_ms` entre golpes seguidos.

**Recomendación: REUTILIZAR.**
- Usar `earshot measure`/`timeline` como QA de sincronía y loudness, y el banco `sfx`/`kit` como fuente de SFX de UI y motion: pops, clicks, whooshes, hits.
- Hay que fijar la versión (`v0.4.0`) y renderizar los takes una sola vez al banco propio, con hash.
- Razón en una línea: licencia MIT, local, determinista, y ya resuelve la colocación por frame con offsets medidos.

---

## 2. "Real SFX"

**Identificación.**
- **No se encontró ningún producto llamado «Real SFX» o «RealSFX»** en dos búsquedas (no verificado).
- Candidatos:
  - **a) Skill `real-sound` de earshot** (mismo repo, MIT). Es el mejor candidato y probablemente la fuente del encargo, porque el resto de la descripción coincide. Medido, `skills/real-sound/SKILL.md`:
    > "Every sound sits on a frame the picture code computes: a contact frame, a pop-in's 50 % frame, a move's velocity peak … placed on the picture's cue frames by a deterministic mixer … Code selects, trims, places, levels … code never generates a sound."
    
    Incluye `scripts/licences.py` (política de licencias), `audit.py`, `credits.py`, `mix.py` y `master.py`. El máster se hace a −14 LUFS con compuerta de ±0,5 LU y ≤ −1,5 dBTP (medido).
  - **b) Servicios comerciales de «SFX al frame exacto» (reportado, marketing de proveedor):**
    - Sonilo (`POST /v1/video-to-sfx`, también en fal.ai).
    - Mirelo SFX (vía Runware).
    - Artlist «SFX Video Sync».
    - Pollo AI, FlexClip, FlowVideo.
    
    No se leyeron sus términos (dominios no probados o bloqueados).

**Licencia.** Candidato a): MIT para el código. El audio conserva la licencia de cada grabación de origen (medido).

**Política de licencias de `real-sound`**, que coincide con la del estudio (medido, `references/licences.md`):
- Permitidas:
  - CC0 y Public Domain Mark.
  - CC BY 2.0–4.0, con crédito obligatorio.
  - Mixkit Free License y Pixabay Content License.
- Prohibidas:
  - NC, ND y SA (*"the whole film would have to be released under CC BY-SA"*).
  - Sampling+.
  - «personal use» y licencias custom.
  - Licencias en disputa.
- *"Unverified = blocked."*

**Recomendación.**
- Candidato a): **REUTILIZAR el diseño**: esquema `cues.json`, manifiesto con `licence_seen` y `licence_confirmed`, auditoría que bloquea lo no verificado y generador de créditos. **CONSTRUIR** el mixer con ffmpeg en el pipeline propio, porque `mix.py` está en Python/numpy y el estudio ya renderiza con ffmpeg.
- Candidato b): **DESCARTAR por ahora**. Son servicios de IA de terceros sin términos verificados y añaden dependencia y coste sin ser deterministas.
- Razón: el valor está en el proceso y la auditoría, no en un producto cerrado.

**Nota sobre SA.** El encargo permitía CC0 y CC-BY. Conviene excluir también **CC BY-SA**, por el argumento de `real-sound` (deducido, coincide con la regla del estudio de excluir NC y ND).

---

## 3. Openverse (openverse.org — WordPress Foundation)

**Qué es.** Un motor de búsqueda y API que agrega medios con licencia abierta. Fuentes de audio en el catálogo (medido, `catalog/dags/common/loader/provider_details.py`): `freesound`, `jamendo`, `wikimedia_audio`, `ccmixter`.

**Licencia del código.** MIT (medido, `raw.githubusercontent.com/WordPress/openverse/main/LICENSE`: «MIT License — Copyright (c) 2021 Openverse»).

**Términos del servicio (reportado: copia archivada de 2024 en `webcf.waybackmachine.org`, vigentes desde el 2022-05-05).**
- *"Openverse does not own or control the content or data made available through the API … and does not verify its licensing status … You are responsible for independently verifying whether you have the right to use the content."*
- `docs.openverse.org` no resolvió desde esta sesión.

**Licencias por ítem (medido, `api/api/constants/licenses.py`).**
- `CC_LICENSES = {"by","by-sa","by-nd","by-nc","by-nc-sa","by-nc-nd","cc0"}`, más `pdm` y las obsoletas `sampling+` y `nc-sampling+`.
- **Trampa (medido):** el grupo `license_type=commercial` se define como `{l for l in ALL_LICENSES if "nc" not in l}`. Por tanto **incluye `by-nd`, `by-sa` y `sampling+`**. Para la regla del estudio hay que filtrar con **`license=cc0,pdm,by`**, no con `license_type=commercial`.

**Campos por ítem (medido, `api/api/serializers/media_serializers.py`).** `id`, `title`, `foreign_landing_url`, `url`, `creator`, `creator_url`, `license`, `license_version`, `license_url`, `provider`, `source`, `filesize`, `filetype`, `tags`, `attribution` (texto de crédito ya armado), `mature`.

**Límites de uso (medido como valores por defecto del código, `api/conf/settings/rest_framework.py`).**

| Tipo de acceso | Ráfaga | Sostenido |
|---|---|---|
| Anónimo | `5/hour` | `100/day` |
| OAuth2 (client credentials) | `100/min` | `10000/day` |
| OAuth2 «enhanced» | `200/min` | `20000/day` |

El registro se hace por `register_api_oauth2` (nombre, descripción y email). Los valores de producción pueden cambiarse por variables de entorno (no verificado en producción).

**Uso comercial / atribución / redistribución.** Dependen de cada ítem. Openverse no concede nada por sí mismo (reportado).

**Recomendación: REUTILIZAR solo como buscador.**
- Consultar con `license=cc0,pdm,by` y `category` de audio.
- Guardar `foreign_landing_url`, `license`, `license_version`, `license_url`, `creator` y `attribution`.
- **Verificar la licencia en la página de origen** antes de aceptar el ítem. Openverse no la garantiza.
- Razón: buen índice con metadatos de licencia normalizados, pero sin garantía legal.

---

## 4. ElevenLabs — Sound Effects API y Music API

**Términos generales (medido, https://elevenlabs.io/terms-of-use).**
- §1(c)(i): los usuarios gratuitos *"may only use the Services for non-commercial purposes"*.
- §1(c)(ii): los usuarios de pago *"may use the Services for commercial purposes"*.
- §4(c)(ii): *"as between you and ElevenLabs, you retain all rights in and to your Output"*.
- §10: *"the Services may produce the same or similar Output for you and a third party."* Esto implica que no hay exclusividad (deducido).
- No exigen atribución.

**Precio (medido, https://elevenlabs.io/pricing; leído el 2026-11-17).**

| Plan | Precio | Licencia |
|---|---|---|
| Free | $0 | Sin uso comercial |
| **Starter** | «$1 first month», luego **$6/mes** | «Commercial License» y «Music commercial use» |
| Creator | $22/mes | |
| Pro | $99/mes | |
| Scale | $299/mes | |
| Business | $990/mes | |

En https://elevenlabs.io/pricing/api (medido) figuran Sound Effects a «$0.120» por minuto y Music a «$0.150» por minuto. El FAQ de la misma página dice que se facturan «per generation». Hay una incoherencia sin resolver en la propia página.

### 4a. Sound Effects (texto → SFX)

**API (medido, `elevenlabs.io/docs/api-reference/text-to-sound-effects/convert`).**
- Endpoint: `POST https://api.elevenlabs.io/v1/sound-generation`.
- Parámetros:
  - `duration_seconds`: 0,5–30.
  - `prompt_influence`: por defecto 0,3.
  - `loop`.
  - `model_id`: `eleven_text_to_sound_v2` o `eleven_text_to_sound_v3`.
  - `output_format`: por defecto `mp3_44100_128`.
- MP3 de 192 kbps requiere Creator o superior. PCM o WAV a 44,1 kHz requiere Pro o superior.
- **Starter no puede pedir WAV**: solo MP3 de 128 kbps (deducido de lo anterior).

**Términos específicos (medido, https://elevenlabs.io/creative-terms, Exhibit 4).**
- Permiso: *"You may use, reproduce, modify, distribute, publicly perform, and display Output … for commercial purposes only where your plan permits commercial use"*.
- Restricción: *"you may not sell, resell, license, sublicense, distribute, or otherwise commercially exploit Output … on a standalone basis … as part of any sound, sample, effects, or music library or other collection of sounds"*.
- Atribución: no se exige.

**Dentro de videos de clientes.** Sí, desde Starter, mientras el SFX vaya integrado en el video (deducido).

**Banco interno.** Guardar los SFX generados para reutilizarlos sin distribuirlos sueltos parece compatible con la cláusula. No está escrito explícitamente (deducido / no verificado). **No** debe entregarse a clientes como librería.

**Determinismo.** La generación no es determinista: la propia regla §10 lo admite. Hay que generar una vez y congelar el archivo con su hash en el banco (deducido).

**Recomendación: REUTILIZAR.**
- Generar SFX a medida cuando falte uno y congelarlo en el banco con `license: "ElevenLabs-Output (plan X, fecha)"` y el prompt.
- Razón: ya hay cuenta, el uso comercial está permitido y no exige atribución.

### 4b. Music

**API (medido, `elevenlabs.io/docs/overview/capabilities/music`).**
- *"The Music API is available for paid subscribers"*.
- Duración de 3 s a 5 min, en MP3 o WAV.
- Music v1 se retira el 2027-01-31.

**Términos (medido, https://elevenlabs.io/music-terms, «Last updated: 09 October 2026», Exhibit A).**

| Aspecto | Qué dicen |
|---|---|
| Media Rights (Free hasta Enterprise Music Lite) | *"All online and offline commercial use permitted, except film, TV, radio, and Studio Games"* |
| Streaming Distribution (§4.8(g): *"making Output available on a music streaming platform"*) | **Prohibida en Free y Starter**; permitida desde Creator |
| Atribución | Free: *"Required (denote Eleven Music when distributing)"*. El resto: *"No Attribution Required"* |
| **Elegibilidad** | Free, Starter, Creator y Pro: **"For Individual Use Only"**. Scale: *"fewer than 10 employees"*. Business: *"fewer than 50 employees"* |
| §4.2 | *"You must not … use Output to compile, create, or contribute to a Music Library"* |
| §2.2 | *"you retain any and all rights in and to your Input and Output."* |
| §4.4 | Hay que cumplir las políticas de cada plataforma sobre la divulgación de contenido generado por IA |

**Lectura.**
- Subir Reels o TikTok con música de ElevenLabs no es «streaming distribution», porque esa definición se refiere a plataformas de streaming musical (deducido).
- **Riesgo:** «For Individual Use Only» en Starter puede no cubrir a un estudio que produce para varias marcas cliente. El texto no define el término (no verificado).
- Además, el banco musical propio no puede alimentarse con salidas de Eleven Music si se considera una «Music Library» (deducido; §4.2).

**Recomendación: REUTILIZAR con condición.**
- Antes de usarlo en piezas de clientes, confirmar por escrito con ElevenLabs que un estudio cabe en el plan, o pasar a Scale.
- No incorporar las pistas al banco como librería. Guardarlas por pieza.
- Razón: el texto del plan Starter no deja claro si cubre el uso de una agencia.

---

## 5. Freesound (freesound.org — MTG, Universitat Pompeu Fabra)

**Qué es.** Una base de datos colaborativa de sonidos con API v2. El código es **AGPL-3.0** (medido, `raw.githubusercontent.com/MTG/freesound/master/LICENSE`).

**Licencias por sonido (medido, `sounds/fixtures/licenses.json` y la migración `0045_add_new_licenses.py`).**
- «Creative Commons 0» (CC0 1.0).
- «Attribution» (CC BY 4.0; también existe la 3.0).
- «Attribution NonCommercial» (CC BY-NC 4.0 y 3.0).
- «Sampling+».
- Para el estudio solo sirven **CC0 y CC BY** (deducido).

**Términos de la API (medido, `MTG/freesound/_docs/api/source/terms_of_use.rst`, espejo de https://freesound.org/help/tos_api/, que no resolvió).**
> "**You can use the Freesound API for free only for non-commercial purposes**. To use the Freesound API for commercial purposes, please contact us … and we will talk about licensing options."

> "Do not use the API to replicate Freesound on another site … Credit Freesound and sound creators in accordance with the sounds' licenses."

**Límites (medido, `_docs/api/source/overview.rst`).**
- *"The standard usage rate is set to 60 requests per minute and 2000 requests per day."*
- Descarga de originales: *"30 requests per minute and 500 requests per day"*. Requiere OAuth2.

**Precio de la licencia comercial de la API.** No está publicado: se negocia caso a caso con UPF (reportado).

**Distinción clave (deducido).**
- La licencia CC0 o CC BY de **cada sonido** permite usarlo en videos comerciales.
- Lo restringido es **usar la API** con fines comerciales. Un pipeline de un estudio comercial que busca y descarga por API probablemente cae en uso comercial.

**Detalle práctico (medido, `real-sound/references/licences.md`).**
- Las vistas previas HQ están en `cdn.freesound.org/previews/<id//1000>/<id>_<user>-hq.ogg`.
- Algunos autores piden una forma específica de crédito en la descripción del sonido.

**Recomendación: REUTILIZAR los sonidos CC0/BY por curaduría manual.**
- Leer la licencia en la página del sonido y registrar `licence_seen`, URL, autor y fecha.
- **DESCARTAR la API en el pipeline** salvo que se firme la licencia comercial con UPF.
- Razón: el contenido es apto, pero el acceso automatizado no lo es para uso comercial.

---

## 6. Pixabay audio (música y efectos)

`pixabay.com` no resolvió desde la sesión. Todo lo de este apartado es `reportado` (resúmenes de buscador de páginas `pixabay.com/service/...`).

**Licencia.**
- La música y los SFX están bajo la **Pixabay Content License**, que permite uso comercial y no comercial sin atribución (reportado, FAQ y Terms).
- **Prohibido** vender o distribuir el contenido «standalone», es decir, sin esfuerzo creativo y en sustancia igual que en el sitio. Integrarlo en un video editado no cuenta como standalone (reportado, License Summary y Terms).
- Algunas pistas pueden recibir reclamaciones de Content ID en YouTube, que normalmente se resuelven mostrando la licencia (reportado, blog de Pixabay). Esto no figura en el texto de la licencia.

**API.**
- La API documentada (`pixabay.com/api/docs/`) cubre **solo imágenes y videos; no hay endpoint de audio** (reportado).
- Prohíbe consultas masivas automatizadas y descargas sistemáticas (reportado).
- La skill `real-sound` también registra: *"Pixabay blocks scripted access: the user downloads by hand"* (medido, `references/licences.md`).

**Recomendación: REUTILIZAR a mano.** Descarga humana al banco, con la URL de la página y la fecha. Razón: licencia apta, pero sin API de audio.

---

## 7. Otras fuentes (máximo 4)

### 7a. Mixkit (Envato)

`mixkit.co` no resolvió. Todo es `reportado`.

- Licencia: «Sound Effects Free License» y «Stock Music Free License». Uso comercial sin atribución.
- Restricciones:
  - No redistribuir los archivos crudos.
  - No registrar con Content ID una obra que contenga ítems de Mixkit (reportado; recogido también en `real-sound/references/licences.md`, medido como política de esa skill).
- Hay licencias distintas por categoría.
- No hay API pública. La skill usa la URL directa `assets.mixkit.co/active_storage/sfx/<id>/<id>.wav` (medido en la skill; no es una API oficial).
- No hay página por SFX: hay que registrar la página de categoría.
- **Recomendación: REUTILIZAR a mano**, leyendo `mixkit.co/license/` una vez en una sesión con red. Razón: WAV sin pérdida y sin atribución.

### 7b. ZapSplat

`zapsplat.com` no resolvió. Todo es `reportado`.

- Standard License:
  - Cuenta Basic (gratis): debe acreditar a ZapSplat «wherever reasonably possible».
  - Premium: sin atribución, y lo descargado durante la suscripción sigue licenciado de por vida.
- El uso comercial y en broadcast está permitido según la licencia oficial. Algunos agregadores dicen lo contrario y no son fiables.
- No se encontró API.
- **Recomendación: REUTILIZAR solo con Premium** (unos $5/mes según agregadores, no verificado). Requiere compra: es decisión de Sam. Con cuenta gratuita, la atribución en cada Reel es poco práctica.

### 7c. Sonniss — GDC Game Audio Bundle

`sonniss.com` no resolvió. Todo es `reportado`.

- Licencia mundial, no exclusiva y royalty-free para usar los SFX, comercial y sin atribución (resumen del EULA de 2023).
- Redistribución solo integrada en un proyecto; nunca los sonidos sueltos.
- **Desde el bundle de 2024: prohibido usarlos para entrenar modelos de IA.**
- El EULA cambia cada año.
- Es una descarga de decenas de GB. No hay API.
- **Recomendación: REUTILIZAR** tras leer el `License.pdf` incluido en el bundle del año. Es una fuente de calidad profesional para impactos, whooshes y foley. Hay que registrar el año del bundle en el campo `license`.

### 7d. BBC Sound Effects (RemArc)

Todo es `reportado`.

- Licencia RemArc: solo usos *"personal, educational or research purposes"*. **No comercial**.
- La licencia comercial del archivo BBC se vende a través de Pro Sound Effects.
- **Recomendación: DESCARTAR.** Razón: no permite uso comercial.

---

## 8. Herramientas OSS para sincronía y mezcla deterministas + objetivos de loudness

### FFmpeg

Licencia (medido, `raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md`):
> "Most files in FFmpeg are under the GNU Lesser General Public License version 2.1 or later … Some optional parts … GPL v2+ … you have to explicitly pass `--enable-gpl`."

Filtros (medido, `FFmpeg/FFmpeg/master/doc/filters.texi`):

| Filtro | Qué hace (cita) | Uso en el pipeline |
|---|---|---|
| `adelay` | *"Delay one or more audio channels … If you want to delay exact number of samples, append 'S'"* | Colocar cada SFX en su frame. Usar **muestras** (`S`) y no ms, para que sea exacto: frame × sr / fps (deducido) |
| `atrim` / `afade` / `apad` | recorte, fundidos, relleno | Recortes de takes y colas de música |
| `amix` | *"normalize — Always scale inputs instead of only doing summation … By default is enabled."* | Usar **`normalize=0`** y ganancias explícitas con `volume`. Así el nivel no depende de cuántas entradas haya (deducido) |
| `sidechaincompress` | *"compress detected signal using second input signal. It needs two input streams"* | *Ducking* de la música bajo la voz |
| `loudnorm` | *"EBU R128 loudness normalization … single pass … and double pass"*. `I` por defecto −24; `TP` *"Range is -9.0 - +0.0. Default value is -2.0"*; `linear` exige `measured_*` y si no se cumplen *"normalization mode will revert to dynamic"* | Máster en **dos pasadas, modo lineal**. Comprobar en la salida que no volvió a modo dinámico (deducido) |
| `ebur128` | *"EBU R128 scanner filter … Momentary … Short-term … Integrated … LRA"* | QA final: medir I, LRA y TP |
| `alimiter` | *"lookahead … to prevent your signal from distorting"* | Techo de pico antes del máster |

**Otras piezas reutilizables.**
- `earshot measure` (LUFS, true peak, LRA, sin modelos) y `earshot timeline --cues` (sincronía contra frames) como QA independiente de ffmpeg (medido, README).
- El patrón *"the music steps down before a hit instead of ducking under every effect"*, con `bed_db` de 3–10 dB por rol (medido, README de earshot).

### Objetivos de loudness por plataforma

| Plataforma | Objetivo | Evidencia |
|---|---|---|
| YouTube / Shorts | **−14 LUFS** integrados. YouTube baja lo que está por encima y **no sube** lo que está por debajo. «Content loudness» en *Stats for nerds* | `reportado` (productionadvice.co.uk, meterplugs, prosoundweb). Hay discrepancias de hasta 3 dB entre el valor medido y *Stats for nerds* (reportado, meterplugs 2019). No hay documento oficial de YouTube legible desde la sesión |
| TikTok | **No hay especificación oficial publicada.** Convención de −14 LUFS; algunas fuentes estiman de −14 a −16 | `reportado` (forasoft 2026-06-05, openclip). Una fuente aislada dice de −10 a −12, sin respaldo |
| Instagram Reels | **No hay especificación oficial publicada.** Convención de −14 LUFS | `reportado` (mismas fuentes) |
| Referencia AES TD1008 (streaming) | −16 LUFS en música, −18 en voz, −1 dBTP | `reportado` (production-expert, forasoft). El PDF no se leyó |
| Referencia EBU R128 (difusión) | −23 LUFS; true peak de −1 (difusión) o −3 dBTP (distribución con códec con pérdida) | `reportado` (production-expert) |
| Compuerta usada por earshot / real-sound | **−14 LUFS ±0,5 LU, ≤ −1,5 dBTP** | `medido` (`skills/real-sound/SKILL.md` §10) |

**Propuesta (deducido).**
- Un único máster a **−14 LUFS integrados, TP ≤ −1,5 dBTP** (margen para la recodificación AAC de las plataformas), en `loudnorm` de dos pasadas lineal más una verificación con `ebur128`.
- Guardar el objetivo como dato por plataforma (`platform_loudness: {youtube_shorts:-14, tiktok:-14, reels:-14}`), para poder cambiarlo sin tocar código si alguna plataforma publica una especificación.

---

## Esquema mínimo sugerido para guardar cada sonido como dato (deducido)

Campos:
- `id`, `sha256`, `path`, `kind` (sfx | music | bed)
- `source` (earshot-bank | freesound | openverse→origen | pixabay | mixkit | sonniss-YYYY | elevenlabs-sfx | elevenlabs-music)
- `source_url` (página del ítem, no la del buscador)
- `license` (cc0 | pdm | cc-by-4.0 | pixabay-cl | mixkit-free | sonniss-eula-YYYY | elevenlabs-output | mit-generated)
- `license_url`, `licence_seen` (cita, URL y fecha), `licence_confirmed`
- `author`, `attribution_text` (obligatorio si la licencia es BY)
- `restrictions` (no-standalone | no-content-id | no-ai-training | individual-use-plan)
- `plan_at_creation` (para ElevenLabs), `prompt` (si es IA)
- Medidas: `onset_ms`, `peak_ms`, `lufs_m_max`

La auditoría bloquea en el render cualquier ítem con `licence_confirmed != true` o con una licencia fuera de la lista blanca: cc0, pdm, cc-by, pixabay-cl, mixkit-free, sonniss-eula, elevenlabs-output (plan de pago), mit-generated. Es el mismo criterio que `real-sound/scripts/licences.py`.

---

## Pendientes por verificar (requieren red o una decisión de Sam)

1. Leer en el origen, desde una sesión con estos dominios permitidos:
   - `freesound.org/help/tos_api/`
   - `pixabay.com/service/license-summary/` y `/api/docs/`
   - `mixkit.co/license/`
   - `zapsplat.com/license-agreement`
   - `sonniss.com/gameaudiogdc`
   - los términos actuales de `openverse.org`
2. Confirmar con ElevenLabs si «For Individual Use Only» (Music, Starter) cubre a un estudio que produce para clientes.
3. Decidir sobre compras o contratos (fuera de esta investigación):
   - ZapSplat Premium.
   - Licencia comercial de la API de Freesound.
   - Subir ElevenLabs a Creator o Pro para obtener WAV en SFX.
4. No hay especificación oficial de loudness para TikTok ni Reels. Si hace falta certeza, la vía es medir: subir una pieza de prueba y comparar.
