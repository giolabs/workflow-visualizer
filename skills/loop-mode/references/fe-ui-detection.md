# FE/UI ticket detection

## Detecting a flagged ticket

A ticket flags as FE/UI if its scope text contains any of, or a close variant of:
`[FE]`, "screen", "view", "component", "page", "design", "Figma", "mockup", "UI", "layout",
"pantalla", "vista", "componente", "diseño" — or its scope names a frontend app path directly
(`apps/web`, `domains/*/components`, etc). When in doubt, err toward asking rather than skipping —
the cost of one extra question is far lower than shipping a UI ticket with the wrong visual
reference or the wrong model.

## Question 1 — design reference

For each flagged ticket (or grouped, if several visibly share one design source — e.g. all three
Co-Pilot P3 tickets referencing the same "2026-08 handoff"), ask:

> "{ticket-key} parece tocar UI/diseño. ¿Querés adjuntar una referencia visual para esta tarea?"

Options:
- **Link de Figma** — pedí la URL; queda en `designRef: { type: 'figma', value: <url> }`.
- **Referencia de Claude/Figma Design** — si hay Figma MCP conectado, ofrecé usarlo para extraer
  contexto de diseño (`get_design_context`/`get_screenshot`) en vez de pedir un link a mano;
  `designRef: { type: 'claude-design', value: <what you extracted or the file/node reference> }`.
- **Imagen** — pedí el path/archivo; `designRef: { type: 'image', value: <path> }`.
- **Sin referencia visual** — válido, especialmente si el ticket ya trae un handoff de diseño
  citado en su propio texto (como los tickets Co-Pilot P3, que citan "2026-08 handoff" en su
  descripción); `designRef: { type: 'none' }`.

## Question 2 — model recommendation for this ticket's implementation

Ask, per flagged ticket (can be a single question covering all FE tickets at once if they'll all
use the same choice):

> "Para tareas de FE/UI, recomiendo usar el modelo Opus más reciente disponible (o Fable 5 si está
> disponible) en la etapa de implementación — mejora la fidelidad visual respecto al diseño.
> ¿Querés usar esa recomendación o preferís mantener el modelo general que ya elegiste?"

Options: "Usar Opus más reciente / Fable 5 para esta tarea (recomendado)", "Mantener el modelo
general de implementación (Sonnet)", "Especificar otro modelo".

Whatever they choose becomes `feModel` on that ticket's entry in `args.tickets[]` — the workflow
script uses it to override `implementModel` (and `specModel`, so the spec itself already accounts
for the design reference) for that specific ticket only, leaving every other ticket on the
Step 3 default.

## Hard requirement baked into FE ticket prompts

Every FE-flagged ticket's spec and implementation prompts (see `loop-mode-workflow.js`) carry this
instruction regardless of what the user answered above:

> Before writing anything, read this project's `CLAUDE.md` (and any nested one for the frontend
> app, e.g. `apps/web/CLAUDE.md`) and inspect `DESIGN.md` or whatever the project's actual
> design-system source is (tokens file, style guide, component library docs). Match its existing
> conventions exactly — colors, spacing, component patterns, naming. Do not invent a visual
> convention the project already defines elsewhere, and do not silently deviate from `DESIGN.md`
> even if the ticket's own description suggests something different — flag the disagreement
> instead.

If a `designRef` was supplied, it's passed into the same prompt so the implementing agent has the
concrete visual target, not just the written ticket description.
