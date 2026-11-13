# Quota Manager Mod

Rules for `mods/quota-manager/`. This is a Herdr GPUI Mod: JavaScript that describes GPUI nodes. It is not a React app, a Herdr TUI plugin, or a Node service.

Human-facing design lives in `docs/ARCHITECTURE.md` and `SECURITY.md`. These files say how to change the code without breaking those boundaries.

---

## Guidelines Index

| Guide | Use it when |
| --- | --- |
| [Directory Structure](./directory-structure.md) | Deciding which file owns a change |
| [Runtime Boundary](./runtime-boundary.md) | Touching the View, host APIs, timers, or commands |
| [Data Contracts](./data-contracts.md) | Touching providers, preferences, collector JSON, cache, or scheduling |
| [UI](./ui.md) | Touching nodes, copy, keyboard, or screen layout |

---

## Pre-Development Checklist

- [ ] Read the guide for the file you will edit, plus `docs/ARCHITECTURE.md` if the change crosses modules
- [ ] Search for the constant or key you are about to add (`CONFIG_KEY`, `stateKey`, `IDS`, `KINDS`, `INTERVALS`, an `i18n.js` key)
- [ ] Keep collector commands in `command.js`, JSON normalization in `model.js`, and shared-state writes in `store.js`
- [ ] A new provider id starts in `providers.js` and needs a fixture in `tests/model.test.mjs` before any new UI
- [ ] Mod files do not import `node:`, DOM, React, or npm packages

---

## Quality Check

- Run `just ci`, or the same steps: `npm run check`, `npm run test:coverage`, `node scripts/install.mjs --dry-run`
- Config, command, model, and store changes need a `node:test` assertion in `tests/`
- UI behavior changes need a structural test in `tests/ui.test.mjs`. Those tests stub GPUI. They do not certify native pixels
- Run `npm run check:herdr` when `herdr-app` is on `PATH`. A missing binary is an incomplete check, not a pass
- Live acceptance stays in `docs/VALIDATION.md`
