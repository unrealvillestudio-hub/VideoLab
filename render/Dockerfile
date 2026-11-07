# VideoLab · render propio — Cloud Run Job (una ejecución = un job de lab_jobs, variable JOB_ID).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/main.mjs"]
