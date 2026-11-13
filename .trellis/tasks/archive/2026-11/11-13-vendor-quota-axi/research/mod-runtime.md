# Herdr Mod Runtime Import & Capability Evidence

Verified on 2026-11-13 against the local `herdr-app` binary (`herdr-app check <mod-dir>` with an isolated temporary `HERDR_APP_HOME`), `C:\Users\lyh\.config\herdr-app\AGENTS.md`, `C:\Users\lyh\.config\herdr-app\gpui-kit.d.ts`, shipped Mods (`auto-title/service.js`, `git-graph/update.js`), and this repository's `scripts/check.mjs`.

No live provider query was executed, `C:\Users\lyh\.config\herdr-app\shared.json` was not modified, and `consent` remained `false`.

## 1. Module Specifiers Accepted vs Rejected by `herdr-app check`

Isolated probe Mods (minimal `mod.json` + `main.js` exporting a `gpui-kit` `View`) were checked with `herdr-app check <probe-dir>`:

### Accepted specifiers (`herdr-app check` resolves module)

- **Host & UI modules**: `gpui-kit`, `gpui-base`, `gpui`, `gpui-shell`, `gpui-fps`, `gpui-component`, `herdr`
  - `herdr` runtime exports: `agents`, `appHome`, `closeOverlay`, `commands`, `exec`, `feedbackAttachImages`, `feedbackClearImages`, `feedbackPasteImage`, `feedbackPickImages`, `feedbackPreview`, `focused`, `fonts`, `hc`, `home`, `keys`, `knownAgents`, `layout`, `layouts`, `machines`, `nextCommand`, `notify`, `openOverlay`, `panes`, `pickFolder`, `placement`, `playSound`, `presentUpdateNotes`, `props`, `readTextFile`, `run`, `sendFeedback`, `setAgentOrder`, `setShared`, `settings`, `shared`, `spaces`, `telemetry`, `terminals`, `theme`, `themes`, `updates`, `watchFolder`, `window`, `writeTextFile`
- **Relative ESM inside the Mod directory**:
  - `./helper.js` and nested subdirectories such as `./vendor/quota-axi/index.js` pass `herdr-app check` (`exit 0`).
  - Dynamic `import("./lazy.js")` inside the Mod directory also passes `herdr-app check` (`exit 0`).
- **Unprefixed runtime built-in modules** (provided by `gpui-shell`'s embedded JS runtime and also valid standard specifiers in Node.js 22+):
  - `"fs/promises"` — exports `exists`, `mkdir`, `readFile`, `readdir`, `rmdir`, `unlink`, `writeFile` (reads permitted inside `home()`, writes permitted inside `appHome()`; note: **no** `open`, `stat`, `access`, `rm`, `mkdtemp`, `symlink`)
  - `"crypto"` — exports `createHash`, `createHmac`, `randomBytes`, `randomFill`, `randomFillSync`, `randomInt`, `randomUUID`, `getRandomValues`, `webcrypto`, `Md5`, `Sha1`, `Sha256`, `Sha384`, `Sha512`, `Crc32`, `Crc32c`
  - `"buffer"` — exports `Buffer`, `atob`, `btoa`, `constants`
  - `"path"` — exports `basename`, `delimiter`, `dirname`, `extname`, `format`, `isAbsolute`, `join`, `normalize`, `parse`, `relative`, `resolve`, `sep` (note: **no** `path.win32` or `path.posix` namespace objects)
  - `"url"` — exports `URL`, `URLSearchParams`, `domainToASCII`, `domainToUnicode`, `fileURLToPath`, `format`, `pathToFileURL`, `urlToHttpOptions`
  - `"os"` — exports `EOL`, `arch`, `platform` (note: `platform()` returns `"windows"` on Windows and `"macos"` on macOS rather than Node's `"win32"` / `"darwin"`, and `"os"` does **not** export `homedir`, `hostname`, `tmpdir`, `userInfo`, or `devNull`)
  - `"process"` — exports `arch`, `exit`, `nextTick`, `platform`, `run` (note: `process.env` is `undefined`)
  - `"zlib"`, `"net"`, `"websocket"`, `"console"`

### Rejected specifiers (`herdr-app check` exits `1`)

1. **Relative imports escaping the Mod directory (`../outside.js`, `../../third_party/...`, `../../collectors/...`)**:
   ```text
   Error: check failed for ...:
     evaluating main.js: module '../outside.js' resolves outside the application directory '\\?\C:\...'
   ```
   A Mod cannot import directly from `third_party/quota-axi` in the repository or from `<appHome>/collectors/...` outside `<appHome>/mods/quota-manager`. Every JS module loaded by the Mod must live inside `mods/quota-manager/`.

2. **Every `node:*` specifier (`node:fs`, `node:fs/promises`, `node:crypto`, `node:path`, `node:os`, `node:url`, `node:child_process`, `node:timers/promises`, `node:async_hooks`, `node:http`, `node:https`, `node:util`)**:
   ```text
   Error: check failed for ...:
     evaluating main.js: cannot resolve module 'node:path'
   ```

3. **Every bare npm package specifier (`axi-sdk-js`, `@toon-format/toon`, `proxy-from-env`, `undici`), even when `node_modules/<pkg>` is present inside the Mod directory**:
   ```text
   Error: check failed for ...:
     evaluating main.js: cannot resolve module 'fake-pkg': builtin modules are gpui, gpui-base, gpui-kit, gpui-shell, gpui-fps, gpui-component, herdr; an application may otherwise import only its own files.
   ```

4. **Unprefixed Node-only modules**:
   - `"fs"` (synchronous filesystem), `"child_process"`, `"http"`, `"https"`, `"util"`, `"async_hooks"`, `"timers/promises"`, `"sqlite"` all fail with `cannot resolve module '...'`.

## 2. Global Objects & `fetch` Shape in Herdr's Runtime

Probed inside `render()` under `herdr-app check` and cross-checked with `gpui-kit.d.ts` (lines 22184–22228):

- **Present globals**:
  - `fetch` (`function`)
  - `Buffer` (`function`)
  - `crypto` (`object`, with `crypto.subtle` `object`)
  - `URL` (`function`), `URLSearchParams` (`function`)
  - `atob` (`function`), `btoa` (`function`)
  - `performance` (`object`), `queueMicrotask` (`function`), `Uint8Array` (`function`), `DataView` (`function`)
- **Absent globals (`undefined`)**:
  - `process.env` (`process` object exists, `process.platform === "windows"`, `process.env === undefined`)
  - `AbortController`, `AbortSignal`
  - `TextEncoder`, `TextDecoder`
  - `Headers`, `Request`, `Response`, `ReadableStream`
  - `structuredClone`
  - `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval` (forbidden by Herdr Mod rules; timers use `cx.timer.after` / `cx.timer.every` in `main.js`)
- **`fetch(url, options)` contract (`ShellFetchResponse`)**:
  - Request options: `{ method?: string; headers?: Record<string, string>; body?: string | Uint8Array }` (no `signal` / `dispatcher`).
  - Response object: `{ status: number; ok: boolean; url: string; text(): Promise<string>; json(): Promise<any> }`. It does **not** expose `response.headers` (`Headers`) or `response.body` (`ReadableStream`).
  - Headless `herdr-app check` denies network requests during static initial-render verification (`HTTP request ... is not granted`), whereas the live Herdr app grants unrestricted `fetch` to Mods (`C:\Users\lyh\.config\herdr-app\AGENTS.md`: `Mods are trusted code: commands and network access (including fetch) are unrestricted`). Because `consent` defaults to `false` and top-level `await` is never used, `herdr-app check` never triggers a network call.

## 3. Repository Static Gate (`scripts/check.mjs`)

`scripts/check.mjs` walks the repository (skipping `.git`, `node_modules`, and `third_party`):

- Runs `JSON.parse` on every `.json` file.
- Runs `node --check` on every `.js` and `.mjs` file.
- For every `.js` file under `mods/quota-manager/`, rejects:
  ```js
  /\b(?:setTimeout|setInterval|require)\s*\(|from\s+["']node:/
  ```
- Unprefixed imports `"fs/promises"`, `"crypto"`, `"buffer"`, `"path"`, `"url"`, and `"os"` pass both `scripts/check.mjs` and `herdr-app check`, and resolve natively in Node.js 22+ during `npm test` / `npm run test:coverage`.

## 4. Exact Failure Points When Importing `third_party/quota-axi` Unmodified

Scanning `third_party/quota-axi/dist/src/**/*.js` (83 compiled ES modules from `quota-axi` 0.1.69, commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`) shows why raw `dist/src` cannot be imported directly by `mods/quota-manager`:

1. **Directory containment**: `third_party/quota-axi` sits outside `mods/quota-manager/`, which `herdr-app check` rejects.
2. **`node:*` imports across 47 files** (rejected by both `scripts/check.mjs` and `herdr-app check`):
   - `node:crypto`, `node:path`, `node:os`, `node:url`, `node:fs/promises` (have unprefixed Herdr equivalents, with `os`/`path`/`fs` API differences noted above).
   - `node:fs` (synchronous `readFileSync`, `existsSync`, `statSync`, `writeFileSync`, `renameSync`, `openSync`, `unlinkSync` in `cache.js`, `lib/fs.js`, `lib/fetch-lock.js`, `lib/input-trace.js`, `lib/user-config.js`, `lib/opencode-db.js`, and 11 provider files).
   - `node:child_process`, `node:timers/promises`, `node:async_hooks`, `node:http`, `node:https`, `node:util` (absent in Herdr).
3. **Bare npm imports across 4 files** (rejected by `herdr-app check`):
   - `axi-sdk-js` in `args.js`, `cli.js`, `commands.js` (only `AxiError` is needed outside the CLI wrapper).
   - `@toon-format/toon` in `render.js` (used only by TOON human/text rendering, unused by `quotaJsonReport`).
   - `proxy-from-env` and dynamic `import("undici")` in `lib/http.js` (Node-only proxy/IPv4 `Agent` dispatchers).
4. **`setTimeout` in 21 files** (rejected by `scripts/check.mjs` and unavailable in Mod runtime):
   - Used for per-request `AbortController` timeouts in `providers/*.js` and poll/backoff waits in `lib/fetch-lock.js`, `lib/process.js`, and `commands.js` (TUI live loop).
5. **Missing Web/Node globals in Herdr**:
   - `AbortController` (14 provider files), `TextDecoder` (11 provider files), and `process.env` / `"win32"` vs `"windows"` platform checks (46 files).
6. **`lib/http.js` response streaming**:
   - `readBoundedResponseBody` expects `response.headers.get("content-length")` and `response.body.getReader()`, which `ShellFetchResponse` does not have.
7. **Subprocess / local-TLS-socket sources**:
   - Under `--no-credential-refresh` (`refreshCredentials: false`, `allowKeychainPrompt: false`, no `allowClaudeInference`), delegated CLI token refresh, Claude native inference, Claude swap, and interactive keychain prompts are already disabled upstream.
   - Remaining non-file/non-fetch paths in upstream providers are external helper binaries (`sqlite3` for Cursor `state.vscdb` and OpenCode `opencode.db`, `bl` CLI for Alibaba, `higgsfield` CLI, non-interactive `security` / PowerShell `CredReadW` keychain reads) and `agy.js`'s local self-signed HTTPS language-server probe via `node:https` (`rejectUnauthorized: false`) + process-table inspection.

## 5. Minimal Adaptation to Import Core `quota-axi` Directly Inside `mods/quota-manager`

To satisfy "import core functions into `mods/quota-manager` and query directly in-process without `exec`, `spawn`, `query.mjs`, or CLI" while keeping `third_party/quota-axi` unmodified as the upstream snapshot:

1. **Build-time vendor bundle inside `mods/quota-manager/vendor/quota-axi/`**:
   - A repository build script (`scripts/build-vendor.mjs`) compiles `third_party/quota-axi` (`tsc`) and transforms only the core quota-query module graph (`fetchQuota` from `commands.ts`, `providerPresence`, `quotaJsonReport`, `advice`, `cache`, `interpretation`, `pace`, `types`, `lib/*`, and `providers/*`) into self-contained ES modules under `mods/quota-manager/vendor/quota-axi/`, omitting CLI/TUI/TOON/models-only files (`cli`, `args`, `models`, `model-kb`, `skill`, `tui*`, `system-theme`, `claude-native-quota`, `claude-swap`, `delegated-refresh`).
2. **Thin Herdr runtime shim (`mods/quota-manager/vendor/quota-axi/runtime.js`)**:
   - Uses only relative `./` imports plus Herdr/Node shared unprefixed built-ins (`"fs/promises"`, `"crypto"`, `"buffer"`, `"path"`, `"url"`, `"os"`).
   - **Async file preloading & persistence (`fs` shim)**: Before calling `fetchQuota([id], { allowKeychainPrompt: false, refreshCredentials: false }, force ? 0 : 90)` for one allowlisted provider `id`, asynchronously pre-reads that provider's candidate credential/config files under `home` and collector cache/Muse-gate files under `<appHome>/quota-manager-collector/` via `"fs/promises"` `readFile` into a per-call in-memory snapshot map so synchronous `readFileSync` / `existsSync` / `statSync` calls in upstream provider modules work unchanged; flushes dirty writes under `<appHome>/quota-manager-collector/` asynchronously via `"fs/promises"` `writeFile` afterward.
   - **Platform & environment shim (`os` / `process` shim)**: Maps Herdr `"windows"` -> `"win32"` and `"macos"` -> `"darwin"`, binds `homedir()` to the host-supplied `home`, and synthesizes standard home-derived path variables (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `QUOTA_AXI_CACHE_DIR`) without touching undefined `process.env`.
   - **HTTP shim (`lib/http.js` replacement)**: Calls global `fetch(url, { method, headers, body })`, wraps `ShellFetchResponse` with an empty case-insensitive `headers` lookup (`get: () => null`), and implements `readBoundedResponseBody` via `await response.text()` -> `Buffer.from(text, "utf8")` enforcing the upstream `262_144`-byte limit.
   - **Polyfills & timer-free transformation**: Supplies lightweight pure-JS `AbortController` and `Buffer`-backed `TextDecoder`, replaces `setTimeout`/`clearTimeout` with no-op timer handles (so zero `setTimeout` tokens appear in `mods/quota-manager/`), replaces `fetch-lock.js` file polling with in-process per-provider Promise serialization, and stubs `lib/process.js` (`findCommandPath` -> `undefined`, `execFileText` -> `ENOENT`) + `agy` local socket helpers so zero subprocesses are ever spawned on the local path (sources requiring external binaries/sockets cleanly report upstream `skipped` / unavailable state).
3. **Direct Mod call seam**:
   - `main.js` remains the sole module importing `"herdr"` (`home`, `appHome`, `exec`, `window`, etc.) and passes a local query callback into `QuotaStore` -> `command.js` `fetchQuota`.
   - When `on === null`, `fetchQuota` calls `queryLocalQuota(id, { force, home, appHome, platform })` directly in-process and feeds the returned schema 5/6 report into existing `parseReport` + `normalizeReport`.
   - When `on !== null`, `fetchQuota` keeps the remote `exec("quota-axi", ...)` path with `{ on: machine }` and never falls back to local `queryLocalQuota`.
