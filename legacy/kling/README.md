# ⛔ NO OPERATIVO — envoltorio de Kling (archivado el 2026-11-07)

**Qué es:** `execute.ts` es el antiguo `api/execute.ts` de VideoLab: un envoltorio directo de Kling
text2video (JWT HS256, submit → poll, 270 s), **sin `brandId`, sin `previousOutputs` y sin ninguna tabla**
(AGENDA #96, 2026-07-24).

**Por qué se archiva y no se borra:** Sam retiró Kling el 2026-11-01 («Kling se retira… archívalo con su
historia, no lo borres a ciegas»). El motor de VideoLab es ahora el del contrato `docs/CONTRACT.md`
(render propio, Veo 3.1 Fast y HeyGen Avatar IV).

**Estado al archivar [medido 2026-11-01]:** `lab_configs` de VideoLab con `active=false`, cero asientos de
VideoLab en `ops_generation_ledger` y cero `lab_jobs` de VideoLab: nadie llamaba a este endpoint.

**No se obedece ni se despliega.** Al salir de `api/`, Vercel deja de servirlo. Se conserva sólo como registro.
