# Regression analysis and sibling sweep

Date: 2026-11-13.

## 1. Root cause category

- Cross-layer contract: Node's binary response stream is not Herdr's text/json response contract; the old local Grok path could import/render while never obtaining bytes.
- Test gap: initial-render, snapshot and absent-home cases could pass with agy process/HTTP refusal stubs and without any real-account quota acceptance.
- Implicit assumption: Show was mistaken for enabled collection; forced refresh preserves consent/Query gates. A popup's captured remote machine also overrode a newly selected local policy.

## 2. Why earlier checks were insufficient

The previous vendor task deliberately excluded live collection and preserved consent false. Its engineering checks established syntax, installation and initial rendering. They did not establish working local quota for every catalog provider. Treating that narrower task completion as live feature acceptance left the user's visible outcome unverified.

## 3. Prevention

| Priority | Mechanism | Evidence |
| --- | --- | --- |
| P0 | Native-shaped JSON/FS fixtures and real local source probes | local-source tests plus separate real Herdr acceptance receipt |
| P0 | Actual scope-control and refresh handler tests | eight new host/UI baseline regressions observed failing before green |
| P0 | Context-safe body/discovery deadlines and late-response tests | local-source deadline and late-context regression cases |
| P1 | Explicit runtime/signature/error contracts | mod runtime/data/UI specs updated |
| P1 | Separate mock, initial-render, installed-native and live-account evidence | validation and task receipts distinguish coverage |

## 4. Sibling sweep

- All forced refresh entry points in main.js call the guarded poll path: command, R key, status strip, usage refresh and provider refresh. No parallel manual bypass was found.
- The sole scope choice now uses setScope; ordinary popup pinning remains explicit and tested.
- Source scan of generated providers found additional direct stream readers in Claude, Command Code, Devin, ElevenLabs, Kimi, OpenCode Go and Z.AI. These are source-level native-contract risks outside the three requested providers; their live paths were not accepted by this task and remain unverified. Grok's former quota-body reader was removed. Optional body cancellation in Grok model-auth, Muse and MiniMax is cleanup only, not a data requirement. The generator's generic HTTP shim retains an optional stream fallback but its primary native path reads text; it is not the old Grok bypass.
- Four discovery workers limit awaited attempts, not uncancellable native sockets. A per-request deadline can permit later candidates while an older native fetch remains pending. The fixed candidate set (at most 256, each once) and overall waiting deadline bound discovery; tests/receipts must state the distinction instead of claiming four underlying requests.
- The vendor's remaining subprocess-requiring provider paths and no-op upstream timeout shims were not broadened into an unrequested rewrite. The new daemon/JSON transports use the injected real deadline, and the selected Codex path was separately validated. Other catalog providers remain subject to their existing capability limits.

## 5. Knowledge capture

Concrete local transport, deadline, target, and admission contracts are recorded in `.trellis/spec/mod/runtime-boundary.md`, `data-contracts.md`, and `ui.md`. The original read-only diagnosis remains historical evidence; current approved artifacts and native receipt determine completion.
