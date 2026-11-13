# Research: refresh admission, local provider capability, and test coverage

> Pre-fix source trace. The later generator/runtime repair supersedes these source defects; see native-acceptance-20261113.md for the final verified behavior.

- Query: Why can refresh leave Codex, Antigravity, and Grok chips at `—`; what additional local vendor limitations remain after admission is enabled?
- Scope: internal source analysis and isolated synthetic Node probes; no real credentials, app state, or network queried by this researcher.
- Date: 2026-11-13

## Findings

### 1. A refresh is a forced poll, not permission to collect

The visible refresh callback is wired: `ui.js:207` passes `onRefresh` to `flatButton`, whose click handler calls the action (`ui.js:180`). The bar action invokes `poll(cx, true)` (`main.js:128`); `poll` captures the current machine and starts `store.refresh` (`main.js:43-47`). `QuotaStore.refresh` builds its provider list using `selectedProviders` (`store.js:18`); `selectedProviders` returns an empty array unless `consent` is true, then includes only Query-enabled providers (`config.js:48-49`). `force` bypasses ordinary interval/backoff, not consent, Query selection, leases, the five-second cooldown, or Retry-After (`store.js:28-34`).

Display is separate: `main.js:102` uses Show to choose chips, and `stripFace` returns the `paused` key when consent or the provider's Query is off (`ui.js:100-110`). With no cached lane, it renders `—`. Thus visible chips do not imply enabled collection, and a clickable refresh can correctly perform zero collector calls. The popup can identify paused state (`ui.js:51-55`), whereas the compact strip puts its status in a tooltip (`ui.js:186-190`).

Main-session current runtime inspection found `consent:false`; Codex/agy/Grok Query off and Show on; no cache/lease entries; scope current and a connected remote active space. Those runtime facts are owned by the main session's receipt, not independently measured here. They exactly fit this source path. Once enabled under current scope, collection targets the remote machine: `machineFor` selects the active space (`config.js:51-53`), and `command.js:22-55` uses remote `exec` with no fallback. The following local findings therefore do **not** explain the current screenshot and do not predict remote success.

### 2. Local Antigravity is capability-disabled, regardless of real installation

The vendor Antigravity adapter tries the CLI first, then process-discovered loopback endpoints (`providers/agy.js:45-76`). The adaptation disables both paths:

- `vendor/quota-axi/lib/process.js:2-6`: `findCommandPath` always resolves undefined, `execFileText` throws ENOENT, and process-list args are empty.
- `providers/agy.js:169-184`: undefined command path is treated as missing CLI.
- `providers/agy.js:444-451`: Windows process discovery is unavailable; other platforms require the disabled subprocess implementation.
- `vendor/quota-axi/runtime.js:490-491`: HTTP/HTTPS request functions are refusal stubs, so endpoint requests are also unavailable.
- `scripts/build-vendor.mjs:948-952` and `:672-673` generate these stubs. Editing only generated files would be overwritten by installation/build.

Discriminating synthetic Windows probe: call `queryLocalQuota('agy', {force:true, home:'', appHome:'', platform:'windows', fetchImpl: throw-if-called})`, then normalize. It returned `status:'unavailable'`, zero windows, `notSetUp:true`, and zero fetch calls. No real filesystem credential paths or app home were supplied; no app files were written. This proves that enabling local Query cannot produce a fresh Antigravity number through the default adapter in this bundle. It does not establish anything about the actual app's sign-in or remote CLI.

### 3. Local Grok consumer protobuf path cannot consume Herdr's response shape

`providers/grok.js:677-715` fetches consumer quota using gRPC-web/protobuf, then calls its private `readBoundedBody`. That reader returns an empty Uint8Array if `response.body` is missing (`:722-730`), and `decodeGrpcWebPayload` rejects empty bytes (`:757-759`). The adapted `lib/http.js:45-62` supplies text/json helpers but forwards `body:response.body`; it does not provide a binary stream. Herdr's documented/previously probed `ShellFetchResponse` offers `text()` and `json()`, without a `body` stream (previous vendor task `research/mod-runtime.md`, section 2). The main session also checked the current installed Herdr 0.1.15 `gpui-kit.d.ts:22184-22190`, which still declares only status/ok/url/text/json on the response. The shared text-based `readBoundedResponseBody` adaptation does not help because Grok uses its own reader.

**Synthetic positive/negative check, executed with Node v26.7.0:**

```js
import assert from 'node:assert/strict';
import {queryLocalQuota} from './mods/quota-manager/vendor/quota-axi/index.js';
import {normalizeReport,parseReport} from './mods/quota-manager/model.js';
// Minimal protobuf: response field 1 => config field 1, float32 25 percent used.
const bytes=Uint8Array.from([0x0a,0x05,0x0d,0x00,0x00,0xc8,0x41]);
for(const shape of ['stream','shell']) {
  const fetchImpl=async url=>{
    const res={status:200,ok:true,url:String(url),text:async()=>Buffer.from(bytes).toString('utf8')};
    if(shape==='stream')res.body=new ReadableStream({start(c){c.enqueue(bytes);c.close();}});
    return res;
  };
  const raw=await queryLocalQuota('grok',{
    force:true,home:'',appHome:'',platform:'windows',
    env:{GROK_AUTH:'synthetic-test-credential'},fetchImpl,
  });
  const lane=normalizeReport(parseReport(raw),'grok',Date.now())[0];
  assert.equal(lane.status,shape==='stream'?'fresh':'error');
  assert.equal(lane.windows.length,shape==='stream'?1:0);
}
```

Observed stream shape: fresh, one window, 75% remaining, one fetch. Same synthetic bytes/status with Shell response shape: error, zero windows, one fetch. This proves a local adapter contract mismatch without depending on real sign-in or endpoint availability. It is not evidence that the real Grok endpoint currently grants quota. A repair needs a verified **binary-preserving** host response mechanism; converting arbitrary protobuf through UTF-8 text is not safe. Do not promise a one-line text fallback.

### 4. Existing checks cover safe boundaries, not all provider/native combinations

Executed `node --test tests/local-query.test.mjs tests/command.test.mjs`: **15 passed, zero failures**. Relevant coverage:

- `tests/local-query.test.mjs:24-70`: missing isolated Codex home and a snapshot fixture.
- `tests/local-query.test.mjs:72-118`: mocked Codex JSON HTTPS response and cache/force behavior.
- `tests/local-query.test.mjs:120-143`: oversized Codex response handling.
- `tests/local-query.test.mjs:145-185`: mocked Muse JSON response and ledger.
- `tests/command.test.mjs:9-76`: local runner injection, provider allowlist, schema and error mappings.
- `tests/command.test.mjs:79-138`: mocked remote launcher/structured exit/error behavior.

There is no local Grok gRPC response-shape fixture or local agy capability assertion in these tests. Store tests already encode zero calls without consent and disabled Query (`tests/store.test.mjs:7-18`). UI tests use isolated homes/mock host modules (`tests/ui.test.mjs:30-31`, `tests/mock-host.mjs`); `scripts/check-herdr.mjs:5` explicitly says initial-render checking does not validate later async states or live accounts. Passing these checks never established that every displayed provider could collect a real quota.

### Additional limitation, outside the current symptom

`runtimeSetTimeout` and `runtimeClearTimeout` are no-ops (`runtime.js:464-465`, generated by `scripts/build-vendor.mjs:646-647`). `providerFetch` drops the signal when building host fetch options (`lib/http.js:39-44`). The local runtime context also serializes provider calls through a global mutex (`runtime.js:231-264`). Therefore provider timeout constants do not themselves bound a pending host fetch, and a never-settling call can hold the queue. No pending-query evidence was found by the main session, so this is a source-level risk, not a diagnosis of today's screenshot.

## Files found

- `mods/quota-manager/main.js`, `config.js`, `store.js`, `ui.js`, `model.js`: refresh routing, admission, display separation, normalized headline selection.
- `mods/quota-manager/vendor/quota-axi/providers/{codex,agy,grok}.js`: local provider-specific discovery and network paths.
- `mods/quota-manager/vendor/quota-axi/runtime.js`, `lib/{http,process}.js`: adapted host capability boundary.
- `scripts/build-vendor.mjs`: owning templates for generated runtime and HTTP/process modules.
- `tests/local-query.test.mjs`, `command.test.mjs`, `store.test.mjs`, `ui.test.mjs`: existing test scope.

## Related specs and references

- `.trellis/spec/mod/runtime-boundary.md`, `.trellis/spec/mod/data-contracts.md`: consent/query and local/remote contracts.
- `.trellis/spec/tooling/verification.md`: distinguish synthetic/unit checks from native acceptance.
- `docs/ARCHITECTURE.md`, `SECURITY.md`: collection and credential restrictions.
- `.trellis/tasks/archive/2026-11/11-13-vendor-quota-axi/research/mod-runtime.md`: prior installed-host response capability evidence; current native reproduction remains main-session responsibility.
- No external web references were needed; all claims concern the pinned local source and synthetic runtime shapes.

## Caveats / Not Found

- Primary screenshot cause is admission state in a remote-following configuration, as measured by the main session. The agy/Grok findings apply only to local bundled collection.
- The isolated Windows agy assertion passed. An exploratory Linux assertion expecting the same unavailable classification failed because Linux produced `error`; do not generalize the exact status classification across platforms. No source changes were made in response.
- No real credentials, live endpoint, remote CLI availability, or signed-in account was tested. This research cannot promise that toggling collection will produce numbers.
- Only this research file was written by the researcher; no product code, tests, specs, or installed configuration were changed.
