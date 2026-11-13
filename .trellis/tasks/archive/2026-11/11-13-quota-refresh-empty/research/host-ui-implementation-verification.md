# Host, scope and refresh implementation verification

Date: 2026-11-13. Implementer owns main/store/command and their regression tests; collector implementation and native configuration are owned by the other worker/main session.

## Changes

- `main.js`: explicit settings scope selection updates the popup's in-memory pin before saving the preference. Local becomes null immediately; Current snapshots the active machine; unrelated space changes keep that pin.
- `main.js`: the existing poll entry point checks forced admission. Consent off or an empty requested selection opens settings without starting collection or turning Query/consent on. Existing bar, usage, card, R-key and command paths all use it; automatic poll remains unchanged.
- `main.js`: local polls create the agreed `deadline(promise, milliseconds)` callback in the active spawned AsyncContext, using a host one-shot timer and cancelling it on success, failure or timeout. The callback bounds waiting, not underlying fetch cancellation.
- `store.js` / `command.js`: thread the optional deadline to the local runner only. Without a deadline, existing injected local-runner option objects retain their original shape. Remote exec receives only its captured host and fixed timeout.
- `tests/mock-host.mjs`: optional deterministic command callback for an actual nextCommand refresh regression; default behavior remains pending.

## Meaningful red/green

Ran the final eight new regression cases in a temporary isolated fixture with current tests and HEAD versions of main.js/store.js/command.js. The shared checkout was never reverted or stashed.

Command selection:

```text
node --test --test-name-pattern "explicit Local|explicit Current|blocked manual|blocked refresh command|empty or disabled|active poll deadlines|local query forwards|refresh threads" tests/command.test.mjs tests/store.test.mjs tests/ui.test.mjs
```

Baseline result: **8 tests, 0 passed, 8 failed, exit 1**. Failures demonstrate retained remote scope, absent settings routing and absent deadline forwarding rather than an import/syntax failure.

Fixed full focused suite:

```text
node --test tests/command.test.mjs tests/store.test.mjs tests/ui.test.mjs
```

Result after the first collector regeneration: **59 tests, 59 passed, 0 failed**. The blocked-refresh test includes a positive authorized refresh; deadline tests cover success/failure timer cancellation, timeout rejection, late settlement, and use of the spawned task's timer rather than a stale caller/event context.

## Other checks

- `npm run check`: passed, 100 JavaScript modules.
- `git diff --check` for owned sources/tests: passed.
- An earlier concurrent static check raced the other worker's bundle directory regeneration and saw a temporarily missing types.js. The check was rerun after files stabilized and passed; this was not recorded as a product syntax defect.
- Sibling source scan: all existing forced refresh entry points call poll; the scope choice uses setScope; refreshOne is called only from the store worker loop. No duplicate bypass route was found.

## Limits

No live provider request, installation or real settings change was performed by this worker. Main session still owns just ci, native checks, official installation, configuration application and visible local quota acceptance.

## Follow-up: deterministic refresh settlement

The later full coverage run found an existing test-harness race: `settle` returned after 50 `setImmediate` turns even if the actual `store.refresh` promise remained pending. The failure was the Start test asserting a cache before async temporary-file reads and the serialized local query had completed; it was not evidence of a product refresh failure.

Replaced turn-count polling with a test-only wrapper installed immediately after init in both UI harnesses. It tracks actual store.refresh promises in a per-Mod WeakMap and awaits their settlement; the infinite nextCommand task is deliberately not awaited. No product file changed in this follow-up.

A controlled deferred collector proves the fix independently of filesystem speed: while its gate remains closed, settlement must remain pending even after more turns than the former budget; after release it must complete and publish all selected provider caches. An isolated copy using the old settle helper failed that exact assertion (`actual:true`, `expected:false`, 1 failed). The fixed UI suite passed 29/29; the full coverage suite passed **114/114, zero failures**.
