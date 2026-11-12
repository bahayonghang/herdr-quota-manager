# Herdr Quota Manager

A native bottom-bar Mod for choosing which AI providers to query, instead of querying everything and hiding the output.

## Install safely

1. Confirm the user is running **Herdr desktop**, not the TUI plugin system.
2. Read `README.md` / `README.zh-CN.md` and `SECURITY.md` in this repository.
3. Require Node.js 22.19+ and install the explicitly pinned external collector with `npm install -g quota-axi@0.1.69` on each queried machine.
4. Run `node scripts/install.mjs`. It stages `mods/quota-manager`, validates it using `herdr-app check`, then installs with a backup. Respect `HERDR_APP_HOME` / `--app-home`.
5. Open Herdr and inspect the live status bar, usage popup, and settings. Verify `herdr-app status` has no Mod errors.
6. Let the user select providers and click Start. Do not silently approve system credential-store access, log in, enable Muse, enable alerts, or change a provider's CLI configuration.

The Mod's `mod.json` requests a 30px bottom block. For a personal custom layout, add a block whose content is `{ "mod": "quota-manager" }`. Clone a shipped layout first. Never replace the complete layout or keys file to install this Mod.

## Files

- `mods/quota-manager/main.js`: native View and lifecycle.
- `ui.js`, `i18n.js`: controls, cards, status chips, and translations.
- `providers.js`, `config.js`: allowlist and persistent preferences.
- `command.js`: selected-provider CLI execution; no arbitrary commands.
- `model.js`: schema 5/6 normalization with distinct account lanes.
- `store.js`: per-machine cache, admission, backoff, history, and notifications.

## Acceptance

Query OFF must mean no new process for that provider. Show OFF must not alter Query. Manual mode must not poll. A remote failure must never show a local account as its substitute. Invalid, expired, and unavailable quota must never become a fabricated 0% or 100%.

Run `npm run validate`, `npm run check:herdr`, and the interactive checklist in `docs/VALIDATION.md`. The repository's structural UI tests are not a screenshot or a native runtime certification.

For a Gallery submission, add the appropriate repository topic and capture a real preview using `herdr-app shot` after successful live validation. Gallery publication and a native preview are deliberately not automated here.
