# VideoLab · render propio — Cloud Run Job (una ejecución = un job de lab_jobs, variable JOB_ID).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# Motor HTML de las capas de texto (contrato v1.4.0, §4 ter.5): chrome-headless-shell, el MISMO build con el que se
# midió el motor (Playwright 1.63.0 → chromium_headless_shell-1243, Chrome 153.0.8010.12). Se fija la versión: otro
# build puede rasterizar distinto y el mismo pedido dejaría de dar el mismo video. --with-deps instala sus bibliotecas
# del sistema. render/src/html/cdp.mjs lo busca en PLAYWRIGHT_BROWSERS_PATH. Playwright no queda en la imagen: sólo se
# usa para bajar el binario; el capturador habla CDP crudo. Sin el binario, el job dibuja con ASS (TEXT_ENGINE_FALLBACK).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.63.0 install --with-deps --only-shell chromium \
 && rm -rf /ms-playwright/ffmpeg-* /root/.npm /root/.cache /var/lib/apt/lists/* \
 && ls /ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
WORKDIR /app
# Texto detrás de las personas (contrato v1.11.0): el segmentador de MediaPipe y su modelo de personas (Apache-2.0),
# fijados por sha256 en scripts/seg-assets.sh. Sin ellos, los bloques que irían detrás salen delante (TEXT_DEPTH_FALLBACK).
COPY scripts ./scripts
RUN sh scripts/seg-assets.sh /opt/vl-seg
ENV SEG_ASSETS=/opt/vl-seg
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/main.mjs"]
