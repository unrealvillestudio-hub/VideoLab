// BANCO DE LA F0 DE SONIDO (2026-11-17): mezcla la capa de sonido sobre un video ya renderizado y la mide.
//
//   node render/bench/sonido_f0.mjs <scene.json> <timeline.json> <video_con_voz.mp4> <librería_dir> <presets_sonido.json> <dir_salida> [--platform default] [--runs 2]
//
// <scene.json> es la escena que escribe render/bench/motor_html_f0.mjs (la misma que dibuja el motor). <librería_dir> es
// la salida de VoiceLab `node sound/build.mjs` (WAV + manifest.json). Mide: tiempo de la capa, sonoridad integrada,
// pico verdadero y si dos corridas dan el mismo audio y el mismo MP4.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { soundCues, soundMixArgs, loudnormArgs } from '../src/sound.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const [scenePath, timelinePath, video, libDir, presetsPath, outDir] = a;
if (!outDir) { console.error('uso: sonido_f0.mjs <scene.json> <timeline.json> <video.mp4> <lib_dir> <presets.json> <dir_salida>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
const timeline = JSON.parse(readFileSync(timelinePath, 'utf8'));
const preset = JSON.parse(readFileSync(presetsPath, 'utf8')).rows[0].spec;
const lib = JSON.parse(readFileSync(join(libDir, 'manifest.json'), 'utf8'));
const files = Object.fromEntries(lib.sounds.map((s) => [s.key, join(libDir, s.file)]));
const target = preset.master_by_platform[opt('platform', 'default')] ?? preset.master_by_platform.default;
const durationS = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString().trim());
const cues = soundCues(scene, timeline, preset);
writeFileSync(join(outDir, 'cues.json'), JSON.stringify(cues, null, 1));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function once(k) {
  const t0 = performance.now();
  const mix = join(outDir, `mezcla${k}.wav`), norm = join(outDir, `master${k}.wav`), mp4 = join(outDir, `con_sonido${k}.mp4`);
  execFileSync('ffmpeg', soundMixArgs({ video, durationS, preset, cues, files, out: mix }));
  // Primera pasada de loudnorm: sólo mide (el informe sale por stderr).
  const txt = spawnSync('ffmpeg', loudnormArgs({ input: mix, target })).stderr.toString();
  const measured = JSON.parse(txt.slice(txt.lastIndexOf('{'), txt.lastIndexOf('}') + 1));
  execFileSync('ffmpeg', loudnormArgs({ input: mix, target, measured, out: norm }));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', norm, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', mp4]);
  const ms = Math.round(performance.now() - t0);
  return { ms, audio: sha(norm), mp4: sha(mp4), mp4Path: mp4 };
}
function loudness(p) {
  const s = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', p, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr.toString();
  const sum = s.slice(s.lastIndexOf('Summary:'));
  return { I: Number(sum.match(/I:\s+(-?[\d.]+) LUFS/)[1]), TP: Number(sum.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]), LRA: Number(sum.match(/LRA:\s+(-?[\d.]+) LU/)[1]) };
}
const runs = Number(opt('runs', 2));
const r = Array.from({ length: runs }, (_, k) => once(k + 1));
const res = {
  cues: cues.length, por_funcion: cues.reduce((m, c) => ({ ...m, [c.cue.split(':')[0]]: (m[c.cue.split(':')[0]] ?? 0) + 1 }), {}),
  tiempo_ms: r.map((x) => x.ms), audio_identico: r.every((x) => x.audio === r[0].audio), mp4_identico: r.every((x) => x.mp4 === r[0].mp4),
  audio_sha: r[0].audio.slice(0, 16), mp4_sha: r[0].mp4.slice(0, 16),
  original: loudness(video), con_sonido: loudness(r[0].mp4Path), objetivo: target,
};
writeFileSync(join(outDir, 'medidas.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
