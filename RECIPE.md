# Herdr Quota Manager

A native status-row Mod for choosing which AI providers to query. The chips sit in the existing status bar, immediately left of the command hint.

## Install safely

1. Confirm the user is running **Herdr desktop**, not the TUI plugin system.
2. Read `README.md` / `README.zh-CN.md` and `SECURITY.md` in this repository.
3. Require Node.js 22.19+ and pnpm to build the vendor bundle. Local quota-query modules under `mods/quota-manager/vendor/quota-axi/` are compiled and adapted by `scripts/build-vendor.mjs` from the vendored quota-axi 0.1.69 snapshot at `third_party/quota-axi` (commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, MIT License, Copyright (c) 2026 Kun Chen) and run directly in-process inside the Mod without `node` or any standalone collector CLI.
4. Run `node scripts/install.mjs`. It rebuilds that vendor bundle inside `mods/quota-manager/vendor/quota-axi/`, stages `mods/quota-manager`, validates it using `herdr-app check`, installs with a backup, and retires any `.quota-manager-collector.json`-marked legacy directories under `<app-home>/collectors/` afterward. A failed check leaves the previous mod and any existing directories untouched. Respect `HERDR_APP_HOME` / `--app-home`. A remote machine still needs its own `quota-axi` program on PATH.
5. Open Herdr and inspect the live status bar, usage popup, and settings. Verify `herdr-app status` has no Mod errors.
6. Let the user select providers and click Start. Do not silently approve system credential-store access, log in, enable Muse, enable alerts, or change a provider's CLI configuration.

`mod.json` sets `place` to `none`. Herdr does not add a row. On a personal layout, point the 28px status block at `quota-manager` and delete any older quota block. A second block repeats the row and shortens the terminal. A hidden block still polls. Clone a shipped layout before that edit. The installer does not write layouts.

## Files

- `mods/quota-manager/main.js`: native View and lifecycle.
- `ui.js`, `i18n.js`: controls, cards, status chips, and translations.
- `providers.js`, `config.js`: allowlist and persistent preferences.
- `command.js`: in-Mod vendor calls (`vendor/quota-axi/index.js`) locally and fixed-flag `quota-axi` exec on remotes; no arbitrary commands.
- `vendor/quota-axi/`: generated core query modules adapted from `third_party/quota-axi` (Copyright (c) 2026 Kun Chen, MIT).
- `model.js`: schema 5/6 normalization with distinct account lanes.
- `store.js`: per-machine cache, admission, backoff, history, and notifications.

## Acceptance

Query OFF must mean no new process for that provider. Show OFF must not alter Query. Manual mode must not poll. A remote failure must never show a local account as its substitute. Invalid, expired, and unavailable quota must never become a fabricated 0% or 100%.

Run `npm run validate`, `npm run check:herdr`, and the interactive checklist in `docs/VALIDATION.md`. The repository's structural UI tests are not a screenshot or a native runtime certification.

For a Gallery submission, add the appropriate repository topic and capture a real preview using `herdr-app shot` after successful live validation. Gallery publication and a native preview are deliberately not automated here.
