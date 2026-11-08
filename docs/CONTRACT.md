# CONTRATO DE VIDEOLAB — v1.0.3 (2026-11-07)

**Qué es:** cómo se le pide un video a VideoLab y cómo lo entrega. Lo consumen el carril IID
(`unrlvl-iid-functions`), VoiceLab (le da voz y música) y SocialLab (publica el MP4).
**Forma legible por máquina:** `contract/videolab.contract.json`. El test `tests/contrato_test.mjs`
comprueba que este documento y ese archivo dicen lo mismo.
**Decisiones de Sam en las que se apoya:** 2026-10-31, 2026-11-01 y 2026-11-07 (puntos 1–14 confirmados;
los respaldos no se implementan hasta que hagan falta; UGC y formatos de producto en la primera entrega).

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
    video_style: product_showcase | product_demo | before_after | unboxing | ugc,
    producer?:  render | generative | avatar,   // si falta, sale del dato de la marca
    person_blueprint_id?: string,       // UGC con persona
    duration_target_ms?: number,
    canvas?:    { width, height }       // si llega, debe coincidir con el perfil del formato
  },
  previousOutputs: {
    voice_script:   string,             // lo que se dice, ya juzgado
    on_screen_text: [{ order, text, role: headline | subheadline | cta, emphasis?: string[] }],
    image?:  { url },                   // imagen limpia (sin texto) de ImageLab
    images?: [{ url, role? }],          // varias imágenes (p. ej. before_after)
    video_prompt?: string,              // movimiento de la escena para `generative` (obligatorio ahí), ya juzgado
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

## 3. Estilos de video y productores

| `video_style` | Qué es | Productor por defecto (dato, sobrescribible por marca) |
|---|---|---|
| `product_showcase` | el producto solo, con movimiento, texto y música | `render` |
| `product_demo` | cómo se usa el producto | `generative` |
| `before_after` | comparación de resultado sobre dos imágenes | `render` |
| `unboxing` | apertura del empaque | `generative` |
| `ugc` | una persona habla a cámara | `avatar` |

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
- La foto del avatar sale de la ficha de la persona (`person_blueprints.avatar_photo_url`, decisión de Sam 2026-11-07);
  sin foto en la ficha → `VIDEOLAB_BAD_REQUEST`. Con `person_blueprint_id`, `previousOutputs.image` no hace falta. La voz, de VoiceLab.

## 5. Salida

En `completed`, `lab_jobs.output_parsed`:

```
{
  video: { url, storage_path, poster_url, width, height, fps, duration_ms, codec, audio },
  video_style, producer, provider, model_id, synthetic_person: boolean,
  preset_source: 'brand' | 'system',          // de qué fila salió el preset
  text_layer: { compositor_version, text_rect, markers } | null,   // eco de ImageLab
  unplaced_text: [{ order, role }],           // tramos sin ranura en el compositor (p. ej. un cta): no se inventan
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
