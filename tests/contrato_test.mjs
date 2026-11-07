// EL CONTRATO DE VIDEOLAB DICE LO MISMO EN LOS DOS SITIOS, Y NO NOMBRA NINGUNA MARCA.
//
// POR QUÉ. El contrato vive en dos formas: `docs/CONTRACT.md` (para personas) y
// `contract/videolab.contract.json` (para máquinas). Si divergen, el carril cablea una y la otra miente.
// Además, el contrato es capa compartida: un nombre de marca o de persona en sus enumeraciones viola la
// regla multimarca (test de la marca N+1).
//
// Ejecutar:  node tests/contrato_test.mjs
// Sin dependencias.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const md = readFileSync(join(RAIZ, "docs/CONTRACT.md"), "utf8");
const c = JSON.parse(readFileSync(join(RAIZ, "contract/videolab.contract.json"), "utf8"));

// Marcas y personas del ecosistema [medido 2026-11-01 en public.voicelab_params, person_blueprints y
// ecosystem.json]. Es dato de prueba: si alguna aparece en el contrato, la capa compartida tiene una instancia.
const INSTANCIAS = [
  "NeuroneSCF", "ForumPHs", "UnrealvilleStudio", "LucienSael", "D7Herbal", "DiamondDetails",
  "VivoseMask", "VizosCosmetics", "PatriciaOsorio", "SamPublisher",
  "Patricia", "Irja", "Ivette", "Lucien", "NSCF", "FPHS", "D7H",
];

// El guion bajo es carácter de palabra para `\b`: «ugc_Patricia» escaparía. Se normaliza antes de buscar.
const nombra = (texto) => INSTANCIAS.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(texto.replace(/_/g, " ")));

let fallos = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); }
  catch (e) { fallos++; console.error(`  MAL ${nombre}\n${e.message}`); }
}

console.log("contrato — docs/CONTRACT.md y contract/videolab.contract.json");

caso("cada estilo de video del JSON está en el documento", () => {
  assert.deepEqual(c.video_styles.filter((s) => !md.includes(`\`${s}\``)), []);
});

caso("cada productor del JSON está en el documento", () => {
  assert.deepEqual(c.producers.filter((p) => !md.includes(`\`${p}\``)), []);
});

caso("cada error_label del JSON está en el documento, y el documento no tiene otros", () => {
  assert.deepEqual(c.error_labels.filter((e) => !md.includes(`\`${e}\``)), []);
  const enMd = [...new Set(md.match(/VIDEOLAB_[A-Z_]+/g) ?? [])];
  assert.deepEqual(enMd.filter((e) => !c.error_labels.includes(e)), []);
});

caso("los ámbitos de consentimiento y los roles de texto coinciden", () => {
  assert.deepEqual(c.consent_scopes.filter((s) => !md.includes(`\`${s}\``)), []);
  assert.deepEqual(c.on_screen_text_roles.filter((r) => !md.includes(r)), []);
});

caso("los campos obligatorios de la salida están en el documento", () => {
  assert.deepEqual(c.output.required.filter((f) => !md.includes(f)), []);
});

caso("format es la superficie 'reel' y video_style es un eje aparte", () => {
  assert.equal(c.format, "reel");
  assert.ok(!c.video_styles.includes("reel"));
  assert.ok(c.request.params.required.includes("video_style"));
});

caso("los valores son snake_case en minúsculas (CHECK del carril)", () => {
  for (const v of [...c.video_styles, ...c.producers, ...c.consent_scopes, ...c.on_screen_text_roles]) {
    assert.match(v, /^[a-z][a-z0-9_]*$/, v);
  }
});

caso("marca N+1: ninguna marca ni persona en el contrato", () => {
  assert.deepEqual(nombra(JSON.stringify(c)), []);
  // En el documento sólo pueden aparecer dentro de la cita literal de Sam o como ejemplo explícito.
  const sinCitas = md.split("\n").filter((l) => !l.startsWith(">") && !/p\. ej\./.test(l)).join("\n");
  assert.deepEqual(nombra(sinCitas), []);
});

caso("el test N+1 caza una marca si alguien la escribe (regresión inyectada)", () => {
  const inyectado = JSON.stringify({ ...c, video_styles: [...c.video_styles, "ugc_Patricia"] });
  assert.deepEqual(nombra(inyectado), ["Patricia"]);
});

caso("Kling quedó archivado fuera de api/ (Vercel ya no lo sirve)", () => {
  assert.ok(!existsSync(join(RAIZ, "api/execute.ts")));
  assert.ok(existsSync(join(RAIZ, "legacy/kling/execute.ts")));
  assert.match(readFileSync(join(RAIZ, "legacy/kling/README.md"), "utf8"), /NO OPERATIVO/);
});

if (fallos) { console.error(`\n${fallos} caso(s) en rojo`); process.exit(1); }
console.log("\ncontrato: todo en verde");
