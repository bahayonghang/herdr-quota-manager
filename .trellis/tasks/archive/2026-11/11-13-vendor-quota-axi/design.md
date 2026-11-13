# Vendor quota-axi into the Mod — design

Requirements are in `prd.md`; runtime verification evidence is in `research/mod-runtime.md` and `research/upstream.md`.

## Architecture

```
third_party/quota-axi/src          upstream 0.1.69 snapshot (MIT, Copyright (c) 2026 Kun Chen)
        │
        │  scripts/build-vendor.mjs (tsc + Herdr runtime AST/module transform)
        ▼
mods/quota-manager/vendor/quota-axi/
  ├── LICENSE                      upstream MIT license copy
  ├── index.js                     exports queryLocalQuota(id, context)
  ├── runtime.js                   Herdr-compatible fs/os/process/http/abort/decoder shims
  ├── advice.js, cache.js, interpretation.js, pace.js, render.js, types.js
  ├── lib/*.js                     core helpers rewritten onto ./runtime.js + unprefixed built-ins
  └── providers/*.js               upstream provider adapters (refresh/inference/swap pruned)
        ▲
        │  direct ESM import (local on === null; zero exec / node / CLI)
mods/quota-manager/command.js  ◀── store.js ◀── main.js (supplies home(), appHome(), window()?.platform, exec)
        │
        │  remote host only (on = machine)
        ▼
herdr.exec("quota-axi", ["--json", "--provider", id, "--no-credential-refresh", "--max-age", "0"|"90s"], { on })
```

### Ownership & runtime boundaries

- `main.js` remains the **only** file in `mods/quota-manager/` that imports `"herdr"` (`home`, `appHome`, `exec`, `window`, `shared`, `setShared`, etc.) and `"gpui-kit"` (`View`). It constructs `QuotaStore` with a `localQuery` callback `(id, { force, platform }) => queryLocalQuota(id, { force, home: home(), appHome: appHome(), platform })`. None of `home()`, `appHome()`, `fs/promises`, or `fetch` run at module import time or when `consent === false`.
- `store.js` keeps admission control, cross-view leases (`quota-manager.v1.lease:[host, id]`), backoff, history, and alert state unchanged. When `host === null`, it passes `localQuery` to `fetchQuota`; when `host !== null`, it passes `localQuery: null` so remote calls can never invoke local collection.
- `command.js` owns both query paths behind `fetchQuota`:
  - **Local (`on === null`)**: validates `assertProvider(id)`, calls `await localQuery(id, { force, platform })`, parses the returned JSON/object with `parseReport`, and normalizes lanes with `normalizeReport(report, id, now())`. Timeout-like network errors map to `host_unavailable`; malformed/non-5-or-6 reports throw `invalid_report`; unexpected runtime failures throw `cli_failed` without keeping raw error messages. Zero subprocesses are started.
  - **Remote (`on !== null`)**: ignores `localQuery`, builds `commandsFor(id, platform, force)` (`quota-axi` with `--json --provider <id> --no-credential-refresh --max-age <0|90s>`), calls `exec(command, args, { on, timeout: QUERY_TIMEOUT })` in direct -> login shell -> `cmd.exe` order, parses exit `0` or `1` once, maps `127`/`9009`/launcher start failure across all launchers to `cli_missing`, maps other exits to `cli_failed`, and never falls back to local execution.

## Snapshot contents (`third_party/quota-axi/`)

Keep the pinned upstream tree from `https://github.com/kunchenguid/quota-axi` at `5734c41eee52eb9a80ba67f47269ebc06c0c41fc` (`0.1.69`):

- Tracked: `src/`, `bin/`, `test/`, `scripts/`, `skills/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `LICENSE`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CONTRIBUTING.md`, `VISION.md`, `CLAUDE.md`, `.gitignore`, `.prettierignore`, and `UPSTREAM.md`.
- Omitted: `.git`, `.github`, `.airlock`, `.no-mistakes`, `.no-mistakes.yaml`, `.release-please-manifest.json`, `release-please-config.json`.
- Ignored in root `.gitignore`: `third_party/quota-axi/node_modules/`, `third_party/quota-axi/dist/`, `third_party/quota-axi/.deploy/`.

## Vendor build & Herdr runtime adaptation (`scripts/build-vendor.mjs`)

`research/mod-runtime.md` documents the exact `herdr-app check` and `scripts/check.mjs` constraints. `scripts/build-vendor.mjs` compiles `third_party/quota-axi` (`pnpm install --frozen-lockfile` when `third_party/quota-axi/dist/src/commands.js` or `node_modules` is missing/stale, then `pnpm build` / `tsc`) and emits a clean, deterministic module tree under `mods/quota-manager/vendor/quota-axi/`:

1. **Pruned non-query modules**:
   - Exclude CLI/TUI/TOON/model-catalog/skill files: `cli.js`, `args.js`, `models.js`, `model-kb.js`, `skill.js`, `tui.js`, `tui-live.js`, `tui-viewport.js`, `lib/system-theme.js`, `version.js`.
   - Exclude credential-mutating / inference-spending helpers already disabled by `refreshCredentials: false` and `allowClaudeInference: undefined`: `providers/delegated-refresh.js` (stub `delegateCliRefresh -> { attempted: false }`), `providers/claude-native-quota.js` (stub `fetchClaudeNativeQuota -> unavailable`), and `providers/claude-swap.js` (stub `claudeSwapEnabled -> false`).
   - Strip TOON imports (`@toon-format/toon`) from `render.js`, retaining `quotaJsonReport` and `redactedResponse`.
   - Replace `axi-sdk-js` with a 6-line local `AxiError` class in `runtime.js`.

2. **Allowed imports only**:
   - Rewrite `node:crypto` -> `"crypto"`, `node:buffer` -> `"buffer"`, `node:url` -> `"url"`, and `node:path` -> `./runtime.js` `path` wrapper (re-exporting Herdr's `"path"` plus pure-JS `posix` / `win32` helpers if needed).
   - Rewrite `node:os`, `node:fs`, `node:fs/promises`, `node:async_hooks`, `node:timers/promises`, `node:util`, `node:child_process`, `node:http`, `node:https`, and `proxy-from-env` / `undici` onto `./runtime.js`.
   - Result: zero `from "node:..."`, zero bare npm specifiers, zero `require(`, zero `setTimeout(`, and zero `setInterval(` anywhere in `mods/quota-manager/`.

3. **Async virtual-FS preload & flush (`runtime.js` + `"fs/promises"`)**:
   - Herdr's `"fs/promises"` allows async reads inside `home()` and async writes inside `appHome()`, while upstream `quota-axi` uses synchronous `readFileSync` / `existsSync` / `statSync` inside credential stores, `cache.js`, `input-trace.js`, and `muse-read-gate.js`.
   - Before each `queryLocalQuota(id, { force, home, appHome, platform, snapshot, env })` call:
     1. Compute the candidate file list for that single allowlisted `id` under `home` (e.g., `~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.claude.json`, `~/.cursor/...`, `~/.config/...`, `AppData/Roaming/...`, `AppData/Local/...`, `~/.pi/agent/auth.json`, etc.) plus `<appHome>/quota-manager-collector/cache/quotas.json`, `<appHome>/quota-manager-collector/state/muse-key-reads.json`, and optional test `snapshot`.
     2. Read existing files asynchronously via `"fs/promises"` `readFile` (ignoring `ENOENT`/`EACCES`) into a call-scoped in-memory FS map (`Buffer` + synthetic `mtimeMs`/`size` metadata).
     3. Run upstream `fetchQuota([id], { allowKeychainPrompt: false, refreshCredentials: false }, force ? 0 : 90)` + `providerPresence` + `quotaJsonReport(response, false, laneAbsent)` synchronously/asynchronously against that scoped context (serialized one local call at a time in `runtime.js` so call-scoped `home`/`env`/FS state never races across the two `QuotaStore` workers).
     4. Flush any dirty cache/state files written under `<appHome>/quota-manager-collector/` via `"fs/promises"` `mkdir` + `writeFile` (best-effort; never writes outside `appHome()`).

4. **Platform, environment, globals, and HTTP shims (`runtime.js`)**:
   - `os.platform()` & `process.platform`: normalize Herdr's `"windows"` -> `"win32"` and `"macos"` -> `"darwin"` (falling back to `"os"` `platform()` mapped the same way). `os.homedir()` returns the call's `home`.
   - `process.env`: never reads `globalThis.process?.env` implicitly (which is `undefined` in Herdr and would leak developer shell vars in Node tests). Synthesizes standard path variables from `home` and `appHome` (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `QUOTA_AXI_CACHE_DIR`, plus explicit test `snapshot` -> `QUOTA_AXI_SNAPSHOT` when passed in unit tests).
   - `AbortController` / `TextDecoder` / timer-free timeouts: provide lightweight pure-JS `AbortController` and `Buffer.from(bytes).toString("utf8")` `TextDecoder`; rewrite `setTimeout` / `clearTimeout` in provider fetch helpers to no-op handles so `scripts/check.mjs` and QuickJS both pass cleanly.
   - `lib/http.js`: implement `providerFetch` over global `fetch(url, { method, headers, body })` (omitting unsupported `signal`/`dispatcher` options for Herdr compatibility) and wrap `ShellFetchResponse` with `{ status, ok, url, headers: { get: () => null }, text, json }`. Implement `readBoundedResponseBody` via `await response.text()` -> `Buffer.from(text, "utf8")`, rejecting payloads over `262_144` bytes with `fail("response_too_large")`.
   - `lib/fetch-lock.js`: replace filesystem lock polling with an in-memory per-provider turn queue.
   - `lib/process.js` & `agy` local socket helpers: `findCommandPath` returns `undefined` and `execFileText` rejects with `ENOENT` (zero subprocesses); `agy` local self-signed HTTPS / process-table helpers return unavailable so providers needing external binaries (`sqlite3`, `bl`, `higgsfield`, keychain CLI) or local TLS sockets report upstream's structured `skipped` / unavailable state cleanly.

## Installer & retirement of standalone collector directories (`scripts/install.mjs`)

1. **Removed artifacts**:
   - Delete `collector/query.mjs` and `tests/collector.test.mjs` from the repository.
   - Remove `publishCollector` / `restoreCollector` / `COLLECTOR_ENTRY` logic from `scripts/install.mjs`.
2. **Real install (`just install` / `node scripts/install.mjs`)**:
   - Check Node `>= 22.19`.
   - Run `buildVendor()` (from `scripts/build-vendor.mjs`) so any local edits under `third_party/quota-axi/src` are compiled into `mods/quota-manager/vendor/quota-axi/` before staging (`installMod` in unit tests accepts `build = null` or `skipBuild = true` when testing staging/rollback in isolation).
   - Stage `mods/quota-manager` (including `vendor/quota-axi/`), write `.quota-manager-install.json`, and run `herdr-app check <staging>`.
   - If `herdr-app check` fails: delete `<staging>` and leave the live `<app-home>/mods/quota-manager` and any existing `<app-home>/collectors/*` untouched.
   - Swap `<staging>` into `<app-home>/mods/quota-manager` (backing up any existing Mod to `<app-home>/.quota-manager-backups/`).
   - **Retire obsolete collector directories**: inspect `<app-home>/collectors/quota-manager` and `<app-home>/collectors/quota-axi`. For each path:
     - If absent, a symlink, not a directory, missing `.quota-manager-collector.json`, or `marker.project !== "herdr-quota-manager"`: leave untouched (`null`).
     - If owned (`marker.project === "herdr-quota-manager"`): move (`rename`) to `<app-home>/.quota-manager-backups/retired-collector-<name>-<timestamp>-<uuid>`.
3. **Uninstall (`just uninstall` / `node scripts/install.mjs --uninstall`)**:
   - Move owned `<app-home>/mods/quota-manager` to `<app-home>/.quota-manager-backups/removed-<timestamp>-<uuid>`.
   - Run the same marker-gated retirement on `<app-home>/collectors/quota-manager` and `<app-home>/collectors/quota-axi` (refusing or skipping unmarked/foreign directories and symlinks without deleting them).
   - Leave `shared.json` preferences/history and personal layouts untouched.
4. **Dry-run (`node scripts/install.mjs --dry-run`)**:
   - Print `Install: <app-home>/mods/quota-manager` (or `Uninstall: <app-home>/mods/quota-manager`) without building, copying, or moving directories. `just ci` stays 100% offline.

## Checker & tests

- `scripts/check.mjs` keeps skipping `.git`, `node_modules`, and `third_party`, while checking every `.js` and `.json` inside `mods/quota-manager/` (including `mods/quota-manager/vendor/quota-axi/**`) for syntax and the `setTimeout`/`setInterval`/`require(`/ `from "node:` ban.
- Tests (`tests/*.test.mjs`):
  - `tests/local-query.test.mjs` (replaces `tests/collector.test.mjs`): tests `queryLocalQuota` in-process with isolated temporary `home` / `appHome` directories, snapshot fixtures, mocked `fetch` responses (fresh windows, HTTP errors, >256 KiB cap), Muse read-gate ledger under `appHome`, and non-allowlisted provider rejection—with zero subprocesses and zero live vendor requests.
  - `tests/command.test.mjs`: verifies local `fetchQuota` calls `localQuery` once without calling `exec`, passes schema 5/6 reports through `parseReport`/`normalizeReport`, maps errors safely, and verifies remote `fetchQuota` (`on: "remote"`) still uses `exec("quota-axi", ...)` with zero local fallback.
  - `tests/ui.test.mjs` & `tests/mock-host.mjs`: adds `home` to `mock-host.mjs` (pointing to an isolated empty temp directory), verifies clicking `consent` queries only the 4 default-enabled providers via the in-Mod path (`host.state.executions.length === 0`) while remote spaces still call `exec` with `on: "remote"`, and preserves all trailing status-bar (`justify_end`) assertions.
  - `tests/install.test.mjs`: verifies Mod stage/check/swap/rollback, owned `collectors/quota-manager` and `collectors/quota-axi` retirement on install and uninstall, preservation of unmarked/foreign collector directories and symlinks, and offline `--dry-run`.

## Docs, specs, and copy

Update collector boundary and attribution sentences (preserving uncommitted status-bar trailing-slot copy) in:

- `THIRD_PARTY_NOTICES.md`, `third_party/quota-axi/UPSTREAM.md`
- `README.md`, `README.zh-CN.md`, `RECIPE.md`
- `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `SECURITY.md`, `AGENTS.md`
- `.trellis/spec/mod/runtime-boundary.md`, `.trellis/spec/mod/data-contracts.md`, `.trellis/spec/mod/directory-structure.md`
- `.trellis/spec/tooling/installer.md`, `.trellis/spec/tooling/index.md`
- `mods/quota-manager/i18n.js` (`helpText`, `cli_missing` in English and Chinese) and `mods/quota-manager/main.js` (`helpView` removes global npm / external local script wording; keychain command remains a display-only `note`).

## Trade-offs

- Committing generated `mods/quota-manager/vendor/quota-axi/` (~700 KB of readable ESM) makes git diffs larger when bumping `quota-axi`, in exchange for zero-network CI (`just ci`), instant `npm run check:herdr` on a clean checkout, and zero external collector directories under `<app-home>/collectors/`.
- Running 100% inside Herdr's JS runtime without spawning helper binaries means providers whose only local credential store is an external binary/SQLite DB or local self-signed TLS socket (`agy` local language server, `alibaba` `bl`, `higgsfield` CLI, SQLite-only Cursor/OpenCode stores when JSON auth files are absent) report structured `skipped`/unavailable status locally rather than invoking `exec`. Standard file + HTTPS providers run natively in-process.

## Rollback

- Failed `herdr-app check` during `just install` discards staging before touching `<app-home>/mods/quota-manager` or retiring owned collector directories.
- `just uninstall` moves `<app-home>/mods/quota-manager` (and any owned leftover collector directories) into `<app-home>/.quota-manager-backups/` while retaining `shared.json`.
- Never assign PowerShell `$HOME`, never edit `shared.json`, and never delete unmarked user directories.
