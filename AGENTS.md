# AGENTS.md

Guidance for autonomous coding agents operating in this repository.

## Repository Facts

- Project type: Zotero plugin template (TypeScript + scaffold tooling).
- Package manager: npm (`package-lock.json` present).
- Runtime/build tool: `zotero-plugin` CLI from `zotero-plugin-scaffold`.
- Main roots: `src/` (code), `addon/` (static assets), `test/`.
- Type roots: `typings/` plus `zotero-types` sandbox definitions.
- CI pipeline: `.github/workflows/ci.yml`.

## Cursor / Copilot Rules

- `.cursor/rules/`: not found.
- `.cursorrules`: not found.
- `.github/copilot-instructions.md`: not found.
- Conclusion: no repository-specific Cursor/Copilot rule files exist.

## Setup

- First install dependencies: `npm install`.
- Scaffold commands require a configured Zotero dev/test environment.
- Keep local `.env` private; never commit secrets.

## Build / Lint / Test Commands

Canonical npm scripts from `package.json`:

- Dev hot reload: `npm start`.
- Production build + typecheck: `npm run build`.
- Lint check: `npm run lint:check`.
- Lint auto-fix: `npm run lint:fix`.
- Tests (watch mode by default): `npm run test`.

Direct CLI equivalents:

- Build: `zotero-plugin build && tsc --noEmit`.
- Test: `zotero-plugin test`.

Useful test flags supported by the test CLI:

- `--no-watch` (same effect as `--exit-on-finish`).
- `--abort-on-fail`.

Recommended local verification before handoff:

- `npm run lint:check`
- `npm run build`
- `npm run test -- --no-watch`

## Running a Single Test (Important)

The scaffold test CLI does **not** support file args or Mocha `--grep` passthrough.
Observed failures:

- `zotero-plugin test test/startup.test.ts` -> rejected.
- `zotero-plugin test --grep startup` -> rejected.

Practical single-test workflow for this repo:

1. Add temporary `.only` to the target (`describe.only` or `it.only`).
2. Run `npm run test -- --no-watch --abort-on-fail`.
3. Remove all `.only` before commit.

Guardrail before finalizing:

- Search `describe\.only|it\.only` under `test/**/*.ts`.

## Formatting Rules

Formatting is enforced by Prettier + ESLint.
Prettier settings from `package.json`:

- `printWidth: 80`
- `tabWidth: 2`
- `endOfLine: lf`
- XHTML override: `htmlWhitespaceSensitivity: "css"`

Observed conventions:

- Use semicolons.
- Use double-quoted strings.
- Keep trailing commas in multiline arrays/objects/params.
- Split long statements near width limit; avoid dense one-liners.

## Import / Module Conventions

- Use ESM imports/exports everywhere (`"type": "module"`).
- Prefer top-level imports; avoid dynamic imports unless required.
- Keep import order logical: external packages -> local modules -> typed/generated imports.
- Use explicit relative paths (`./`, `../`).
- Preserve existing default-export patterns where already used (e.g., `Addon`).

## TypeScript Conventions

- Prefer explicit types on public/cross-module APIs.
- Prefer `unknown` + narrowing over introducing new `any`.
- Keep overload style where API ergonomics need it (see locale utilities).
- Reuse project types: `_ZoteroTypes.*`, `PluginPrefsMap`, generated `FluentMessageId`.
- Allow `@ts-expect-error` only with an inline reason comment.
- Do not hand-edit generated typings:
  - `typings/i10n.d.ts`
  - `typings/prefs.d.ts`

## Naming Conventions

- Classes: `PascalCase`.
- Functions/methods/variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for module-level immutable values.
- Lifecycle handlers: `on...` prefix (`onStartup`, `onShutdown`, etc.).
- Static utility groups: `...Factory` suffix when pattern fits.

## Error Handling and Logging

- Fail fast on invalid state.
- For integration boundaries, use `try/catch` + `ztoolkit.log`.
- Rethrow non-recoverable errors after logging.
- Avoid silent catches.
- Use optional chaining and null checks for window/UI objects.
- On shutdown/unload, always unregister and close opened resources.

## Zotero Architecture Rules

- Entry: `src/index.ts` creates global addon instance.
- Lifecycle dispatch: `src/hooks.ts`.
- Keep hooks as dispatchers; put business logic in modules/utils.
- Register observers/UI on startup/load; unregister on shutdown/unload.
- Preserve `addon.data.initialized = true` behavior for test readiness.
- Keep global bridge pattern via `_globalThis`; avoid extra global leakage.

## Testing Conventions

- Framework: Mocha + Chai.
- Test files: `test/**/*.test.ts`.
- Prefer behavior-style test names (`should ...`).
- Await async behavior explicitly.
- Do not commit `.only` or temporary debug instrumentation.
- Prefer deterministic assertions over timing-sensitive checks.

## File/Change Scope Guidance

- Code logic: `src/**`.
- Static addon assets/manifest/UI: `addon/**`.
- Build output: `.scaffold/build/**` (generated; do not hand-edit).
- Respect unrelated local modifications; do not revert others' work implicitly.
- Keep diffs focused; avoid opportunistic large refactors.

## CI Parity Checklist

Before final handoff, run:

1. `npm run lint:check`
2. `npm run build`
3. `npm run test -- --no-watch`

If you used `.only` for debugging, remove it and rerun full tests.
