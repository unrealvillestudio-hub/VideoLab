# PLAN — UI única de VideoLab y VoiceLab (sólo plan, sin construir)

**Fecha:** 2026-11-07 · **Estado:** plan. **No se construye ahora** (Sam, 2026-11-01).

## Decisión de Sam (literal, 2026-11-01)

> «VideoLab y VoiceLab tienen cada una su ui solo maqueta, desfasadas y no están conectadas a nada… no
> serán necesarias por ahora… si decides tener una UI debería ser una sola para los dos labs, tal vez como
> módulo integrado… ImageLab… si prefieres unir las 3, déjalo como un plan a futuro».

## Qué existe hoy

- `VideoLab/src/`: maqueta de storyboard que llamaba al envoltorio de Kling, ya archivado en
  `legacy/kling/`. Desde F1 su botón de envío no tiene endpoint: es esperado.
- VoiceLab: su propia maqueta, sin conexión.

## Etapa 1 — UI única VideoLab + VoiceLab (cuando Sam la pida)

1. **Un solo módulo** dentro de una de las dos apps, no dos UIs.
2. **Consume el mismo contrato que el carril** (`docs/CONTRACT.md`): crea el job, sondea `lab_jobs` y
   muestra el MP4. La UI no tiene motor propio ni arma prompts en el navegador (lección de AGENDA #99/#100).
3. **Marcas, personas, estilos y presets se leen de la base** (lectura anónima), nunca de listas en el código.
4. **Pantallas:** pedir un video (marca, estilo, imagen, guion), ver el progreso, ver y descargar el
   resultado, y escuchar o regenerar la voz.

## Etapa 2 — a futuro: una sola UI para ImageLab, VoiceLab y VideoLab

- La misma idea extendida a ImageLab: un panel de producción con un módulo por lab, sobre los contratos
  de cada uno.
- Requiere antes que ImageLab termine su reconversión al modelo asíncrono (AGENDA #100).

## Qué no se hace

- No se reparan las maquetas actuales.
- No se duplica en la UI ninguna regla de marca ni ningún motor.
