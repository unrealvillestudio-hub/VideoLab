# CLAUDE.md — Instrucciones para Claude Code · Unrealville Studio

Antes de tocar NADA en este repositorio, Claude Code DEBE cargar y obedecer el protocolo central:

**Protocolo de CC (fuente de verdad):**
`https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md`

Cárgalo con `Vercel:web_fetch_vercel_url` o `curl` y síguelo en su totalidad.

## Las 3 reglas que nunca se rompen (resumen — el detalle está en CC_PROTOCOL.md):

1. **CONTEXT FILES NUNCA SE REEMPLAZAN.** Se actualizan preservando historia: lo nuevo al tope, lo anterior archivado debajo, nunca borrado. Aplica a todo `.json`/`.md` de contexto (ecosystem, brand.json, session_log, etc.). Antes de commitear: verificar que el diff no BORRA historia.

2. **PUSH:** `unrlvl-context` → nunca push directo, nunca por CC (solo Sam vía GitHub Desktop). Repos de código → branch + PR, nunca merge propio. CC nunca mergea por su cuenta.

3. **VERIFICAR ANTES DE ACTUAR:** mensaje corto a Sam con objetivo, pasos, archivos y repos afectados antes de cualquier escritura/commit/deploy. Reportar al final con el formato de CC_PROTOCOL (incluida la sección PRESERVACIÓN DE CONTEXTO).

Ante cualquier duda → preguntar a Sam, no asumir.
