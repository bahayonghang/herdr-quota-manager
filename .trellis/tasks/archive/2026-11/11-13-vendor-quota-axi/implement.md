# Vendor quota-axi into the Mod — implementation plan

Execute this plan **only after** the user explicitly approves the revised planning summary in chat. Do not start implementation from this file alone.

## Guardrails

- Stay on branch `bottom-right-quota-strip`. Do not switch branches, stash, amend `28a24b8`, commit early, or push.
- Do not archive `.trellis/tasks/11-12-bottom-right-quota-strip` or revert its uncommitted status-bar edits (`justify_end`, trailing `quota-slot`, status-row docs/tests).
- Keep `mods/quota-manager/gpui-kit.d.ts` and `mods/quota-manager/jsconfig.json` unstaged.
- Do not edit Herdr layout files, `keys.json`, `shared.json`, or `mod.json` slot placement.
- Keep `consent: false`. Do not click Start and do not run any live provider query against real credentials.
- Do not assign PowerShell `$HOME`.
- Do not commit `third_party/quota-axi/node_modules`, `third_party/quota-axi/dist`, or any nested `.git`.

## Implementation Order (Short Sequence)

1. **Verify snapshot & gitignore hygiene**:
   - Confirm `third_party/quota-axi/package.json` is `0.1.69` (commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`), `LICENSE` has `Copyright (c) 2026 Kun Chen`, `UPSTREAM.md` matches `prd.md`, `.git` is absent, and root `.gitignore` ignores `third_party/quota-axi/node_modules/`, `third_party/quota-axi/dist/`, and `third_party/quota-axi/.deploy/`.
2. **Build Herdr-compatible in-Mod vendor bundle (`scripts/build-vendor.mjs` -> `mods/quota-manager/vendor/quota-axi/`)**:
   - Create `scripts/build-vendor.mjs` (and `"build:vendor"` npm script) that compiles `third_party/quota-axi` (`tsc`) and transforms the core `fetchQuota` + `providerPresence` + `quotaJsonReport` graph plus `runtime.js` shims (`"fs/promises"` async preload/flush, `"crypto"`, `"buffer"`, `"path"`, `"url"`, `"os"` platform normalization, global `fetch` 256 KiB wrapper, pure-JS `AbortController`/`TextDecoder`, timer-free timeouts, subprocess-free `lib/process.js` stub) into `mods/quota-manager/vendor/quota-axi/` with `LICENSE` preserved.
   - Run `node scripts/build-vendor.mjs`, `npm run check`, and `npm run check:herdr` to prove Herdr's runtime loads the bundled vendor tree cleanly.
3. **Wire direct local query in the Mod (`command.js`, `store.js`, `main.js`, `i18n.js`) & remove `collector/query.mjs`**:
   - Delete `collector/query.mjs` and `tests/collector.test.mjs`.
   - Update `mods/quota-manager/command.js`, `store.js`, and `main.js` (`home`, `appHome`, `window()?.platform`) so `on === null` calls `queryLocalQuota` directly in-process (passing output to `parseReport` / `normalizeReport`, zero `exec` calls) while `on !== null` keeps `exec("quota-axi", ...)` with `{ on: machine }` and zero fallback to local.
   - Update `mods/quota-manager/i18n.js` and `main.js` `helpView` in English and Chinese (built-in local `quota-axi` collection vs remote `PATH` `quota-axi`; display-only keychain note).
4. **Update installer & retire owned collector directories (`scripts/install.mjs`)**:
   - Update `scripts/install.mjs` to rebuild `mods/quota-manager/vendor/quota-axi/` on real installs, stage and `herdr-app check` `mods/quota-manager`, swap `<app-home>/mods/quota-manager` atomically, and retire `<app-home>/collectors/quota-manager` and `<app-home>/collectors/quota-axi` into `<app-home>/.quota-manager-backups/` **only** when `.quota-manager-collector.json` has `"project": "herdr-quota-manager"` (on both `install` post-check and `uninstall`). Keep `--dry-run` offline.
5. **Update tests (`tests/local-query.test.mjs`, `command.test.mjs`, `ui.test.mjs`, `mock-host.mjs`, `install.test.mjs`)**:
   - Add isolated in-process tests for `queryLocalQuota` (allowlist check, empty `home`, snapshot fixture, mocked `fetch` windows & >256 KiB cap, Muse gate under `appHome`, zero `exec`), remote vs local `command.js` tests, `ui.test.mjs` consent/remote assertions (keeping `justify_end` status-row tests), and installer retirement/marker/rollback tests.
6. **Update documentation & Trellis specs**:
   - Update `THIRD_PARTY_NOTICES.md`, `README.md`, `README.zh-CN.md`, `RECIPE.md`, `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `SECURITY.md`, `AGENTS.md`, `.trellis/spec/mod/*.md`, and `.trellis/spec/tooling/*.md` to reflect direct in-Mod `quota-axi` queries, collector retirement, and MIT `Copyright (c) 2026 Kun Chen` attribution while preserving status-bar trailing-slot copy.
7. **Run full verification & real local install check (with `consent: false` preserved)**:
   - Run `npm run check`, `npm test`, `npm run check:herdr`, and `just ci`.
   - Run `just install`, verify `C:\Users\lyh\.config\herdr-app\collectors\quota-manager` was moved to `.quota-manager-backups/`, verify `C:\Users\lyh\.config\herdr-app\mods\quota-manager\vendor\quota-axi\index.js` exists, and verify `shared.json` still has `consent: false` and no cache keys.
   - Run `trellis-check` against all `prd.md` acceptance criteria, then stop and present the Phase 3.4 commit plan without committing or pushing.

## Validation commands

- `node scripts/build-vendor.mjs`
- `npm run check`
- `npm test`
- `npm run check:herdr`
- `just ci`
- `just install` (followed by read-only verification that `collectors/quota-manager` moved aside and `consent` in `shared.json` is still `false`)

## Risky files

- `scripts/build-vendor.mjs` & `mods/quota-manager/vendor/quota-axi/**`: must leave zero `node:`, bare npm, `require(`, `setTimeout(`, or `setInterval(` tokens, and must serialize call-scoped `home`/`appHome` virtual-FS state across concurrent `QuotaStore` workers.
- `mods/quota-manager/command.js`, `store.js`, `main.js`: `main.js` must remain the only importer of `"herdr"`, must not call `home()` / `appHome()` at import time, and must never route remote `on` into local `queryLocalQuota`.
- `scripts/install.mjs`: must only retire `collectors/quota-manager` and `collectors/quota-axi` after `herdr-app check` passes and only when `.quota-manager-collector.json` has `"project": "herdr-quota-manager"`.
- Shared documentation files (`README*`, `RECIPE.md`, `THIRD_PARTY_NOTICES.md`, `docs/VALIDATION.md`, `.trellis/spec/mod/*`): preserve existing uncommitted status-row edits on `bottom-right-quota-strip`.

## Rollback

- Failed `herdr-app check` during `just install` removes staging without modifying `<app-home>/mods/quota-manager` or `<app-home>/collectors/*`.
- Runtime rollback is `just uninstall` (or restoring from `<app-home>/.quota-manager-backups/`).
- Source rollback is restoring only the collector hunks without discarding `11-12-bottom-right-quota-strip` edits or untracked `gpui-kit.d.ts` / `jsconfig.json`.
