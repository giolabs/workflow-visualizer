# Cómo contribuir

[English](./CONTRIBUTING.md) · **Español**

Gracias por sumarte. Esto es un plugin de Claude Code de function hooks: un módulo TypeScript que
carga el engine, con una UI de terminal dibujada por un módulo de superficie `Client`. Sin Node ni
DOM: todo lo que está afuera del módulo pasa por `$`.

## Puesta en marcha

1. Cloná el repositorio y abrí una sesión con el plugin cargado desde disco:
   ```
   claude --plugin-dir /ruta/a/workflow-visualizer
   ```
   En esa primera carga el engine deja los tipos de la API en `.claude-plugin/types/` (ignorado por git).
2. En esa sesión, `/wv` abre el pane. Los cambios al plugin recargan en caliente al terminar el turno.
3. Antes de abrir un pull request:
   ```
   claude plugin validate .
   claude plugin test .
   tsc -p .
   ```
   Los tres tienen que pasar. `tests/e2e/objectives.sh` es opcional y gasta tokens.

## Reglas de la casa

- **Código, nombres de archivo, commits y documentación en inglés.** Las strings que ve el usuario
  viven en `hooks/i18n.ts`, con una entrada `en` y una `es` cada una; la UI nunca hardcodea una frase.
  Los dos README cambian juntos.
- **Las decisiones llegan al usuario como preguntas con opciones.** Todo lo que pregunta el plugin o
  la skill incluida va por diálogos tipo `AskUserQuestion` con una opción recomendada, nunca una
  pregunta en prosa.
- **Todo hook que gatea un tool o un spawn lleva `.catch(($, e, next) => next(e))`**, así un bug del
  plugin nunca bloquea la sesión. `claude plugin validate` lista los hooks que gatean.
- **Los cambios de estado suben el shape.** `$.state` sobrevive a la recarga; cuando cambia
  `RackState`, subí el tag `shape` del átomo `rack` para que los valores viejos se descarten en vez
  de leerse mal.
- **Los precios son datos.** Actualizá `hooks/pricing.ts` desde la lista oficial; los estimados
  siguen marcados con `≈`.
- **Los tests son la spec.** Todo parseo nuevo (palabras de estado, layouts de artefactos,
  descripciones de tools) viene con una fila en `tests/parsers.test.ts`. Un cambio en el reporte
  regenera `tests/golden.ts` con `tests/e2e/gen-golden.mjs` y lo dice en el PR.

## Agregar una convención de artefactos

`hooks/objectives.ts` tiene `SOURCES` (dónde vive cada tipo), las listas de palabras de estado e
`idFor`. Agregá el patrón, un header de muestra de un repo real a `tests/parsers.test.ts`, y una fila
en la tabla "Objetivos desde tu repo" de los dos README.

## Reportar un bug

Usá la plantilla de issue. Incluí la versión de Claude Code (`claude --version`), la del plugin en
`plugin.json`, tu terminal y su ancho, y la línea gris `workflow-visualizer: …` que imprime el
transcript cuando falla un hook.

## Commits y releases

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`). Los commits llevan como autor a la
persona que impulsa el cambio, con líneas `Co-Authored-By:` para quien (o el modelo que) lo
coescribió.

Los releases se disparan por tag:

1. Agregá una sección `## [<versión>] - <fecha>` a `CHANGELOG.md` (movés lo que había en `[Unreleased]`).
2. En un `main` limpio y sincronizado, corré `scripts/release.sh <versión>`: sube la versión en
   `.claude-plugin/plugin.json`, commitea `release: v<versión>`, crea el tag `v<versión>` y pushea.
3. El workflow `release` de GitHub valida y testea el plugin, toma la sección del CHANGELOG como
   notas y publica el release. Una versión con sufijo (`0.5.0-beta.1`, `0.5.0-rc.1`) se publica como
   **pre-release**; las betas son la forma de probar una versión antes de declararla estable.

Una versión concreta se instala con
`/plugin install workflow-visualizer@<versión> --marketplace giolabs/workflow-visualizer`.
