# VideoLab — Unreal>ille Studio

Generador de storyboards y guiones visuales del ecosistema Unreal>ille Studio.

**Deploy:** Google AI Studio
**Contexto completo del ecosistema:** [`CoreProject/CONTEXT.md`](https://github.com/unrealvillestudio-hub/CoreProject/blob/main/CONTEXT.md)

---

## Rol en el ecosistema

VideoLab produce la capa narrativa visual: storyboards escena-a-escena, guiones con timing, y descripciones de shot para producción de video o Reels. Consume BPs para mantener consistencia de marca y persona.

```
BluePrints (BP_PERSON + BP_LOCATION) ──→ VideoLab (storyboard + guión)
                                              ↓
                                     Producción / CapCut / Reels
```

---

## Stack

- React 18 + TypeScript + Vite + Tailwind
- AI: Gemini 2.0 Flash (Gemini API)
- Deploy: Google AI Studio

---

## Dependencias

| Consume | Provee |
|---------|--------|
| BP_PERSON | Storyboards con persona consistente |
| BP_LOCATION | Locaciones referenciadas |
| BP_PRODUCT | Videos de producto |

---

## Changelog

| Fecha | Cambio |
|---|---|
| 2026-03-20 | README actualizado con arquitectura de ecosistema |

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local  # añade GEMINI_API_KEY
npm run dev
```
