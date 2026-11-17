# MOTOR DE SONIDO — F2 (fondo y efectos), F1 (en el job) y F0 (prueba medida) · 2026-11-17

> Cabecera anterior, conservada: «MOTOR DE SONIDO — F1 (en el job) y F0 (prueba medida) · 2026-11-17».

## F2 — fondo y efectos por separado (2026-11-17)

**Decisiones de Sam** (por la sesión del Orchestrator y confirmadas aquí: «sí al objetivo F2, silenciar sí, lista de B»):

1. Los controles de sonido son un botón junto a «Texto en pantalla» en la tarjeta de cada pieza, que abre la ventana de
   Controles de Sonido.
2. En esa ventana van separados «Sonidos de fondo» y «Efectos de sonido». Cada uno tiene presets, acceso a la librería y
   volumen.
3. El fondo entra en la rotación; los efectos van según lo que pida la pieza.

**Qué se construyó:**

- **Datos (`unrlvl-iid-functions`):**
  - `videolab_sound_presets.kind` con los valores `bed`, `effects` y `mixed`;
  - 6 presets de fondo, uno por cama;
  - 6 de efectos: Discreto, Cálido, Brillante, Para cifras, Amable y Mínimo (`docs/sound_presets_f2.json`);
  - los 6 de la F1 quedan `mixed`.
- **VoiceLab:** `GET /api/sound-library` lista los sonidos activos que ve la marca, con URL de escucha (contrato VoiceLab v1.2
  §3 ter).
- **Job (contrato v1.10.0 §4 ter.8):** `composeSoundSpec` arma la mezcla así:
  - toma la cama del preset de fondo y los momentos del preset de efectos;
  - aplica encima lo elegido de la librería y los volúmenes;
  - un momento con `null` queda en silencio y no se pide a VoiceLab;
  - lo demás (huellas, hoja de entradas, ducking, sonoridad final, `SOUND_FALLBACK`) no cambia respecto de la F1.
- **Rotación:** `GET /api/text-styles` sugiere el fondo (`suggested.sound_bed`) con la misma regla del menos usado que el
  texto.

**Por qué un preset de efectos declara todos los momentos:** la ventana puede poner un sonido de la librería en cualquier
momento. Si el preset no lo declarara, el nivel y el desfase de ese momento habría que inventarlos en el código. Por eso
«Mínimo» trae sus siete momentos y cinco de ellos en silencio (`"sound": null`).

## F1 — la capa de sonido entra en el job (2026-11-17)

**Encargo de Sam:** «sí a la F1 de sonido… supongo que tendremos una buena librería de sonidos y efectos. make me proud!».

- **Librería (VoiceLab#11):** 25 sonidos propios, 19 efectos con variantes por función y 6 camas en bucle sin costura.
  Están en `voicelab/sound-library/v2/`, y lo publicado es idéntico byte a byte a lo generado (*medido*). Se sirven por
  el modo `sound`, sin costo.
- **Datos (`unrlvl-iid-functions#621`):** `voicelab_sound_library` (25 filas) y `videolab_sound_presets` (6 presets, `proposed`):
  `sound_soft_pulse`, `sound_warm_calm`, `sound_bright_upbeat`, `sound_friendly_marimba`, `sound_tension_numbers` y
  `sound_lofi_close` (`docs/sound_presets_f1.json`).
- **Job (este repo, contrato v1.9.0 §4 ter.8):**
  - `text_layers.sound` activa la capa; VideoLab pide los archivos a VoiceLab y verifica su sha256;
  - la voz se lleva a la referencia del preset (−20 LUFS) y la cama queda `under_voice_lu` por debajo, según la
    sonoridad medida de cada archivo;
  - la sonoridad final es la de la plataforma;
  - si algo falla, `SOUND_FALLBACK` y el audio original.

**Medido en el banco**, con los 6 presets sobre la pieza de los sofás (job `c739b638`):

| Preset | Sonoridad final | Pico | Cama + efectos (sin voz) | Mismo audio en 2 corridas |
|---|---|---|---|---|
| `sound_soft_pulse` | −14,1 LUFS | −1,9 dBTP | −36,7 LUFS | sí |
| `sound_warm_calm` | −14,1 | −1,8 | −36,4 | sí |
| `sound_bright_upbeat` | −14,1 | −1,7 | −37,7 | sí |
| `sound_friendly_marimba` | −14,1 | −1,6 | −36,6 | sí |
| `sound_tension_numbers` | −14,1 | −1,9 | −36,7 | sí |
| `sound_lofi_close` | −14,1 | −1,5 | −35,2 | sí |

- La voz queda en −20 LUFS en las 6 mezclas, y cama más efectos entre 15 y 17 LU por debajo.
- La capa añade de 6,3 a 6,8 s por pieza de 58 s.
- Muestras: `unrlvl-media/videolab/<marca>/sin-pieza/muestras-sonido-f1/<preset>.mp4`.

**Falta** (necesita el sí de Sam):
- aplicar la migración, mergear VoiceLab#11 y redesplegar el job;
- medir en Cloud Run con Intel y AMD;
- los controles en el Orchestrator, que se acuerdan con la sesión B;
- validar los presets de oído.

---

# F0 (prueba medida, sin producción) · 2026-11-17

**Encargo.** Sam, transmitido por la sesión «A - [VideoLab] Launch»: «implementemos la parte de sonido».

**Objetivo validado por Sam (2026-11-17)**, ajustado con su decisión del mismo día («la idea es que sea nuestro motor y
librería propia good enough sin royalties a nadie»):

> VideoLab mezcla una capa de sonido propia y determinista sobre la voz:
> - efectos en el fotograma exacto de las entradas de texto, las cifras y los cortes, tomados del mismo timeline del motor
>   HTML;
> - cama musical con ducking bajo la voz;
> - sonoridad final por plataforma, guardada como dato.
>
> Cada sonido es dato y es **propio** (sintetizado por código), con CC0 sólo como complemento opcional: **sin CC-BY y sin
> regalías**. El mismo pedido da el mismo audio, y el render de 60 s sigue en 5 minutos o menos.

**Reparto validado por Sam (2026-11-17):** «si piensas que es VoiceLab y VideoLab la consume, pues bien... hazlo».
- **VoiceLab** es dueño de la librería: las recetas, los archivos generados, su huella y su licencia.
- **VideoLab** es dueño de la colocación (la hoja de entradas) y de la mezcla en el render. La mezcla ya existía para voz
  más música (`render/src/assemble.mjs` y `plan.mjs`, `preset.audio_mix`).

---

## 1. Licencias y fuentes — qué se reutiliza, qué se construye y qué se descarta

El informe completo, con citas y la etiqueta de cada dato, está en `docs/SONIDO_LICENCIAS.md`. Límite: la red de la sesión
bloqueó varias páginas oficiales. Lo leído en GitHub y en `elevenlabs.io` está *medido*; el resto, *reportado*.

| Fuente | Decisión | Por qué |
|---|---|---|
| **Earshot** (`Leonxlnx/earshot`, MIT, *medido* en su `LICENSE`) | **Construir el equivalente; tomar sólo ideas** | Demuestra que los efectos sintetizados por código sirven. Nuestro sintetizador es propio y no copia su código. |
| **«Real SFX»** | **No existe con ese nombre** (*no verificado*) | El candidato más cercano es la skill `real-sound` de Earshot. De ella se toma la idea: sonido en el fotograma que calcula el código y auditor de licencias. |
| **Openverse** | **Descartar en el carril** | Su filtro «comercial» deja pasar ND, SA y Sampling+ (*medido* en su código). Sólo sirve como buscador manual para CC0. |
| **ElevenLabs, efectos** | **Opcional, no se usa en la base** | Uso comercial desde Starter, sin atribución (*medido*). Lo propio cubre lo necesario sin depender del proveedor. |
| **ElevenLabs, música** | **Descartar mientras no se aclare** | Hasta el plan Pro dice «uso individual» (*medido*). Puede no cubrir a un estudio que produce para clientes. |
| **Freesound** | **Descartar la API** | Su API comercial requiere un acuerdo de pago (*medido* en su repo). Sus CC0, elegidos a mano, sí sirven como complemento. |
| **Pixabay, Mixkit, Sonniss** | **Complemento opcional, a mano** | Uso comercial sin atribución (*reportado*). No hacen falta para la base. |
| **ZapSplat, BBC RemArc** | **Descartar** | ZapSplat exige atribución salvo en Premium, que es de pago. RemArc no permite uso comercial (*reportado*). |
| **FFmpeg** (LGPL) | **Reutilizar** | Ya es nuestro motor de mezcla: `adelay`, `amix`, `sidechaincompress`, `loudnorm`, `ebur128`. |

**Costo de la base: cero.** No hay licencias de terceros, ni atribución, ni regalías. El único costo es el cómputo del render.

## 2. La librería propia (VoiceLab)

- **Sintetizador** (`VoiceLab sound/synth.mjs`): osciladores, ruido con semilla fija, filtros bicuadráticos, envolventes y un
  escritor de WAV PCM 16 bits estéreo a 48 kHz. No lee reloj, ni azar del sistema, ni red.
- **Recetas por función** (`VoiceLab sound/library.mjs`). Las claves dicen lo que el sonido hace, nunca a qué marca sirve:

| Clave | Función | Qué es |
|---|---|---|
| `sfx_block_entry_whoosh` | `block_entry` | soplo que sube y se abre (0,45 s), para la entrada de gancho o título |
| `sfx_digit_tick` | `digit_land` | tic seco (50 ms), cuando una cifra del rodillo cae en su valor |
| `sfx_stamp_impact` | `impact` | golpe grave con chasquido (0,5 s), para un sello |
| `sfx_cut_swish` | `shot_cut` | roce breve y discreto (0,25 s), en un corte de toma |
| `sfx_cta_chime` | `cta` | dos notas de campana (1,6 s), para la llamada a la acción |
| `sfx_word_pop` | `word_pop` | pop corto (0,12 s), para el rol o una palabra que salta |
| `bed_soft_pulse` | `music_bed` | bucle de 9,6 s a 100 ppm: colchón La menor–Fa–Do–Sol y pulso grave |

- **Generación:** `node sound/build.mjs <carpeta>` escribe los WAV y un `manifest.json` con clave, función, sha256,
  duración, `license: 'propia'`, `attribution: null` y la versión de la receta.
  - Tarda 1,6 s y dos generaciones dan los mismos archivos (*medido*).
  - La librería se genera una vez y se guarda: el render usa el archivo, no la receta.

## 3. La colocación y la mezcla (VideoLab)

- **Hoja de entradas** (`render/src/sound.mjs`, `soundCues`, pura). Sale de la MISMA escena que dibuja el motor HTML:
  - el inicio de cada bloque, por capa, o por estilo de texto si el preset de sonido lo nombra;
  - el instante en que cada cifra del rodillo cae en su valor (`digitLandings`, con la misma fórmula que el `seek` del
    runtime);
  - los cortes de toma del timeline (`shotCuts`).

  Dos entradas del mismo sonido más juntas que su `min_gap_ms` se funden en una.
- **Mezcla** (`soundMixArgs`):
  - la voz va entera;
  - la cama se repite, baja cuando habla la voz (`sidechaincompress`) y se recorta a la duración;
  - cada efecto entra con `adelay` en su milisegundo;
  - `amix normalize=0`: el nivel no depende de cuántos sonidos haya.
- **Sonoridad final** (`loudnormArgs`): dos pasadas de `loudnorm`, la segunda lineal con lo medido. El objetivo se toma del
  dato, por plataforma.
- **Preset de sonido como dato** (`docs/sound_presets_f0.json`, `sound_soft_pulse`). Indica:
  - qué sonido va a cada función, con su ganancia y su desfase;
  - la cama, con su ganancia, el ducking y el `release`;
  - la sonoridad por plataforma.

  `true_peak_db` es el tope **antes** de codificar: la codificación AAC suma unos 0,6 dB (*medido*).

## 4. Medida sobre el video de los sofás (*medido*)

Video de partida: el job real `c739b638`, con texto, rodillo y voz, render `d58bc32`. Se le mezcló la capa con
`render/bench/sonido_f0.mjs` y el preset `sound_soft_pulse`.

| | Sólo voz (actual) | Con la capa de sonido |
|---|---|---|
| Sonoridad integrada | −21,4 LUFS | **−14,1 LUFS** |
| Pico verdadero | −5,2 dBTP | **−1,8 dBTP** |
| Rango de sonoridad (LRA) | 4,8 LU | 4,3 LU |

- **Entradas:** 21 en total: 1 gancho, 3 títulos clave, 6 cifras del rodillo, 1 rol, 1 CTA y 9 cortes. El tercer título no
  tiene cifras y no lleva tics.
- **La cama y los efectos**, medidos solos (mezcla menos voz), suman −35,8 LUFS, unos 14 dB por debajo de la voz: el nivel
  habitual de una cama bajo una voz.
- **Tiempo añadido:** 6,3 a 6,6 s por pieza de 58 s. El render sigue muy por debajo del tope de 300 s.
- **Mismo pedido, mismo audio:** dos corridas dieron el mismo audio (sha256 del máster) y el mismo MP4. Falta medirlo en
  Cloud Run con Intel y AMD, igual que con el video (F1).
- **Dos ajustes de dato que encontró la medida:**
  - la cama empezó en −24 dB y quedaba 22 dB bajo la voz, inaudible; pasó a −12 dB;
  - el tope de pico pasó de −1,5 a −2,0 antes de codificar, porque el AAC lo subía a −0,9.

**Muestras (privadas, sin publicar, sin pieza asociada)**, en
`unrlvl-media/videolab/<marca>/sin-pieza/muestras-sonido/`:
- `actual_solo_voz.mp4` y `con_sonido_f0.mp4`: el mismo video, con y sin la capa;
- `cama_sola.wav` y `efectos/*.wav`: la librería, por separado.

## 5. Diseño como dato — propuesto para la F1 (no se crea nada sin el sí de Sam)

**Tabla `public.voicelab_sound_library`** (dueño: VoiceLab). Una fila por sonido generado:

| Columna | Tipo | Nota |
|---|---|---|
| `sound_key` | text | p. ej. `sfx_digit_tick` (por función, nunca por marca) |
| `fn` | text | `CHECK` sobre funciones del sistema: `block_entry`, `digit_land`, `impact`, `shot_cut`, `cta`, `word_pop`, `music_bed` |
| `recipe_version` | int | sube cuando cambia la receta |
| `storage_path` | text | WAV en `voicelab/sound-library/<sound_key>@v<n>.wav` |
| `sha256` | text | huella del archivo |
| `duration_ms` | int | |
| `license` | text | `CHECK (license IN ('propia', 'cc0'))`: ni CC-BY, ni NC, ni ND |
| `attribution` | text | NULL para `propia` y para `cc0` |
| `source` | text | la receta (`voicelab/sound/library.mjs@v1`) o la URL de origen de un CC0 |
| `brand_id` | text | NULL = de sistema; una marca puede tener sonidos propios (instancia, no eje) |
| `active` | boolean | |

**Tabla `public.videolab_sound_presets`** (dueño: VideoLab; mismo patrón que `videolab_text_presets`). Columnas:
`preset_key`, `name`, `spec` (jsonb como `docs/sound_presets_f0.json`), `status` (`proposed`, `validated_by_judgment`,
`validated_by_data`, `retired`), `brand_id` NULL = de sistema, `active` y `sort`.

**Pedido:**
- `text_layers.sound = { preset_key, platform? }`;
- sin `sound`, el video sale como hoy, sólo con voz.

**Llamada entre labs:** VideoLab pide a VoiceLab, por su `api_endpoint`, el manifiesto de los sonidos del preset
(`POST /api/execute`, `stage.mode: 'sound'`, propuesto). Lo descarga y verifica el sha256 de cada archivo antes de mezclar.

**Test de la marca N+1:**
1. **¿Sobrevive a otra marca de otro rubro y otro país?** Sí. Sonidos y presets son de sistema, y una marca puede sumar los
   suyos por `brand_id`.
2. **¿Función o caso?** Función: `fn` y las claves nombran lo que hace el sonido.
3. **¿Eje o instancia?** Ejes en el código (funciones, mezcla); instancias en el dato (archivos, ganancias, objetivos).
4. **¿Cuántas marcas hay en las enumeraciones?** Ninguna. El `CHECK` de `fn` enumera funciones del sistema, no marcas.

## 6. Qué falta para producción (F1, con el sí de Sam)

1. Generar la librería y subirla con su fila en `voicelab_sound_library` (migración y siembra).
2. Modo `sound` en VoiceLab `/api/execute`.
3. VideoLab: `text_layers.sound` en el contrato, la mezcla dentro del job (también en el re-render de texto) y la medida en
   Cloud Run con Intel y AMD.
4. Orchestrator: los controles de sonido (preset, silenciar efectos, volumen de la cama), que se acuerdan con la sesión B.
5. Más recetas y más camas, que se validan con muestras como los estilos de texto.
