# Check review: local quota repair

Date: 2026-11-13. Role: Trellis check sub-agent. Scope: current generator/generated bundle, local transport acquisition, host deadline seam, explicit scope retargeting, refresh guidance, tests and contracts. Native installation/configuration/live reads remain owned by the main session.

## Findings fixed

### Clarify logical workers versus uncancelled native requests

- Files: `tests/local-sources.test.mjs` only; no product/generator changes.
- Four awaited discovery workers do not imply four unfinished native fetches. Per-request waiting deadlines permit workers to try later candidates while earlier fetches remain unresolved; Herdr exposes no cancellation.
- A discriminating synthetic probe with 12 never-settling requests observed 12 started/unsettled fetches, not four. Existing tests deliberately require reaching a valid candidate after hanging ones, so imposing a new four-socket cap would change approved discovery behavior.
- Main session explicitly chose to preserve that behavior and document the real bounds: at most 256 distinct candidate origins per cold discovery, four awaited workers, one-second per-request waiting deadline, ten-second discovery waiting deadline. These are not network cancellation guarantees or a guaranteed approximate 40-request cap.
- Renamed the settled-request worker test to state its actual scope. Added a deterministic 256-candidate regression proving each origin starts once, unfinished native requests can exceed four, and late responses admit no new work. The existing 257-state regression proves overflow refuses without requests.

## Review conclusions

- Local paths invoke the in-process collector; the new acquisitions add no CLI, process-table, shell, arbitrary endpoint or TLS-bypass path.
- Antigravity source reads only filtered fixed-path daemon metadata, checks file/port/PID/token constraints, constructs literal loopback URLs, re-reads remembered credentials, and does not persist CSRF.
- Grok reads one aggregate allowance from the verified fixed JSON route, rejects malformed/missing numeric allowance and invalid period metadata, preserves auth/rate/error classifications, and omits prepaid/product aggregation rather than inventing percentages.
- The deadline seam originates in the active spawned context, covers new transport body reading, cancels timer tasks on settlement, and is excluded from remote execution. Captured transport state and stopped-discovery checks prevent old completions from using a newer global runtime context or publishing into its cache.
- Explicit scope changes re-pin the popup while ordinary active-space changes preserve the pin. Forced admission failure opens settings without enabling consent or Query. All existing manual routes reach this guard.
- Template rebuilding reproduced the tracked bundle exactly. The pinned third-party source was not changed.
- No additional blocking source defect was found in the requested three-provider repair.

## Findings not fixed / limits

- Native transport requests are not cancelled when waiting deadlines expire. This is a verified host capability limitation accepted by the main session, not a claim of four live sockets. The candidate bound above is the actual finite cold-discovery request ceiling.
- The sibling scan still finds direct `response.body.getReader()` sites in Claude, Command Code, Devin, ElevenLabs, Kimi, OpenCode Go and Z.AI. Those providers are outside this three-provider repair and were not runtime-verified; no claim that all catalog providers now support native collection is made. Their presence alone was not promoted to a proven identical bug without tracing each full path.
- Native installation, configuration read-back, actual local caches, visible digits, and any host-specific failures are not established by this reviewer. Main session performs that acceptance separately.
- No standalone Mod-JavaScript lint/type-check command exists in package.json. The configured `npm run check` is the syntax/JSON/forbidden-API gate; vendor regeneration runs the pinned TypeScript build.

## Verification

- Generator parity: `buildVendor()` completed; 76 emitted files; SHA-256 fingerprints before/after identical, zero drift.
- `just ci`: passed; 100 JavaScript modules; 111/111 tests, zero failures/skips/cancellations; coverage run and installer dry-run passed. This run preceded the reviewer's one added regression.
- After the test-only adjustment: `node --test tests/local-sources.test.mjs` passed 13/13; `git diff --check` passed. The full final suite should contain 112 cases. The reviewer did not rerun full tests during main-session installation because that rebuilds the shared bundle directory.
- Existing implementer receipts record observed baseline red/fixed green tests for the source/shape and host/UI defects. This review did not reinterpret initial render or mocked reports as live native acceptance.
- No real provider call, installed configuration change, native installation, commit, push, or task archival was performed by this reviewer.

## Focused follow-up: native Buffer text-path repair

Main-session native acceptance subsequently established a real Buffer incompatibility: Buffer construction from host Uint8Array produced no bytes, and Buffer decoding returned empty strings. This made existing credential JSON invalid even though native UTF8 string reads worked. See `native-buffer-findings.md`; those native observations belong to the main session, not this reviewer.

Reviewed the subsequent generator/runtime delta and selected Codex/Grok JWT adaptation without rebuilding or running a live query:

- VFS preloads allowlisted text files using host UTF8 string reads, retains that exact text, and returns it for UTF8 reads. Text writes preserve text for read-after-write and host string persistence; empty strings correctly use nullish rather than truthy fallback.
- Byte sizes are taken from actual Uint8Array views of the supported string-created Buffer. Fingerprints hash the exact text's UTF8 representation, retaining Node-equivalent size/hash semantics rather than hashing empty broken decoded buffers.
- The two selected JWT callers normalize base64url/padding and use the verified standard atob/URI UTF8 decoder. Malformed decoding remains a safe missing/invalid credential outcome. No broad Buffer replacement was introduced.
- `tests/runtime-text.test.mjs` simulates the observed native behavior, not ordinary Node Buffer behavior, and covers exact Unicode credentials, byte sizes and hash equality, cache read-after-write/flush/reload, and Unicode JWT decoding. The implementer receipt records the observed baseline red run.
- Independent focused run: `node --test tests/runtime-text.test.mjs` **1 passed, 0 failed**. `git diff --check` passed. No additional reviewer edits or blocking findings were needed. Main session runs final CI and native reinstall/real quota acceptance.
- General non-UTF8/binary Buffer semantics remain outside this targeted text/selected-JWT correction; no claim that every upstream runtime API has become Node-compatible is made.
