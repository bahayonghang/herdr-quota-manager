# Vendor quota-axi into the Mod for direct local queries

## Goal

Keep a pinned upstream snapshot of `quota-axi` in `third_party/quota-axi/` and compile/adapt its core query implementation into `mods/quota-manager/vendor/quota-axi/` so the Mod executes local quota queries directly via in-process function calls—never by installing a global CLI, never by launching `dist/bin/quota-axi.js`, never by spawning `node` on `collectors/quota-manager/query.mjs`, and never by calling `exec` for a local `quota-axi` program.

The user value is a self-contained Mod that queries local provider quotas directly inside Herdr's runtime, preserves upstream MIT attribution (`Copyright (c) 2026 Kun Chen`) and schema 5/6 normalization, keeps remote host `exec` isolation intact, and remains editable from `third_party/quota-axi/`.

## Confirmed facts

- Upstream `https://github.com/kunchenguid/quota-axi` at commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc` (`2026-10-29`, `chore(main): release quota-axi 0.1.69 (#363)`) is version `0.1.69`, licensed under MIT (`Copyright (c) 2026 Kun Chen`), with `packageManager: "pnpm@11.1.1"` and `engines.node: ">=22.19"`. That snapshot is checked out at `third_party/quota-axi/` without nested `.git`.
- In `third_party/quota-axi/src/commands.ts`, `--json --provider <id> --no-credential-refresh --max-age <0|90s>` calls `fetchQuota([id], { allowKeychainPrompt: false, refreshCredentials: false }, maxAgeSeconds)`, classifies `providerPresence`, and formats `quotaJsonReport(response, false, laneAbsent)` (schema 5 or 6). Under those options, delegated CLI credential refresh, Claude inference probes, Claude account swap, and interactive keychain prompts are already disabled upstream.
- Empirical `herdr-app check` verification (`research/mod-runtime.md`) proves Herdr's Mod runtime (`gpui-shell`) resolves relative `./` ES modules inside `mods/quota-manager/`, `gpui-kit`, `gpui-base`, `herdr` (`home`, `appHome`, `exec`, `window`, etc.), unprefixed `"fs/promises"`, `"crypto"`, `"buffer"`, `"path"`, `"url"`, and `"os"`, plus global `fetch`, `Buffer`, and `crypto`. It rejects relative `../` imports outside `mods/quota-manager/`, every `node:*` specifier, every bare npm package specifier, and synchronous `"fs"`.
- `scripts/check.mjs` skips `.git`, `node_modules`, and `third_party`, parses all `.json` files, runs `node --check` on all `.js`/`.mjs` files, and rejects `setTimeout(`, `setInterval(`, `require(`, and `from "node:` across `mods/quota-manager/**/*.js`.
- In Herdr's runtime, `os.platform()` returns `"windows"` / `"macos"` / `"linux"` (not `"win32"` / `"darwin"`), `process.env`, `AbortController`, and `TextDecoder` are `undefined`, and `fetch` returns `ShellFetchResponse` (`{ status, ok, url, text(), json() }`) without `response.headers` or `response.body`.
- On this machine (`Node v26.7.0`, `pnpm 12.20.0`), the working tree currently contains an uncommitted prototype from the rejected `collector/query.mjs` (`node <appHome>/collectors/quota-manager/query.mjs`) approach, and `C:\Users\lyh\.config\herdr-app\collectors\quota-manager` exists with `.quota-manager-collector.json` (`"project": "herdr-quota-manager"`).
- Shared state currently has `consent: false` and no `quota-manager.v1.cache:*` entries. Branch `bottom-right-quota-strip` (HEAD `28a24b8`) also holds uncommitted edits and active task `.trellis/tasks/11-12-bottom-right-quota-strip` (`status: "in_progress"`), plus untracked `mods/quota-manager/gpui-kit.d.ts` and `mods/quota-manager/jsconfig.json`.

## Requirements

1. **Upstream snapshot & provenance**: Keep the pinned `quota-axi` `0.1.69` snapshot at `third_party/quota-axi/` (source, tests, `pnpm-lock.yaml`, `LICENSE`, `README.md`, no nested `.git`, `dist/` and `node_modules/` gitignored) together with `third_party/quota-axi/UPSTREAM.md` recording `https://github.com/kunchenguid/quota-axi`, commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, version `0.1.69`, MIT license, and `Copyright (c) 2026 Kun Chen`.
2. **Direct in-Mod local query**: Build/adapt the core `quota-axi` query module graph from `third_party/quota-axi/` into `mods/quota-manager/vendor/quota-axi/` so a local query (`on === null`) calls an imported function (`queryLocalQuota`) directly inside the Mod runtime. It must not call `exec`, `spawn`, `node`, `collector/query.mjs`, or `dist/bin/quota-axi.js`. Its return value still flows through `parseReport` and `normalizeReport`, accepting only `schemaVersion` 5 and 6 (`invalid_report` otherwise).
3. **Runtime & static check compliance**: Every module under `mods/quota-manager/` (including `mods/quota-manager/vendor/quota-axi/`) must pass both `scripts/check.mjs` (no `node:`, `require(`, `setTimeout(`, `setInterval(`) and `herdr-app check` (`npm run check:herdr`). `main.js` remains the only Mod file importing `"herdr"`.
4. **Remote host contract**: Remote queries (`on !== null`) continue using `exec` with `{ on: machine, timeout: 45000 }` and `commandsFor(id, platform, force)` (`quota-axi --json --provider <id> --no-credential-refresh --max-age <0|90s>` across direct, login shell, and `cmd.exe` launchers). Local Windows/host paths are never passed to a remote host, and remote failures never fall back to local `queryLocalQuota`.
5. **Preserved product, privacy, and UI contracts**:
   - Provider IDs come exclusively from `providers.js` (`assertProvider`); preferences never become shell syntax.
   - `consent: false` blocks all collection; `Query OFF` filters out a provider before any local call or remote `exec`; `Show OFF` only hides UI items; `muse` still requires `museConsent` and is never auto-enabled by Select detected.
   - `--no-credential-refresh` semantics hold (`refreshCredentials: false`, `allowKeychainPrompt: false`, no `allowClaudeInference`).
   - Do not persist emails, tokens, raw errors, remedy commands, or `stderr`; visible errors map only to safe keys in `i18n.js`.
   - Do not modify Herdr `layouts/`, `keys.json`, or `shared.json`.
   - Keep status-bar chips in the existing single status row immediately left of the command hint (`justify_end` / trailing `quota-slot`); do not restore a separate 30px quota row; keep referencing Herdr's shipped icons where configured.
6. **Installer & collector retirement**:
   - Remove the standalone `collector/query.mjs` publishing flow. `scripts/install.mjs` builds/refreshes `mods/quota-manager/vendor/quota-axi/` from `third_party/quota-axi/` on real installs, stages `mods/quota-manager`, runs `herdr-app check`, and swaps `<app-home>/mods/quota-manager` atomically (leaving the existing Mod untouched on check failure).
   - Decommission previously published `<app-home>/collectors/quota-manager` and `<app-home>/collectors/quota-axi`: during both `install` (only after `herdr-app check` and Mod swap succeed) and `uninstall`, move a directory aside to `<app-home>/.quota-manager-backups/` **only** when it is a non-symlink directory whose `.quota-manager-collector.json` has `"project": "herdr-quota-manager"`. Leave unmarked, foreign, or symlinked directories untouched.
   - `--dry-run` prints the Mod target path without building, copying, or moving directories, keeping `just ci` offline.
7. **Attribution & help copy**:
   - `THIRD_PARTY_NOTICES.md`, `README.md`, `README.zh-CN.md`, `RECIPE.md`, `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `SECURITY.md`, and `AGENTS.md` clearly state that quota collection logic is vendored/adapted from upstream `quota-axi` (`0.1.69`, commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, MIT, `Copyright (c) 2026 Kun Chen`) while the Mod UI, state store, preferences, and Herdr integration are written in this repository.
   - Remove all local setup instructions telling users to run `npm install -g quota-axi` or describing `collectors/quota-manager/query.mjs` / `collectors/quota-axi` as active local runtime paths. Settings help (`i18n.js` and `main.js`) explains in English and Chinese that local queries run built-in `quota-axi` collection inside the Mod while remote hosts still need `quota-axi` on `PATH`.
8. **Session & git guardrails**: Keep `consent: false`, do not click Start, do not run live provider queries, do not archive `.trellis/tasks/11-12-bottom-right-quota-strip`, do not amend `28a24b8`, do not commit or push without explicit approval, and keep `mods/quota-manager/gpui-kit.d.ts` and `mods/quota-manager/jsconfig.json` unstaged.

## Decisions

- **Rejected local query approaches (permanently excluded)**:
  1. `npm install -g quota-axi`
  2. Publishing and executing `collectors/quota-axi/dist/bin/quota-axi.js`
  3. Publishing and executing `collectors/quota-manager/query.mjs` forwarding to `quotaCommand`
  4. Any local query path that invokes `exec` / `node <script>` / a standalone `quota-axi` binary
- **In-Mod vendor bundle**: `scripts/build-vendor.mjs` compiles `third_party/quota-axi` and writes Herdr-compatible ES modules into `mods/quota-manager/vendor/quota-axi/` (tracked in git so offline `just ci`, `npm test`, and `npm run check:herdr` work from a clean checkout, and rebuilt on real `just install` when customizing `third_party/quota-axi`).
- **Subprocess-free local runtime shim**: Local file + HTTPS provider paths run natively via Herdr's `"fs/promises"` (under `home()` / `appHome()`) and global `fetch`; upstream sources that require external binaries or local self-signed sockets (`sqlite3`, `bl`, `higgsfield`, keychain CLI helpers, `agy` loopback socket) receive an unavailable stub in `lib/process.js` / `agy` shim rather than spawning subprocesses, reporting upstream's structured `skipped` / unavailable state cleanly.
- **Remote boundary**: Remote hosts keep `exec("quota-axi", ...)` with `{ on: machine }` because Mod `fs/promises` and `fetch` only read the local machine.

## Out of scope

- Enabling `consent`, reading real user credentials, or running live vendor queries.
- Modifying status-row layout, chip placement, icons, `mod.json` slot placement, Herdr layouts, `keys.json`, or `shared.json`.
- Archiving `.trellis/tasks/11-12-bottom-right-quota-strip`, reverting its status-bar edits, or amending `28a24b8`.
- Git submodules, automatic upstream pulls, free-form shell settings, or installing `quota-axi` onto remote hosts.
- Adding login, credential refresh, Claude inference opt-in, cookie import, billing charts, or drag-and-drop ordering.

## Acceptance criteria

1. `third_party/quota-axi/package.json` is version `0.1.69`, `third_party/quota-axi/.git` does not exist, `third_party/quota-axi/LICENSE` preserves `Copyright (c) 2026 Kun Chen`, and `third_party/quota-axi/UPSTREAM.md` records the repo URL, SHA `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, version, and MIT license.
2. `mods/quota-manager/vendor/quota-axi/` contains the built/adapted core `quota-axi` modules plus upstream MIT copyright notice, and `collector/query.mjs` is removed.
3. Unit and UI tests verify that a local query (`on === null`) calls the in-Mod `queryLocalQuota` path directly with **zero** `exec` calls, rejects non-allowlisted provider IDs before running, enforces `refreshCredentials: false` and `allowKeychainPrompt: false`, passes schema 5/6 output through `parseReport` and `normalizeReport`, and surfaces safe error codes (`invalid_report`, `cli_failed`) without leaking raw errors.
4. Command and store tests verify that a remote query (`on !== null`) still calls `exec` with `{ on: machine }`, `quota-axi`, and `queryArgs`, never receives local paths, never calls `queryLocalQuota` on remote failure, and keeps single-attempt exit `0`/`1`/`2`/timeout semantics.
5. `npm run check`, `npm test`, `npm run check:herdr`, and `just ci` all pass with zero `node:`, `require(`, `setTimeout(`, or `setInterval(` under `mods/quota-manager/`, and `git status` shows neither `third_party/quota-axi/node_modules` nor `third_party/quota-axi/dist`.
6. Installer tests verify staging + `herdr-app check` + atomic swap of `<app-home>/mods/quota-manager`, rollback on check failure, retirement (move to `.quota-manager-backups/`) of marked `<app-home>/collectors/quota-manager` and `<app-home>/collectors/quota-axi` on both install and uninstall, preservation of unmarked/foreign collector directories and symlinks, and offline `--dry-run`.
7. Running `just install` moves the owned `C:\Users\lyh\.config\herdr-app\collectors\quota-manager` directory to `.quota-manager-backups/`, installs `<app-home>/mods/quota-manager` passing `herdr-app check`, and leaves `shared.json` (`consent: false`) and Herdr layouts untouched.
8. Searching `README.md`, `README.zh-CN.md`, `RECIPE.md`, `THIRD_PARTY_NOTICES.md`, `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `SECURITY.md`, `AGENTS.md`, `.trellis/spec/**`, `mods/quota-manager/**`, and `scripts/**` finds no `npm install -g quota-axi` and no active `collectors/quota-manager/query.mjs` runtime reference, while attribution to Kun Chen's MIT `quota-axi` (`0.1.69`, `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`) and distinction from this repo's Mod UI code are explicit.
