// VIDEOLAB · GET /engine/<versión>/<módulo> — el runtime del motor HTML como módulo ES versionado (contrato v1.4.0).
//
// Sirve TAL CUAL los tres archivos de render/src/html que dibujan una escena en el navegador (ease.mjs, keyframes.mjs y
// runtime.mjs): el mismo código que corre el capturador del job. No hay copia ni paso de build. La ruta lleva la versión
// (`RUNTIME_VERSION`), así el módulo se puede cachear para siempre; una versión que no es la de este despliegue → 404,
// y el Orchestrator usa siempre el `runtime_url` que le devuelve /api/text-scene del mismo despliegue.
// vercel.json reescribe /engine/:version/:file a esta función e incluye los archivos.

import { readFileSync } from 'node:fs';
import { RUNTIME_VERSION } from '../render/src/html/runtime.mjs';

// Lista cerrada: nada fuera de estos tres archivos se sirve por aquí.
const FILES = Object.freeze({
  'ease.mjs': () => readFileSync(new URL('../render/src/html/ease.mjs', import.meta.url), 'utf8'),
  'keyframes.mjs': () => readFileSync(new URL('../render/src/html/keyframes.mjs', import.meta.url), 'utf8'),
  'runtime.mjs': () => readFileSync(new URL('../render/src/html/runtime.mjs', import.meta.url), 'utf8'),
});

/** El cuerpo y el estado de una petición `version`/`file`. PURO salvo la lectura del archivo. */
export function engineFile(version, file) {
  if (version !== RUNTIME_VERSION) return { status: 404, body: `// versión ${String(version).slice(0, 20)} no disponible; vigente: ${RUNTIME_VERSION}\n` };
  const read = Object.prototype.hasOwnProperty.call(FILES, file) ? FILES[file] : null;
  if (!read) return { status: 404, body: '// módulo no disponible\n' };
  return { status: 200, body: read() };
}

export default function handler(req, res) {
  const { version, file } = req.query ?? {};
  const r = engineFile(String(version ?? ''), String(file ?? ''));
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', r.status === 200 ? 'public, max-age=31536000, immutable' : 'no-store');
  return res.status(r.status).send(r.body);
}
