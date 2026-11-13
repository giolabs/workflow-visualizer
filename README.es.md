# workflow-visualizer

[English](./README.md) · **Español**

Un plugin de [Claude Code](https://claude.com/claude-code) que convierte el trabajo agéntico en una
consola en vivo. Cada agente que lanza un `Workflow` o un `Agent` aparece como un servidor en un
rack, al lado del orquestador (tu sesión principal): LED de estado, qué está haciendo ahora en
lenguaje natural, pasos, llamadas a tools, tokens por tipo y costo estimado en USD, todo actualizado
mientras el modelo transmite. Al seleccionar un servidor ves su tarea, sus últimas acciones con
timestamps, el ADR, spec o ticket en el que trabaja y su reporte final.

El mismo plugin trae la skill `loop-mode` (un loop agéntico multi-ticket sobre tickets de
Jira/Linear con worktrees de git, specs y gates de verificación) y convierte todo el historial en
reportes de productividad: tokens y costo por modelo, workflow, ticket y objetivo del repo, más el
avance del sprint cuando Jira está conectado.

```
 🏟 WORKFLOW VISUALIZER rack · 4 servers        ⠹ 2 online · Σ agentes 438.4k tok ≈ $0.87 · ←→↑↓ enter ?
 ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
 ║ 🎛 ORQUESTADOR fable · turno 12                                                 ● WORK 00:41 ║
 ║ Función: lanza agentes y workflows, junta sus reportes y te responde          ⎇ feat/ADR-006 ║
 ║ ▸ Lanzando el workflow review-changes                                                        ║
 ║ 2 workflows · 9 agentes · 2 online · contexto 23% · sesión $2.14 · ▂▃▅▆▇▅▃▂ 12.3k tok ≈ $0.31 ║
 ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
 ╭ 🐇 review:register  haiku ─────╮ ╭ 🦊 review:client  sonnet ──────╮ ╭ 🐉 review:types  fable ────────╮
 │ ● WORK 00:12 · paso 3 · 4 tools│ │ ◉ THINK 00:09 · paso 2 · 1 tool│ │ ● DONE 00:38 · paso 5 · 6 tools│
 │ ▸ Leyendo hooks/register.tsx   │ │ ▸ Pensando…                    │ │ ▸ Entregó su reporte           │
 │   desde la línea 101           │ │                                │ │                                │
 │ ▁▂▃▅▆ 43.6k tok $0.012         │ │ ▁▁▂▃ 29.0k tok $0.079          │ │ ▂▃▅▆▇ 97.0k tok $0.27          │
 ╰────────────────────────────────╯ ╰────────────────────────────────╯ ╰────────────────────────────────╯
```

## Instalación

En una sesión de Claude Code:

```
/plugin install workflow-visualizer --marketplace giolabs/workflow-visualizer
```

Respondé `y` para agregar el marketplace y elegí un scope (user es el habitual). Después se piden
una sola vez las opciones del plugin:

| Opción | Valores | Qué hace |
| --- | --- | --- |
| Conversation language | `en`, `es` | Idioma del pane, los toasts, los reportes y los prompts de orquestación. El código y la documentación quedan en inglés. |
| Default decision mode | `hitl`, `autonomous` | `hitl` pausa los runs del loop antes de cualquier push, PR o merge y pregunta; `autonomous` avanza y reporta cada decisión. |
| Model choice for subagents | `auto`, `off` | `auto` elige el modelo de un subagente según su tarea cuando nadie lo fijó (ver [El razonamiento del orquestador](#el-razonamiento-del-orquestador)); `off` no lo toca nunca. |
| Jira project key | p. ej. `MH` | Opcional. Habilita las métricas de sprint del sprint abierto del proyecto. |
| Jira story points field | `customfield_10016` | Opcional. El campo custom que guarda los story points en tu Jira. |
| Atlassian MCP server | `claude.ai Atlassian` | Opcional. El nombre del servidor MCP tal como lo lista `/mcp`. |

Todas se cambian después en `/config` → workflow-visualizer. Jira es opcional: sin Jira, el plugin
mide objetivos a partir de los artefactos del repo (ver abajo).

Para correrlo desde un checkout: `claude --plugin-dir /ruta/a/workflow-visualizer`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/wv` | Abre el pane del rack con foco (funcionan flechas, `Enter` y `?`). |
| `/wv loop <tickets>` | Corre la orquestación `loop-mode` sobre esos tickets con el idioma y el modo del plugin. |
| `/wv <pedido en palabras>` | Lanza el workflow `wv-ask`: artefactos del repo + Jira + git investigados en paralelo y una respuesta sintetizada, todo visible en el rack (p. ej. `/wv tickets del ADR-050 en backlog`). |
| `/wv report [today\|7d\|30d\|all] [save]` | Reporte de productividad en markdown; `save` lo escribe en `.workflow-visualizer/reports/`. |
| `/wv objectives [rescan]` | ADR, specs, cambios de OpenSpec, fases de GSD y tickets locales del repo, con estado y costo de agentes. |
| `/wv jira` | Estado de la conexión con Jira y el sprint abierto del proyecto configurado. |
| `/wv help` | Subcomandos y configuración actual. |

## En el pane

- `←→↑↓` o `hjkl` eligen un servidor (el orquestador es el primero); también con click.
- `Enter` abre o cierra el detalle del seleccionado; `?` muestra la leyenda.
- LEDs: `WORK` usando un tool · `THINK` razonando · `WRITE` redactando · `BOOT` arrancando · `IDLE` esperando · `DONE` / `FAIL`.
- Header: agentes en vivo, tokens totales de agentes y el USD estimado de todos.
- Fila del orquestador: turno, función, acción actual, workflows y agentes lanzados, uso de
  contexto, costo real de sesión de `/cost`, sus propios tokens y estimado, y la branch actual.
- Detalle: tarea, desglose cache/in/out con un rango por tamaño (Hormiga → Castor → Lobo → Elefante → Ballena),
  acción actual, últimas acciones con timestamps, tickets y objetivos del repo relacionados, reporte final.

Los costos son estimados a precio de lista por modelo (input, output, cache read y cache write con
el TTL de 1 hora que usa Claude Code) y van marcados con `≈`; el de sesión lo da el propio engine.

## El razonamiento del orquestador

El plugin toma algunas decisiones por su cuenta sobre los agentes que observa (`hooks/brain.ts`):

- **Modelo por tarea.** Cuando un subagente se lanza sin modelo (sin `model` en la llamada a Agent
  ni en el script del Workflow), el plugin lee la tarea y elige el nivel que merece: investigación
  de solo lectura → haiku; implementación y tests → sonnet; review, arquitectura/ADR, UI y síntesis →
  opus. Los agentes `Explore` van a haiku y los `Plan` a opus; una tarea sin señal va a sonnet.
  Decide la primera palabra que matchea, salvo review y UI nombrados en la descripción, que ganan
  directo. Forks, teammates, runs resumidos y tipos de agente de otros plugins no se tocan. El log
  del tile muestra la elección y la palabra que la disparó; `modelPolicy: off` lo desactiva.
- **Apagado.** Un agente que terminó queda un minuto en el rack con su reporte y su costo y después
  se apaga; el header cuenta los apagados y `/wv report` los conserva a todos.

## Objetivos desde tu repo (sin Jira)

El plugin escanea el repositorio buscando los artefactos en markdown que los equipos mantienen, y
asocia cada agente a ellos por los ids que menciona, los archivos que toca y la branch en la que corre:

| Tipo | Dónde busca | Id y estado |
| --- | --- | --- |
| ADR | `docs/adr`, `docs/decisions`, `docs/architecture/decisions`, `adr`, `conclave/product/adr` | `ADR-006`, `**Status**: accepted` |
| Spec | `docs/specs/*.md`, `docs/specs/<slug>/spec.md`, `specs/`, `.planning/specs` | `spec:<slug>`, `> **Estado:** DRAFT` o frontmatter `status:` |
| OpenSpec | `openspec/changes/<slug>/proposal.md`, `openspec/specs/<cap>/spec.md` | `openspec:<slug>`, `capability:<cap>` |
| GSD | `.planning/phases/*` | `phase:<n>`; `SUMMARY.md` → cerrada, `PLAN.md` → en curso |
| Conclave | `conclave/sprints/*/stories`, `conclave/sprints/*/bugs`, `conclave/product/epics` | `US-023`, `BUG-003`, `EP-001`, frontmatter `status` |
| Board local | `scrum/tickets/*.md` | id del archivo, frontmatter `status` |

Los estados se normalizan a abierto / activo / cerrado / descartado a partir de las palabras
habituales en inglés y español. El escaneo corre al iniciar la sesión, cada pocos minutos cuando
hace falta y apenas un agente escribe bajo alguna de esas carpetas.

## Reportes

`/wv report` agrega todas las sesiones que el plugin vio (guardadas en su store) más la actual:

- Resumen: sesiones, runs de workflow, agentes, tasa de éxito, tokens, costo estimado, duración media, llamadas a tools.
- Por modelo, por workflow (con cantidad de runs), por ticket (con resumen y estado de Jira si hay), por objetivo del repo, por día.
- Objetivos del repo tocados, con agentes, tokens y costo; conteo de artefactos por tipo y estado.
- Objetivos del sprint cuando hay proyecto de Jira: issues y puntos cerrados vs. totales, costo de agentes por issue.
- Los cinco agentes más caros.

## Jira (opcional)

Jira se usa a través del conector MCP de Atlassian. Autenticá una vez con `/mcp` → "claude.ai
Atlassian" y poné la clave del proyecto en `/config`. Los agentes que nombran un ticket (`MH-1234`)
muestran su resumen, estado, puntos y sprint en el detalle; `/wv jira` y el reporte muestran el
sprint abierto. El soporte de Linear está en el roadmap.

## loop-mode

`skills/loop-mode/` trae la skill de orquestación: inteligencia de tickets contra los criterios de
aceptación y los links de dependencia de Jira, un worktree y una branch de git por ticket, una spec
de 20 secciones validada antes de escribir código, implementación por fases con verificación real de
build/lint/test, elección de modelo consciente de FE/UI, un run summary por ticket y un loop opcional
sobre comentarios de PR. `/wv loop <tickets>` la arranca con el idioma y el modo de decisión del
plugin ya fijados; cada decisión te llega como pregunta de opción múltiple con una recomendada.

## Desarrollo

```
claude plugin validate .      # manifest, hooks y marketplace tal como los lee el engine
claude plugin test .          # 34 tests: hooks, UI, parsers, reportes golden, casos borde
tests/e2e/objectives.sh       # chequeo headless contra repos reales (gasta tokens)
```

El chequeo de tipos es `tsc -p .` una vez que el engine dejó `.claude-plugin/types/` (lo hace en la
primera carga con `--plugin-dir`). La estructura está en el [README en inglés](./README.md#development).

Ver [CONTRIBUTING.es.md](./CONTRIBUTING.es.md). Licencia [MIT](./LICENSE).
