# Research: direct local Antigravity quota feasibility

- Query: Can this Windows machine collect Antigravity quota inside the Mod, without a subprocess or local CLI, and what minimum source adaptation is required?
- Scope: pinned source, current installed Herdr declarations, redacted local metadata/listener inspection, and subsequently authorized bounded local quota reads.
- Date: 2026-11-13

## Findings

### A working direct local source exists

Windows `agy.exe` and Antigravity are installed and running. Passive inspection found daemon state under `~/.gemini/antigravity/daemon/hub_<httpPort>.json`. The state JSON has these keys only: `pid`, `httpsPort`, `httpPort`, `lsVersion`, `csrfToken`. There were 89 well-shaped files during the probe; most are stale. One state file matched a listening HTTP port owned by its recorded live process and bound specifically to `127.0.0.1`.

No token, state file contents, raw account response, private process command line, or actual port number is recorded here. Windows process inspection was used only to establish research evidence; it is not part of the proposed Mod implementation.

After the parent explicitly authorized bounded local quota feasibility reads, the exact pinned upstream quota path worked directly:

```text
POST http://127.0.0.1:<httpPort>/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary
accept: application/json
content-type: application/json
connect-protocol-version: 1
x-codeium-csrf-token: <the same daemon state's csrfToken, held only in memory>

{"request":{},"forceRefresh":false}
```

The first candidate selected by Node's file mtime returned HTTP 200 with JSON. Existing `normalizeAgyQuotaSummary` produced four valid windows, all with reset timestamps: Gemini 5h 80% remaining, Gemini weekly 90%, Claude/GPT 5h 100%, and Claude/GPT weekly 99%. These are observed transient values, not fixture expectations or claims about future allowance.

No login, OAuth refresh, inference, cookie import, CLI execution, or settings write occurred. HTTPS/self-signed certificate bypass is unnecessary because the working daemon exposes a loopback HTTP port.

### Native-feasible discovery must not depend on stat or filename recency

Current `gpui-kit.d.ts:22137-22152` exposes `fs/promises.readdir` and `readFile`, but no stat or process-table API. Native discovery therefore cannot reuse the first probe's Node mtime ranking.

The filename suffix is the **HTTP port**, not a timestamp or PID: all 89 names matched their state `httpPort`. The newest state by mtime ranked 87th by descending numeric filename. Choosing only the first few lexicographic/numeric names is unsound.

A second live probe deliberately used only native-compatible filesystem operations (`readdir`, `readFile`), sorted names for deterministic traversal, validated each JSON state, and queried up to four candidates concurrently. It needed no stat, process list, or CLI:

```text
filename-sort-without-stat
candidateCount: 89
requests started before success: 27
HTTP responses: 1
result: HTTP 200, 4 normalized windows
elapsed: 62 ms (Node transport; native performance remains unverified)
```

All probes used a one-second AbortSignal timeout in Node and an overall bounded candidate set. This is evidence of workable endpoint discovery and quota protocol on this machine; it does not prove that Herdr's fetch timeout/cancellation behavior matches Node.

### Minimal production discovery and transport design

1. For local `agy` only, enumerate the fixed daemon directory under host `home()`, filter `hub_\\d+\\.json`, and read bounded JSON files using native async FS. Support only the observed fixed path initially; do not add arbitrary endpoint settings or scan unrelated filesystem roots.
2. Validate filename suffix equals `httpPort`; require integer port `1..65535`, positive integer PID metadata, nonempty bounded string CSRF token, and bounded file text (the probe used 16 KiB and token length <=4096). Always construct the origin as literal `http://127.0.0.1:<validated-port>`. Never trust a hostname/URL from file contents.
3. Enumerate all valid candidates within an explicit safe bound (e.g. 128 or 256), rather than taking the first 16 and pretending the provider is absent. The observed set of 89 fits either bound. If the bound is exceeded, surface a distinct safe unavailable/discovery-limit outcome, or apply another verified selection rule; do not silently report no installation.
4. Probe the pinned read-only quota path with bounded concurrency (four worked in research). Capture fetch and the CSRF token per request in local variables. Stop scheduling after the first valid normalized response. Ignore late candidates after success/deadline. Failed/stale state files do not prove Antigravity is uninstalled.
5. Remember the last successful **port/file identity** in memory and try it first on the next poll, but re-read the state file and never persist the token. This is an optimization only; full bounded discovery remains the correctness path if the daemon restarts.
6. Enforce a real per-request and overall deadline via a supported host timer supplied by `main.js`/the active async context. Existing `runtimeSetTimeout` is a no-op and cannot supply a bound. Herdr's fetch has no AbortSignal; a promise timeout can stop admission/result publication but cannot claim to cancel the underlying network request. Preserve the revision/lease guard and capture request state so a late result cannot publish against a subsequent runtime context.
7. Feed the response into existing `normalizeAgyQuotaSummary`, then the vendor's `successProvider`/semantics and schema-5/6 report path. Do not manufacture percentages from status labels or serve a static fixture. If an account/plan label is desired, upstream optionally reads `GetUserStatus`, but it is not needed for quota windows and was not queried in this research.

The timeout/deadline adaptation is necessary for a reliable bounded stale-file search; the Node measurement alone is not a justification to leave native requests unbounded.

### Source ownership and adaptation seam

- `providers/agy.js:244` exports `normalizeAgyQuotaSummary`; `:265` exports `normalizeAgyUserStatus`. Reuse these parsers.
- `:346` hardcodes process-based discovery; the present `fetchQuotaWithRuntime` interface does not accept a ready-made endpoint list. Simply replacing `requestJson` is insufficient because discovery returns no Windows endpoints first.
- `:402` applies the quota path and fallback normalization; `:806` owns the exact request body. `:986` supplies the default CLI/process/HTTP runtime.
- The generated `agyAdapter.fetchQuota` can use a small local-daemon discovery/JSON transport adaptation while preserving the upstream normalization functions. An alternative is an explicit endpoint-discovery injection seam in the generated module plus an adapted default runtime. Either approach must bypass Windows process-list discovery and avoid calling the disabled CLI path.
- `vendor/quota-axi/runtime.js:231` establishes the per-query context; it is a suitable place to capture already-bounded async FS inputs or expose a local daemon discovery helper. Its current `candidateFiles` at `:114` does not preload agy state; copying Node `stat` logic there would fail natively.
- The owning generator is `scripts/build-vendor.mjs`: `transformDistModule` at `:111`, `runtimeModuleSource` at `:183`, runtime FS import at `:184`, and module emission at `:938`. Change the generator and regenerate the vendor modules together. Do not edit generated `agy.js` alone.
- Preserve the remote `quota-axi` path unchanged; this daemon source is explicitly local.

## Required regression and native checks

- Synthetic daemon files: valid schema, malformed JSON, filename/port mismatch, port range, absent/oversized token, absent directory, stale endpoints followed by a valid candidate, >16 candidates with the valid candidate late, discovery limit, bounded concurrency, and deadline handling.
- Assert local agy makes zero `exec`/CLI calls and only requests literal loopback with the pinned quota path and `forceRefresh:false`.
- Assert CSRF and raw response text never reach normalized state, stored errors, cache, history, or diagnostics.
- Feed the synthetic quota summary through the existing vendor report and model normalization; verify the real bar can show the resulting numeric windows.
- After implementation approval, verify `fs/promises.readdir/readFile` plus native global fetch can reach this daemon in the running Mod. The current live proof uses Node fetch, not Herdr fetch.
- Run an actual native local refresh and inspect fresh cache/visible quota. Do not count `herdr-app check` as this acceptance.

## Other passive sources found

`~/.gemini/antigravity-cli/antigravity-oauth-token` exists and contains JSON keys `token`, `auth_method`, and `id_token`; nested token keys are `access_token`, `token_type`, `refresh_token`, and `expiry`. Values were not printed or recorded. No OAuth request was made because the daemon path already yielded quota without login/refresh or a new first-party endpoint adaptation.

Presence lock files inspected were opaque and did not expose named port/CSRF metadata. They are not needed for the working daemon design.

## Related specs and references

- `.trellis/spec/mod/runtime-boundary.md`: direct local runtime, host calls in main, no local CLI/subprocess.
- `.trellis/spec/mod/data-contracts.md`: selection/consent, captured host, normalized reports and safe persistence.
- `docs/ARCHITECTURE.md`, `SECURITY.md`: credential/query boundaries.
- Pinned `third_party/quota-axi/src/providers/agy.ts:1054-1143` and generated `providers/agy.js`: loopback endpoint protocol and normalizers.
- Installed Herdr `gpui-kit.d.ts:22137-22202`: async FS and fetch capabilities. No external web lookup was needed for the exact installed protocol and source.

## Caveats / Not Found

- Native fetch transport, deadline implementation, generated build, and bar rendering still require implementation/native acceptance.
- Daemon state location/schema is discovered from the installed Antigravity version rather than a stable public API; fail safely when absent or changed.
- The 89 stale files were left untouched. Research must not delete application-owned daemon state.
- No claim is made that Antigravity is absent or logged out when candidate discovery fails.
- Only this research artifact was written by this agent. No product code, installed preferences, or credential files were changed.
