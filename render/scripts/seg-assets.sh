#!/bin/sh
# Archivos del recorte de la persona (texto detrás de los sujetos, 2026-11-17), fijados por sha256.
# Uso: sh render/scripts/seg-assets.sh <carpeta>   (la imagen del render lo corre con /opt/vl-seg)
#   - @mediapipe/tasks-vision 1.2.3 (Apache-2.0): el segmentador en WASM (vision_bundle.mjs y wasm/).
#   - selfie_multiclass_256x256, versión 1 (Apache-2.0): el modelo de personas por clases.
# Un archivo que no coincide con su huella detiene el build: el recorte sólo corre con lo que se midió.
set -eu
DEST="${1:?falta la carpeta de destino}"
mkdir -p "$DEST/wasm"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/tv.tgz" https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz
echo "469602650dab70256df387983ea44e85fa66020335bae85a54fa8fda062ca0a0  $TMP/tv.tgz" | sha256sum -c -
tar -xzf "$TMP/tv.tgz" -C "$TMP" package/vision_bundle.mjs package/wasm/vision_wasm_internal.js package/wasm/vision_wasm_internal.wasm
cp "$TMP/package/vision_bundle.mjs" "$DEST/"
cp "$TMP/package/wasm/vision_wasm_internal.js" "$TMP/package/wasm/vision_wasm_internal.wasm" "$DEST/wasm/"
curl -fsSL -o "$DEST/selfie_multiclass_256x256.tflite" https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite
echo "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0  $DEST/selfie_multiclass_256x256.tflite" | sha256sum -c -
rm -rf "$TMP"
