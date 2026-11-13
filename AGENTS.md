<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Herdr Quota Manager

Selectable provider quota monitoring for the native Herdr desktop app. Code under `mods/quota-manager/` describes GPUI nodes. It is not a React app, a Herdr TUI plugin, or a Node service.

Read `docs/ARCHITECTURE.md` and `SECURITY.md` before changing behavior. Coding rules live in `.trellis/spec/mod/index.md` and `.trellis/spec/tooling/index.md`.

## Commands

| Task | Command |
| --- | --- |
| CI: syntax, coverage, installer dry-run | `just ci` |
| Install into Herdr | `just install` |
| Install options | `just install --app-home <path>` or `--skip-native-check` |
| Reversible uninstall | `just uninstall` |
| Shorter local loop | `npm run validate` |
| Native initial render, when `herdr-app` is on `PATH` | `npm run check:herdr` |

`just ci` matches `.github/workflows/ci.yml`. Install and uninstall forward extra arguments to `scripts/install.mjs`. `install.ps1` and `install.sh` do the same. Do not copy the Mod into an app home by hand.

## Runtime boundary

Mod files may import `gpui-kit`, `gpui-base`, `herdr`, and relative `./` modules. `scripts/check.mjs` rejects `node:` imports, `require(`, `setTimeout`, and `setInterval` in `mods/quota-manager/`.

`main.js` owns the View, timers, `cx.spawn`, and host calls. `ui.js` returns nodes. `model.js` normalizes reports. `store.js` admits work and writes shared state. `command.js` is the only module that builds a collector command.

## Contracts

- Provider ids come from `providers.js`. Preferences never become shell text.
- `consent` gates collection. Query OFF removes a provider before any subprocess. Show OFF only hides rows.
- `fetchQuota` passes `--json --provider <id> --no-credential-refresh`. Manual refresh uses `--max-age 0`. Exit code 1 is parsed once and is not retried through another shell.
- Only quota-axi schema 5 and 6 are accepted. Unknown JSON throws `invalid_report`.
- Do not persist emails, tokens, raw errors, remedy commands, or stderr. Visible errors use keys in `i18n.js`.
- A `shareOf` window has no remaining percent. A passed reset does not refill a bar. Do not add percentages across windows or providers.
- Cache, lease, history, and alert keys are `quota-manager.v1.<kind>:[machine, provider]`. Do not edit `shared.json`.
- Remote `exec` always receives the captured `{ on: machine }`. There is no remote-to-local fallback.
- Muse query requires `museConsent`. Select detected must not enable Muse.
- The installer stages, runs `herdr-app check`, then swaps the directory. A failed check leaves the existing install in place. Uninstall only moves a directory whose `.quota-manager-install.json` names this project. Preferences and history stay.

## Where to edit

| Change | File |
| --- | --- |
| Lifecycle, keyboard, overlay, polling | `mods/quota-manager/main.js` |
| Chips, cards, meters | `mods/quota-manager/ui.js` |
| Copy, both languages | `mods/quota-manager/i18n.js` |
| Allowlist | `mods/quota-manager/providers.js` |
| Preferences | `mods/quota-manager/config.js` |
| Process invocation | `mods/quota-manager/command.js` |
| Schema and display math | `mods/quota-manager/model.js` |
| Leases, cache, history, alerts | `mods/quota-manager/store.js` |
| Install and uninstall | `scripts/install.mjs` |

A new provider id starts in `providers.js` and needs a fixture in `tests/model.test.mjs`. Do not add a free-form shell setting. Do not add another collector adapter unless a second real collector exists.

## Tests

Tests are `node:test` files in `tests/`. `tests/helpers.mjs` builds the in-memory store. UI tests copy the Mod and rewrite `herdr` / `gpui-*` imports to `tests/mock-host.mjs` and `tests/mock-kit.mjs`. They check structure and shared state. They do not certify native pixels. Live acceptance is `docs/VALIDATION.md`.

## Out of scope

Do not add account login, credential refresh, inference opt-in, cookie import, arbitrary profiles, drag-and-drop ordering, billing charts, or automatic layout and keybinding edits.
