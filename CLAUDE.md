# CLAUDE.md — Instrucciones para Claude Code · Unrealville Studio

Antes de tocar NADA en este repositorio, Claude Code DEBE cargar y obedecer el protocolo central:

**Protocolo de CC (fuente de verdad):**
`https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md`

> **Orden de carga — la fuente canónica es el repo, Vercel es respaldo** (`CC_PROTOCOL.md` §0 bis).
> **(1)** `unrealvillestudio-hub/unrlvl-context` — working tree si está clonado, o `api.github.com` /
> `raw.githubusercontent.com`; **(2)** la URL de Vercel, **sólo si el repo no está disponible**, y
> declarándolo. El estático puede ir por detrás de `main` entre el merge y el deploy (`HRD-R09`, `HRD-R14`).
>
> **Cómo se alcanza esa URL de respaldo [medido 2026-08-29, `CC_PROTOCOL.md` §0 bis.1]:** con la tool
> **`Vercel:web_fetch_vercel_url`**, que devuelve **200**. **Nunca con `curl`**, que devuelve **403 en
> CONNECT** contra `*.vercel.app` — el proxy de egreso de CC lo bloquea. Son dos vías distintas y sólo
> una funciona; declarar Vercel inalcanzable tras probar sólo `curl` es afirmar sin medir.
>
> **Carga obligatoria además de `CC_PROTOCOL.md`:** `protocols/MULTIBRAND_RULE.md` y
> `protocols/DELIVERY_AND_VERIFICATION_RULE.md`. Esta última **se carga en la apertura de sesión**, no
> cuando surja la duda: gobierna **cómo se responde**, y una regla de forma que se consulta al final
> llega tarde porque el texto ya está escrito.

Cárgalo con `Vercel:web_fetch_vercel_url` o `curl` y síguelo en su totalidad.

## Las 3 reglas que nunca se rompen (resumen — el detalle está en CC_PROTOCOL.md):

1. **CONTEXT FILES NUNCA SE REEMPLAZAN.** Se actualizan preservando historia: lo nuevo al tope, lo anterior archivado debajo, nunca borrado. Aplica a todo `.json`/`.md` de contexto (ecosystem, brand.json, session_log, etc.). Antes de commitear: verificar que el diff no BORRA historia.

2. **PUSH (redacción vigente — corregida 2026-08-29):**
   - **Este repo y demás repos de código** → **branch + PR**, nunca push directo a `main`, nunca merge propio. CC limpia sus worktrees al cerrar un PR (`CC_PROTOCOL.md` §7.2).
   - **`unrlvl-context`** → CC trabaja **igual: branch + PR**. CC **crea la rama, commitea y PUSHEA esa rama de PR**, y abre el PR contra `main`. Su restricción es **no pushear a `main` y no mergear** — nada más. Sam revisa, mergea y borra la rama **por GitHub Web UI**. CC **nunca crea worktrees** en ese repo (`CC_PROTOCOL.md` §7.1).
   - **CC nunca mergea un PR por su cuenta**, en ningún repo. El merge es decisión de Sam.

   > **⛔ NO OPERATIVO — redacción anterior, derogada.** Se conserva sólo por trazabilidad
   > (`CC_PROTOCOL.md` §0 y §6) y **no se obedece**:
   > *«`unrlvl-context` → nunca push directo, nunca por CC (solo Sam vía GitHub Desktop). Repos de código → branch + PR, nunca merge propio. CC nunca mergea por su cuenta.»*
   >
   > Estaba **vencida desde el 2026-07-31**, cuando `CC_PROTOCOL.md` v2026-07-31 corrigió el punto de
   > push de CC según la instrucción de Sam del 29-jul, y arrastraba además que **Sam mergea por GitHub
   > Web UI** desde el 2026-07-29, **no por GitHub Desktop**. Este `CLAUDE.md` nunca se sincronizó, y
   > leer «nunca por CC» como imperativo vigente **traba a CC** — ya ocurrió en sesión. Fuente de verdad:
   > `CC_PROTOCOL.md` §1 + «Flujo de entrega de context files». Los `CLAUDE.md` de cada repo **sólo
   > apuntan** al protocolo; cuando duplican una regla, divergen — que es exactamente lo que pasó acá.

3. **VERIFICAR ANTES DE ACTUAR:** mensaje corto a Sam con objetivo, pasos, archivos y repos afectados antes de cualquier escritura/commit/deploy. Reportar al final con el formato de CC_PROTOCOL (incluida la sección PRESERVACIÓN DE CONTEXTO).

Ante cualquier duda → preguntar a Sam, no asumir.

---

## ENTREGA Y VERIFICACIÓN — INVIOLABLE

**Destinatario declarado.** Todo lo que se entrega cae dentro de un bloque con
encabezado propio: `PARA SAM — [de qué va]` o `PARA CC — [asunto]`. El bloque termina
donde empieza el siguiente encabezado. Un párrafo fuera de un bloque no es una
instrucción: es contexto.

**El diferenciador visual es para que SAM lea, no para que CC ejecute.** La marca
depende de la superficie: en **chat**, cuadrado emoji (verde Sam / naranja CC) más
encabezado grande, porque el markdown no rinde color arbitrario; en **documento, HTML
o UI con estilos**, el carácter `●` con la línea completa en su hex (`#00FFD1` Sam /
`#FFB300` CC). El hex no se escribe dentro de la línea: es especificación.

**Briefs largos se entregan como archivo**, no pegados: un bloque se trunca al copiarlo
y el truncamiento no falla — CC ejecuta lo que le llegó.

**Idioma.** ES neutro internacional o EN neutro internacional, sin excepción, sin
regionalismos y **sin voseo** (el imperativo voseante y el pretérito son homógrafos:
"decidí" es a la vez una orden y un hecho consumado). Aplica a chat, briefs, PRs,
commits, comentarios de código, context files y plantillas de protocolo.

**Evidencia.** Toda afirmación de estado va etiquetada `medido` / `reportado` /
`deducido`. Sin etiqueta se lee como `medido`. Antes de asumir, se consulta.

**Las cuatro QA son HRD RULES, en este orden:**
`QA-ENCARGO` (confirmar que entendí el encargo) → `QA-OBJETIVO` (confirmar el objetivo
con Sam) → `QA-INFO` (**bloqueo**: sin información completa NO se responde; si no hay
forma de obtenerla, se entrega el plan para conseguirla vía Sam o CC) → `QA-PROP`
(comprobar que lo entregado apunta al objetivo validado; cinco preguntas respondidas
por escrito). Un brief sin `QA-PROP` respondida se devuelve.

Fuente única: `unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md`.
**No copiar la regla completa aquí: este bloque es un puntero, no una segunda fuente.**
