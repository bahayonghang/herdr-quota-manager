# Local vendor implementation verification

Date: 2026-11-13. Owner: local collector implementer. No installation, real provider query, or configuration change was performed by this worker.

## Changed boundaries

- `scripts/build-vendor.mjs` adapts local Antigravity to fixed daemon-state discovery and loopback JSON quota, preserving the exported upstream summary normalizer.
- Local Grok consumer acquisition now reads the verified JSON billing allowance; current credential selection and safe auth/rate classifications remain upstream-owned. It accepts only finite numeric percentages and typed valid weekly/monthly periods, emits one aggregate allowance, and omits prepaid/product breakdown.
- A generated `lib/local-sources.js` shares captured-runtime JSON reads, complete-body response-size/deadline checks, and native-compatible bounded daemon discovery. It uses async `readdir/readFile`, not stat/process inspection. Every URL is fixed first-party or literal `127.0.0.1` plus a validated port.
- Runtime/index forward the agreed optional `deadline(promise, milliseconds)` function. Main's active async-context implementation is owned by the other worker.
- Generated-only output was not hand edited; the generator was rebuilt successfully after its changes. Pinned third-party source remains unchanged.
- Newly unused Grok binary transport constants and private framing/reader chain were removed in the generator. Exported protobuf normalization helpers remain available.

## Observed red/green

Two new integration fixtures were first run against a copied isolated unfixed Mod (temporary directory, new test file copied alongside it): **0 passed, 2 failed, exit 1**. Antigravity returned unavailable instead of fresh for a valid daemon beyond sixteen stale states; Grok returned error instead of fresh for a native text-only JSON response. The shared worktree was not reverted/stashed. The temporary checkout was removed after reading output.

After regeneration the same tests both passed. Additional guards were then added in `tests/local-sources.test.mjs` for malformed daemon metadata and limits, absent daemon semantics, token rotation, four active workers, per-request and overall deadline behavior, late completion across runtime contexts, percent boundaries/monthly periods/missing allowance, safe HTTP failures, and body-size enforcement.

Latest targeted run:

```text
node --test tests/local-sources.test.mjs tests/local-query.test.mjs
18 tests passed, 0 failed
```

The tests inject only synthetic credentials, temp homes, fake responses and deterministic test timers. The primary positive tests verify the same synthetic token is present in the request before asserting that it is absent from returned/cached output; they do not merely search for an unrelated absent string.

Other completed checks:

- `npm run build:vendor`: pass (after generator changes, including unused transport cleanup).
- `npm run check`: pass, 100 JavaScript modules at the time of execution.
- `npm run check:herdr`: pass, initial native render only.

## Limits requiring main-session acceptance

- No runtime/capability failure is proven solved by initial render. Main must run real local Codex, Antigravity, and Grok queries in the installed native app and inspect caches/digits.
- Herdr cannot cancel a native fetch. Four workers bound concurrent awaited attempts, while transport timeouts stop waiting and late responses are ignored. Underlying timed-out requests can still settle later; no cancellation is claimed.
- Directory/text size checks reject after complete host reads because the host lacks stat/streaming APIs. They are not preallocation bounds.
- Candidate enumeration rejects more than 256 matching state filenames explicitly. It does not delete or silently truncate provider-owned stale state.
- Real deadline injection is supplied by production `main.js`; direct Node fixtures may inject their own callback. Existing vendor timer stubs for unrelated provider paths were not broadly rewritten.

## Native follow-up: shared text VFS correction

Main-session native acceptance found Antigravity working, while Codex/Grok were auth-required despite successful Node preflights. Native probes disproved the first missing-method hypothesis: isBuffer, byteLength, and digest.readUInt32BE existed and hashing worked. The discriminating synthetic result was instead that `Buffer.from(Uint8Array([123,125]))` had length zero, and Buffer decoding returned empty strings even when string-created buffers had the correct indexed bytes. Direct host `readFile(file, 'utf8')` decoded both auth files correctly.

The owning generator now preloads its allowlisted text files through host UTF8 decoding and retains exact text in VFS entries. Text reads/read-after-write and host cache flush use that text. Sizes use real Uint8Array bytes constructed from the supported string-to-Buffer path; fingerprints hash the exact text's UTF8 representation. This preserves Node fingerprint semantics and avoids changing crypto APIs that were not broken. Codex and new Grok JWT payload decoding use standard atob plus built-in URI UTF8 decoding, avoiding native Buffer decoding without adding a general Buffer/UTF8 polyfill.

`tests/runtime-text.test.mjs` copies the runtime to an isolated fixture and simulates the **observed** native Buffer behavior (string construction retains bytes, typed-array construction is empty, toString is empty). The unfixed isolated fixture failed: empty credential text versus the expected Unicode JSON. The corrected runtime passed exact Unicode credential reads, size/hash equality, cache read-after-write, host persistence/reload and Unicode JWT payload decoding.

Latest targeted result after correction: `node --test tests/runtime-text.test.mjs tests/local-sources.test.mjs tests/local-query.test.mjs` — **20 passed, 0 failed** (including an additional discovery-limit semantics guard added by review). Main-session real native acceptance must be rerun with this correction; this worker did not run live queries or change installed configuration.
