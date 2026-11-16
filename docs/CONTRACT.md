# CONTRATO DE VIDEOLAB — v1.3.0 (2026-11-16)

> Versión anterior de esta cabecera, conservada: «CONTRATO DE VIDEOLAB — v1.2.0 (2026-11-12)». Los cambios de cada
> versión están en §10.

**Qué es:** cómo se le pide un video a VideoLab y cómo lo entrega. Lo consumen el carril IID
(`unrlvl-iid-functions`), VoiceLab (le da voz y música) y SocialLab (publica el MP4).
**Forma legible por máquina:** `contract/videolab.contract.json`. El test `tests/contrato_test.mjs`
comprueba que este documento y ese archivo dicen lo mismo.
**Decisiones de Sam en las que se apoya:** 2026-10-31, 2026-11-01 y 2026-11-07 (puntos 1–14 confirmados;
los respaldos no se implementan hasta que hagan falta; UGC y formatos de producto en la primera entrega), y
2026-11-16 (texto en pantalla editable por pieza, §4 ter).

---

## 1. Transporte — job hijo asíncrono

1. El carril llama a `public.lab_configs.api_endpoint + execute_path` de la fila `lab_key='videolab'`.
   VideoLab no tiene URL cableada en ningún consumidor.
2. `POST /api/execute` valida el pedido, crea una fila en `public.lab_jobs`
   (`lab='videolab'`, `job_type='videolab'`, `parent_job_id` = el job del carril) y responde
   **`202 { job_id, status: 'running' }`** sin esperar el render. La fila nace en `running` porque la ejecución
   se lanza en la misma petición, y porque el trigger `lab_jobs_trigger_worker` despacha al Edge Function
   `lab-worker` toda fila que nace en `pending` o `queued` (v1.0.1, F6).
3. El render corre en un Cloud Run Job del proyecto de GCP del ecosistema.
4. El carril sondea `lab_jobs` por `id` o por `parent_job_id`. Estados: `running → completed | failed`
   (`queued` queda reservado; hoy ninguna fila de VideoLab pasa por él).
5. **Tope de una ejecución: `max_run_ms` = 900 000 (15 min).** El job se cierra en `failed` con `VIDEOLAB_TIMEOUT`
   un minuto antes del tope. Una fila que siga en `running` pasado `created_at + max_run_ms` está muerta (la tarea
   cayó sin escribir): el carril deja de sondearla y la trata como `VIDEOLAB_TIMEOUT`.
6. **Entrega por sondeo.** Un `callback_url` queda para una segunda fase, si hace falta.

Un pedido inválido no crea job: responde `4xx { status:'error', error_label, error }`.

## 2. Pedido

```
POST /api/execute
{
  brandId:      string,                 // obligatorio
  pieceId:      uuid,                   // obligatorio (lo tipa el libro de costos)
  parentJobId:  uuid,                   // obligatorio (lab_jobs.id del carril)
  params: {
    platform:   string,                 // p. ej. meta_ig, meta_fb, tiktok
    format:     'reel',                 // la SUPERFICIE (intel.platform_format_profiles)
    video_style: product_showcase | product_demo | before_after | unboxing | ugc | conversation,
    producer?:  render | generative | avatar,   // si falta, sale del dato de la marca
    person_blueprint_id?: string,       // UGC con persona
    avatar_engine?: string,             // motor del gemelo (avatar_iv por defecto; avatar_iii, avatar_v…)
    duration_target_ms?: number,
    canvas?:    { width, height }       // si llega, debe coincidir con el perfil del formato
  },
  previousOutputs: {
    voice_script:   string,             // lo que se dice, ya juzgado
    on_screen_text: [{ order, text, role: headline | subheadline | cta, emphasis?: string[] }],
    image?:  { url },                   // imagen limpia (sin texto) de ImageLab
    images?: [{ url, role? }],          // varias imágenes (p. ej. before_after)
    video_prompt?: string,              // movimiento de la escena para `generative` (obligatorio ahí), ya juzgado
    text_layers?: { … },                // capas de texto editables (§4 ter); en `conversation` se dibujan sobre el final
    voice?:  { audio_url, duration_ms, alignment?, person_id?, consent_ref? },   // de VoiceLab
    music?:  { audio_url, duration_ms, loudness_lufs?, license? }                // de VoiceLab
  }
}
```

**Reglas del pedido:**
- `format` es la superficie y vale `reel`. `video_style` es un eje aparte y **no** reparte el 50 % de reel.
- El texto (`voice_script`, `on_screen_text`) llega **ya juzgado** y se usa **tal cual**. VideoLab no
  escribe, recorta, traduce ni completa texto. Si un tramo no entra → `VIDEOLAB_TEXT_DOES_NOT_FIT` con su `order`.
- `role` y `emphasis` usan el vocabulario del compositor de ImageLab, que es quien dibuja la capa de texto.
- **Modo sólo texto (v1.3.0).** Con `params.mode = 'text_layers'` el pedido tiene otra forma (§4 ter.1): no lleva
  `video_style`, `voice_script` ni `on_screen_text`, y `parentJobId` es opcional. Cualquier otro `params.mode` →
  `VIDEOLAB_BAD_REQUEST`.

## 3. Estilos de video y productores

| `video_style` | Qué es | Productor por defecto (dato, sobrescribible por marca) |
|---|---|---|
| `product_showcase` | el producto solo, con movimiento, texto y música | `render` |
| `product_demo` | cómo se usa el producto | `generative` |
| `before_after` | comparación de resultado sobre dos imágenes | `render` |
| `unboxing` | apertura del empaque | `generative` |
| `ugc` | una persona habla a cámara | `avatar` |
| `conversation` | una conversación en un set: turnos, cortes por toma, sólo quien habla se anima (§4 bis) | `avatar` |

| Productor | Qué hace | Proveedor activo | Respaldo |
|---|---|---|---|
| `render` | render propio: imagen(es) + movimiento + capa de texto + voz + música | propio (ffmpeg en Cloud Run) | — |
| `generative` | clip a partir de una imagen | Veo 3.1 Fast (Vertex) | Seedance — **no se implementa hasta que haga falta** |
| `avatar` | persona que habla con su voz | HeyGen Avatar IV | Hedra — **no se implementa hasta que haga falta** |

- **Todo lo que distingue a una marca es dato:** estilo por defecto, productor por estilo, presets de
  movimiento y ritmo, tope de gasto. Viven en tablas (`videolab_params`, `videolab_producers`), se
  resuelven por `brandId` y nunca aparecen en el código.
- **El clip de `generative` y de `avatar` pasa por el mismo ensamblado del render propio** (capa de texto,
  voz, música, portada), para que todas las salidas cumplan la misma especificación.

## 4. UGC y personas

- La persona sale de `person_blueprints` (`person_blueprint_id`). **Si es real o sintética es dato** de la
  persona y de la marca, nunca una rama de código.
- **Persona real:** exige consentimiento vigente en `public.person_consents` para el ámbito que use
  (`voice`, `image`, `avatar`). Sin fila vigente → `VIDEOLAB_CONSENT_MISSING` y **no se llama al proveedor**.
- **Persona sintética:** el pedido no trae `person_blueprint_id` (la imagen es de una persona generada). No exige
  consentimiento y la salida lleva `synthetic_person: true`. Con `person_blueprint_id`, la persona es real y se exige.
- **Generative (F5):** Veo 3.1 Fast anima la imagen limpia ya ajustada al lienzo, en clips de 8 s (hasta 3) según la
  duración de la voz, con `video_prompt`. **Avatar (F5):** HeyGen anima la misma imagen con la voz de VoiceLab
  (`type: image`, Avatar IV); los subtítulos salen de `voice.alignment.words`, con la familia de la marca
  (`brand_typography`, rol del preset). El tope mensual (`videolab_producers`) se comprueba antes de llamar.
  La dirección del avatar —`expressiveness` y `motion_prompt` de HeyGen— es dato del preset (`videolab_params.motion.avatar`),
  sobrescribible por marca. Con `motion.avatar.picks`, cada video elige acciones del catálogo `videolab_avatar_direction`
  (cara, ojos, cabeza, manos, cabello, postura, mirada) con una semilla por job, y la salida dice cuáles usó (`avatar_direction`).
  Con `motion.avatar.lead_ms`/`tail_ms`, la voz lleva silencio antes y después: el avatar empieza y termina en reposo y la
  portada sale de ese reposo (no empieza ni termina con la boca abierta).
- La foto del avatar sale de la ficha de la persona (`person_blueprints.avatar_photo_url`, decisión de Sam 2026-11-07);
  sin foto en la ficha → `VIDEOLAB_BAD_REQUEST`. Con `person_blueprint_id`, `previousOutputs.image` no hace falta. La voz, de VoiceLab.
- **Gemelo digital (v1.0.5, decisión de Sam 2026-11-11).** Si la ficha tiene `person_blueprints.avatar_look_id` (el look de
  HeyGen), el avatar se anima desde ese look (`type: avatar`) y no desde la foto. El motor sale de `params.avatar_engine`,
  si no del preset (`motion.avatar.engine`), si no `avatar_iv`; se valida contra los motores que el propio look declara
  (`supported_api_engines`) y un motor que no admite → `VIDEOLAB_BAD_REQUEST`. La tarifa sale de `ops_lab_rates` con el
  motor y el tipo de look (p. ej. `avatar-iv-digital-twin`); sin fila vigente, el job falla antes de llamar al proveedor.
  `motion_prompt` sólo viaja a los motores que lo admiten y `expressiveness` sólo a una foto con Avatar IV. Sin foto en la
  ficha, la imagen del gemelo sirve para colocar el texto. Sin `avatar_look_id`, todo sigue como en v1.0.4.

## 4 bis. Conversación — `conversation` (v1.1.0 y v1.2.0, decisiones de Sam 2026-11-11 y 2026-11-12)

- **El estudio es dato:** `params.location_blueprint_id` apunta a `location_blueprints`; su `raw_config.shot_catalog` declara
  las tomas (`id`, `aspect`, y `animate` = la silla que esa toma anima, o `null`). La marca debe tener el estudio en
  `brand_locations` (su `active` es del carril, no de VideoLab). El elenco del episodio es `params.cast` (silla → persona).
- **Las tomas las hace ImageLab, una vez por episodio, con las personas dentro**, y llegan en `previousOutputs.shots`
  (`shot_id`, `url`, `focus_x` opcional para recortar una toma 16:9 al lienzo vertical).
- **Turnos:** `previousOutputs.turns` = `[{ seat, voice: { audio_url, duration_ms }, engine?, cuts: [{ shot_id, at_ms }] }]`.
  Cada corte dura hasta el siguiente o hasta el final de la voz del turno.
- **Regla de animación:** se anima **sólo a quien habla y sólo en una toma cuyo `animate` es su silla** (está sola en
  cuadro). Cualquier otro corte es la imagen fija con un acercamiento lento. Sin máscaras: nadie que escucha se anima.
  Un turno sin ningún corte animado → `VIDEOLAB_BAD_REQUEST`.
- **Motores por imagen:** `avatar_iv` (`POST /v3/videos`, `type: image`), `heygen-avatar-6` y `heygen-avatar-6-turbo`
  (`POST /v3/models/avatars`). El motor sale de `turn.engine`, si no de `motion.avatar.engine` del preset, si no `avatar_iv`.
  La tarifa es la fila del motor en `ops_lab_rates` (`avatar-iv`, `heygen-avatar-6`, `heygen-avatar-6-turbo`).
- **Consentimiento:** cada persona que habla necesita `avatar` vigente en `person_consents`.
  **v1.3.1 (2026-11-16):** salvo que su ficha diga `person_kind = 'synthetic'` (`person_blueprints`, migración
  `20261116153000` de unrlvl-iid-functions): una persona sintética no tiene a nadie que consienta. `real` o sin marcar
  (NULL) la sigue necesitando. Quien habla y no está en `person_blueprints` → `VIDEOLAB_BAD_REQUEST`. La salida dice
  `conversation.synthetic_speakers`.
- **Costo:** el tope del productor `avatar` se comprueba con la suma de todos los cortes animados antes de llamar; cada
  llamada a HeyGen asienta su fila.
- **Técnicas de escena (v1.2.0).** `params.technique_id` nombra una técnica de `public.videolab_scene_techniques`
  (validada por Sam en `skills/audiovisual-techniques`). Con ella, un turno **puede llegar sin cortes**: VideoLab los
  arma recorriendo `cut_plan.sequence` (roles de cámara relativos a quien habla: `speaker`, `listener`, `wide`, cada uno
  con encuadres preferidos del `framing` de la toma), con `cut_plan.cut_ms` y `min_cut_ms`. `moves.speaker` (`drift`)
  aplica un reencuadre y paneo lentos a los cortes animados. Una técnica de otro estilo, inactiva o inexistente →
  `VIDEOLAB_BAD_REQUEST`. Una técnica nueva es una fila, no código. La salida dice `technique_id` y los segmentos.
- **Montaje:** los cortes en orden, la voz de los turnos seguida, y la capa de texto de ImageLab encima si hay titular.
  La salida suma `podcast: { location_blueprint_id, segments }`.

## 4 ter. Texto en pantalla editable — capas de texto (v1.3.0, decisión de Sam 2026-11-16)

Objetivo: en cada pieza, el operador cambia el texto en pantalla (gancho, rol de cada persona, subtítulos, títulos
clave, CTA y franja) y VideoLab vuelve a renderizar **sólo el texto** sobre el video limpio, sin regenerar tomas. Lo
dibuja `render/src/textlayers.mjs` como un guion ASS (libass) más un `drawbox` para la franja.

### 4 ter.1 Modo `text_layers` (no llama a HeyGen, Veo ni ImageLab)

```
POST /api/execute                                  // mismo transporte: 202 + lab_jobs (§1)
{ brandId, pieceId, parentJobId?,                  // parentJobId opcional: lab_jobs.id del job que produjo el video (assets.video.lab_job_id)
  params: { mode: 'text_layers', platform, format: 'reel', safe_zone_canal?, canvas? },
  previousOutputs: {
    base_video: { url },                           // el video limpio (clean_video de la conversación)
    timeline?:  { words: [{ text, start_ms, end_ms, person_id }], turns: [{ person_id, start_ms, end_ms }],
                  faces?: [{ box: { x, y, w, h }, start_ms?, end_ms?, person_id? }] },   // cajas en % del lienzo
    text_layers: {
      hook?:       { text, preset_key, start_ms, end_ms, emphasis?: [texto] } | null,
      roles?:      [{ person_id, text, show, at_ms, dur_ms, preset_key }],
      captions?:   { enabled, preset_key, accent_role? } | null,     // accent_role: rol de brand_palette
      key_titles?: [{ text, at_ms, dur_ms, preset_key }],
      cta?:        { text, at_ms, dur_ms?, preset_key } | null,       // sin dur_ms, hasta el final
      identity?:   { strip, strip_role? } } } }                       // strip_role: rol de brand_palette
```

**Reglas de la forma** (las comprueba `api/execute` con la misma función que el job, `validateTextLayers`):
`preset_key` y `text` no vacíos; `start_ms`, `at_ms` ≥ 0; `end_ms` > `start_ms`; `dur_ms` > 0; al menos una capa; un
rol con `show: false` se ignora; con subtítulos encendidos, `timeline.words` es obligatorio. Si no →
`VIDEOLAB_BAD_REQUEST` y no se crea job.

**Salida** (`lab_jobs.output_parsed`):

```
{ mode: 'text_layers',
  video: { url, storage_path, poster_url, width, height, fps, duration_ms, codec, audio, bytes },
  clean_video: { url },                     // el base_video recibido
  text_layers: <eco del pedido>,
  text_layout: { canal, metrics: 'font' | 'estimate', blocks: [{ layer, preset_key, rect, start_ms, end_ms }] },
  provider: 'unrlvl', model_id: 'videolab-render-cloud-run', cost_usd, ledger_ids }
```

Mismo esquema de rutas (`videolab/<brandId>/<pieceId>/<job_id>.mp4` y `.jpg`), misma especificación del MP4 (§5) y un
asiento del render en `ops_generation_ledger` por `ops_log_generation` (§6).

### 4 ter.2 Conversación: video limpio y timeline

En `conversation`, antes de dibujar nada encima, el job sube el montaje **limpio** (cortes + voces, sin capa ni
subtítulos) en `videolab/<brandId>/<pieceId>/<job_id>_clean.mp4` y la salida suma:

```
clean_video: { url, storage_path },
timeline: { words: [{ text, start_ms, end_ms, person_id }],            // tiempos absolutos del video final
            turns: [{ turn, seat, person_id, start_ms, end_ms }],
            turns_without_words: [índice] },                           // turnos sin voice.alignment.words
text_layers: <eco> | null, text_layout: { … } | null
```

Las palabras salen de `turns[].voice.alignment.words` de VoiceLab, sin las etiquetas de interpretación entre corchetes.
Si el pedido trae `previousOutputs.text_layers`, las capas se dibujan sobre el final con el mismo módulo y **no se pide
la capa de ImageLab** (el texto editable la sustituye). El guion se arma ANTES de llamar a HeyGen: un preset, un color o
una fuente que falta falla sin gastar.

### 4 ter.3 Presets — `public.videolab_text_presets` y el esquema de `spec`

Los presets son **dato**: la fila de la marca (`brand_id`) manda sobre la del sistema (`brand_id` NULL); una fila de la
marca inactiva apaga el preset para esa marca. Inexistente, inactivo, retirado (`status = 'retired'`) o de otra capa →
`VIDEOLAB_BAD_REQUEST`. La siembra (17 presets de sistema, `status = 'proposed'`) está en `docs/text_presets_seed.json`,
para que la migración de datos la copie tal cual.

**Esquema de `spec`** (todas las claves son opcionales salvo donde se indica; los porcentajes son del lienzo):

| Clave | Tipo | Qué hace | Por defecto |
|---|---|---|---|
| `entry` | `fade` \| `pop` \| `pop_words` \| `mask` \| `type` \| `punch` \| `slide` \| `rise` \| `draw` | animación de entrada | `fade` |
| `duration_ms` | número | duración de la entrada (en `type`, el tiempo total de escritura) | 300 |
| `stagger_ms` | número | separación entre palabras (`pop_words`) o letras (`type`) | 120 / según `duration_ms` |
| `scale_from` | número | escala inicial (`pop`, `pop_words`, `punch`) | 0,85 (`punch`: 1,3) |
| `blur_from` | número | desenfoque inicial (`punch`) | 4 |
| `slide_from_pct` | número | desplazamiento inicial (`slide`: % del ancho; `rise`: % del alto) | 3 / 1,5 |
| `exit_ms` | número | fundido de salida | 200 |
| `font_role` | rol de `brand_typography` | familia de la marca | `display` en hook, key_title y cta; `body` en role y caption |
| `bold`, `uppercase` | booleano | peso y mayúsculas de presentación (el texto no se reescribe) | `false` |
| `size_pct`, `min_size_pct` | número (% del alto) | tamaño; si no cabe, baja de 0,2 en 0,2 hasta el mínimo | 4 / `size_pct` |
| `max_lines` | entero | líneas como máximo | 3 (caption 2) |
| `max_width_pct` | número (% del ancho seguro) | ancho máximo del bloque | 100 (role 80) |
| `line_height` | número | interlineado para la geometría | 1,2 |
| `anchor` | `top` \| `center` \| `above_captions` | dónde va el bloque | hook `top`, key_title `center`, cta `above_captions` |
| `align` | `left` \| `center` | alineación (el rol siempre `left`) | `center` |
| `color`, `emphasis_color` | color | texto y palabras de `emphasis` | `text` (role `text_body`) / `accent` |
| `outline` | `{ color, width_pct }` | contorno | sin contorno |
| `shadow` | `{ color, depth_pct, alpha }` | sombra | sin sombra |
| `box` | `{ color, opacity, pad_x_pct, pad_y_pct, radius_pct }` | caja detrás del texto | sin caja |
| `rule` | `{ color, width_pct, thickness_pct, gap_pct, position: above \| below }` | filete | sin filete |
| `loop` | `{ type: 'shimmer', period_ms, intensity }` | latido suave de la caja (CTA) | sin latido |
| `split_on` | texto | corta el texto en líneas en ese separador (rol en dos líneas) | — |
| `group_min`, `group_max`, `max_gap_ms` | números | subtítulos: grupos de 3–4 palabras, corte en puntuación, cambio de persona o pausa | 3 / 4 / 700 |
| `active_word` | `{ color, scale }` | subtítulos: la palabra que suena | `{ color: 'accent', scale: 1 }` |

**Colores.** Un color es un **hueco** que se resuelve con el dato de la marca, `palette:<rol>` (sólo en filas de
marca) o un hex neutro escrito en el dato (p. ej. negro de contorno). Huecos: `text` (`tokens.palette.headline` de
`imagelab_overlay_tokens` de la marca), `text_body` (`tokens.palette.subheadline`), `accent` (`captions.accent_role` del
pedido, si no `tokens.palette.headline_emphasis`, si no `tokens.layout.rule.palette`), `scrim`
(`tokens.layout.scrim.palette`), `rule` (`tokens.layout.rule.palette`) e `identity` (`identity.strip_role` del pedido, si
no `tokens.identity.palette`). Cada rol se busca en `public.brand_palette`; un hueco sin rol o un rol que la marca no
tiene → `VIDEOLAB_BAD_REQUEST`.

**Fuentes.** `brand_typography` por rol (`font_family`, `css_import`); sin la fila → `VIDEOLAB_BAD_REQUEST`. El texto se
mide con las métricas reales de la fuente (TrueType/OpenType); si no se pueden leer, con una medida conservadora que
sobrestima (`text_layout.metrics = 'estimate'`).

### 4 ter.4 Geometría y anti-choque

- **Zona segura:** `imagelab_overlay_tokens.tokens.layout.safe_zone_pct` del canal. El canal sale de
  `intel.platform_format_profiles.video_text_canal` (columna propia desde la migración `20261116130000`; `image_canal` es el canal de los presets de imagen y no se usa aquí); si el perfil no lo declara (antes de esa migración, los perfiles `reel` no lo declaraban
  [medido 2026-11-16]), del pedido (`params.safe_zone_canal`); sin ninguno → `VIDEOLAB_BAD_REQUEST`. La fila de la marca
  para ese canal manda sobre la del sistema.
- Todo bloque, con su caja, contorno, sombra y filete, cae **dentro** de la zona segura; cada evento lleva además un
  recorte a la zona segura. Un texto que no entra con `max_lines` ni con `min_size_pct` → `VIDEOLAB_TEXT_DOES_NOT_FIT`
  (no se corta ni se desborda).
- **Subtítulos:** banda fija al fondo de la zona segura, alto = `max_lines` líneas al tamaño del preset.
- **Rol:** encima de la banda con un margen ≥ 2 % del alto, alineado al borde seguro izquierdo. Si `timeline.faces`
  declara una cara en su tramo (o hay otro texto en ese tramo), sube hasta no tocarla; sin lugar →
  `VIDEOLAB_TEXT_DOES_NOT_FIT`. Su entrada dura ≤ 350 ms y no rebota (un preset de rol más lento →
  `VIDEOLAB_BAD_REQUEST`).
- **Bloques colocados a mano (v1.3.3):** con `place` en un bloque, manda el operador (ver §10, v1.3.3). Sin `place`, la
  colocación automática de abajo.
- **Gancho, títulos clave y CTA (v1.3.2, 2026-11-16):** se colocan en el ancla de su preset y, si en su tramo tapan una
  cara de `timeline.faces` u otro texto, se corren en vertical dentro de la zona segura y sobre los subtítulos. Sin
  lugar libre quedan en su ancla y `text_layout.warnings` lleva `TEXT_OVER_FACE` (nunca se descarta texto en silencio).
- **Caras de cada toma (v1.3.2):** en la conversación, si el pedido no trae `timeline.faces`, VideoLab se las pide a
  ImageLab (`/api/compose` modo `faces`, una llamada por imagen; el detector es de ImageLab) y las pone en el lienzo con
  el mismo recorte del render (`facesOnCanvas`). Van en el `timeline` de salida, así «Editar texto» las reutiliza. Si
  ImageLab no responde para una toma, esa toma no aporta caras y el render sigue.
- Dos bloques que coinciden en el tiempo no pueden solaparse en el espacio: el segundo se corre; si no hay lugar →
  `VIDEOLAB_TEXT_DOES_NOT_FIT`.
  > ⛔ NO OPERATIVO — redacción anterior (v1.3.1), se conserva por trazabilidad: «Dos bloques que coinciden en el tiempo
  > no pueden solaparse en el espacio → `VIDEOLAB_TEXT_DOES_NOT_FIT`.»
- **Franja de identidad:** `drawbox` con `tokens.identity` de la marca (`mode` `edge_left` \| `edge_right`, `width_pct`,
  `full_bleed`); sin `identity` en los tokens → `VIDEOLAB_BAD_REQUEST`.

## 5. Salida

En `completed`, `lab_jobs.output_parsed`:

```
{
  video: { url, storage_path, poster_url, width, height, fps, duration_ms, codec, audio },
  video_style, producer, provider, model_id, synthetic_person: boolean,
  preset_source: 'brand' | 'system',          // de qué fila salió el preset
  avatar_direction: { expressiveness, picked: [id] } | null,   // acciones del catálogo usadas (productor avatar)
  avatar_subject: { mode, engine, look_id, avatar_type } | null, // gemelo o foto, y con qué motor (productor avatar)
  text_layer: { compositor_version, text_rect, markers } | null,   // eco de ImageLab
  unplaced_text: [{ order, role }],           // tramos sin ranura en el compositor (p. ej. un cta): no se inventan
  clean_video: { url, storage_path } | null,  // v1.3.0: montaje limpio (conversation)
  timeline: { words, turns, turns_without_words } | null,   // v1.3.0 (conversation)
  text_layers, text_layout,                   // v1.3.0: eco y geometría de las capas de texto, o null
  cost_usd, ledger_ids: [...]
}
```

**Render propio (F4, 2026-11-07):** fabrica `product_showcase` y `before_after`. El titular es el primer `headline` y la
bajada el primer `subheadline` de `on_screen_text`; un `cta` hoy no tiene ranura en el compositor y se devuelve en
`unplaced_text`. Los subtítulos llegan con el productor `avatar` (F5).

**Especificación del MP4** (se verifica con `ffprobe` en cada salida; si no cumple → `VIDEOLAB_OUTPUT_INVALID`):

| Campo | Valor |
|---|---|
| Lienzo | el del perfil del formato (`intel.platform_format_profiles`); hoy, reel = 1080×1920 |
| Video | H.264, `yuv420p`, 30 fps constantes, `+faststart` |
| Audio | AAC 48 kHz estéreo, voz + música mezcladas dentro del archivo |
| Duración | máximo 60 s |
| Tamaño | máximo 50 MB (límite del bucket) |
| Portada | JPG del mismo lienzo, en `poster_url` |

**Dónde queda:** bucket `unrlvl-media`, ruta `videolab/<brandId>/<pieceId>/<job_id>.mp4` (portada `.jpg` al lado).
El carril guarda el resultado en `content_pieces.assets.video` y el estilo en `assets.format.video_style`.

## 6. Costo

Cada llamada a un proveedor (Veo, HeyGen) y cada render asientan **una fila** en
`public.ops_generation_ledger` con `lab='videolab'`, con la tarifa vigente de `public.ops_lab_rates`.
Sin tarifa vigente, el job falla antes de llamar al proveedor. El tope mensual por productor es dato
(`videolab_producers`); al alcanzarlo → `VIDEOLAB_SPEND_CAP`.

## 7. Errores (`error_label` estables)

| `error_label` | Cuándo |
|---|---|
| `VIDEOLAB_BAD_REQUEST` | falta un campo obligatorio o tiene otra forma |
| `VIDEOLAB_STYLE_NOT_DECLARED` | la marca no declara el `video_style` pedido |
| `VIDEOLAB_PRODUCER_NOT_ACTIVE` | el productor no está activo para esa marca |
| `VIDEOLAB_CONSENT_MISSING` | persona real sin consentimiento vigente para el ámbito |
| `VIDEOLAB_TEXT_DOES_NOT_FIT` | un tramo de texto no entra en la zona segura |
| `VIDEOLAB_CANVAS_MISMATCH` | el lienzo pedido no coincide con el del perfil del formato |
| `VIDEOLAB_PROVIDER_FAILED` | el proveedor falló o no respondió a tiempo |
| `VIDEOLAB_SPEND_CAP` | se alcanzó el tope mensual del productor |
| `VIDEOLAB_OUTPUT_INVALID` | el MP4 no cumple la especificación de §5 |
| `VIDEOLAB_TIMEOUT` | el render superó el tope de una ejecución (§1, `max_run_ms`) |

## 8. Fuera de este contrato

- La UI (ver `docs/PLAN_UI_UNICA.md`).
- Stories verticales de piezas de imagen.
- Los respaldos Seedance y Hedra (se implementan sólo si hacen falta).

## 9. Test de la marca N+1

1. **¿Sobrevive a otra marca de otro rubro y otro país?** Sí: estilos, productores, presets, personas y
   topes se resuelven por `brandId` desde tablas. Agregar una marca es un `INSERT`.
2. **¿Los nombres describen la función o el caso?** La función: `video_style`, `producer`, `render`,
   `generative`, `avatar`, `person_consents`, `synthetic_person`.
3. **¿Eje o instancia?** Eje en el contrato y el código; instancia (Veo, HeyGen, la persona, el tope) en el dato.
4. **¿Cuántas marcas hay en las enumeraciones?** Cero. `tests/contrato_test.mjs` falla si aparece una.

## 10. Registro de cambios

- **v1.3.3 · aclaración (2026-11-16)** — `parentJobId`, cuando viaja, es **un `lab_jobs.id`**: el job del lab que produjo
  el video (en el modo `text_layers`, `assets.video.lab_job_id` de la pieza). Un id de otra tabla viola la FK
  `lab_jobs_parent_job_id_fkey`; antes salía como `VIDEOLAB_PROVIDER_FAILED` 502 y ahora sale como
  `VIDEOLAB_BAD_REQUEST` 400, con el motivo. Sin cambio de forma.
- **v1.3.3 (2026-11-16)** — Bloques colocados a mano (objetivo validado por Sam: una sola ventana de texto para imagen y
  video con X, Y y zoom por bloque). `hook`, `key_titles[i]`, `cta` y `roles[i]` aceptan `place: { x_pct, y_pct, zoom }`
  (centro del bloque en % de la zona segura; zoom 0,7–1,3 sobre el tamaño del preset); `captions.place` sólo `{ zoom }`.
  Con `place` el bloque no esquiva: se acota a la zona segura (`TEXT_PLACE_CLAMPED`) y avisa si tapa una cara
  (`TEXT_PLACED_OVER_FACE`) o pisa otro texto (`TEXT_PLACED_OVERLAP`). `text_layout.blocks[].placed` = `auto` | `manual`.
  Sin `place`, idéntico a v1.3.2.
- **v1.3.2 (2026-11-16)** — Las caras mandan en todas las capas (Sam: «corrige lo de las caras de forma permanente»).
  El gancho, los títulos clave y el CTA esquivan caras y otros textos de su tramo (antes, sólo el rol). En la conversación,
  las caras de cada toma se piden a ImageLab (`/api/compose` modo `faces`) cuando el pedido no las trae. `text_layout`
  suma `warnings`. Motivo medido: en la prueba del set de conversación (`lab_jobs` 178d2258), el CTA y un título clave
  cayeron sobre la cara de quien hablaba.
- **v1.3.0 (2026-11-16)** — Texto en pantalla editable por pieza (decisión de Sam 2026-11-16). Nuevo `params.mode =
  'text_layers'` (§4 ter.1): sólo texto sobre el video limpio, sin proveedores. `conversation` sube el montaje limpio
  (`clean_video`), devuelve el `timeline` de la voz y aplica `previousOutputs.text_layers` sobre el final (§4 ter.2).
  Presets de texto como dato en `public.videolab_text_presets` con el esquema de `spec` de §4 ter.3 y la siembra en
  `docs/text_presets_seed.json`. Geometría y anti-choque en §4 ter.4. Sin `error_label` nuevos.
- **v1.2.0 (2026-11-12)** — Técnicas de escena en `conversation` (§4 bis).
- **v1.1.0 (2026-11-11)** — Estilo `conversation` (§4 bis).
- **v1.0.5 (2026-11-11)** — Gemelo digital del avatar con el motor elegido (§4).
- **v1.0.0–v1.0.4** — Transporte asíncrono, pedido, estilos, productores, UGC, salida, costo y errores (§1–§7).
