# Local quota repair execution plan

Status: implementation verified and committed; user subsequently authorized task archival.

## Ordered work

1. [x] Diagnose admission and machine routing; prove local acquisition feasibility for all three screenshot providers with redacted read-only probes.
2. [x] Write PRD/design/execution plan and curate implementation/check manifests.
3. [x] Obtain approval of the final planning summary, then activate this task.
4. [x] Dispatch a Trellis implementer owning `scripts/build-vendor.mjs`, generated vendor output, and local-query regression tests. Build direct daemon Antigravity and JSON Grok acquisition; implement the vendor side of the deadline seam. Preserve pinned upstream and zero-subprocess local behavior.
5. [x] Dispatch a separate implementer owning `main.js`, `store.js`, `command.js` and corresponding UI/store/command tests. Coordinate the exact deadline option before edits; preserve existing local injected-runner tests and remote argv. Fix explicit scope re-pin and blocked manual refresh routing. Workers share a worktree and must not revert one another.
6. [x] Demonstrate red/green for the source-shape and scope bugs with isolated baseline fixtures/checkouts. Native-shaped responses must have no response headers/body stream. Include malformed/missing quota, authentication/rate-limit/size errors, stale daemon candidates with a valid candidate beyond 16, concurrency/deadline/late-response protection, and zero local exec. Native Buffer and delayed-test synchronization guards also have observed red/green.
7. [x] Dispatch Trellis check for spec and generated-source consistency; address real findings. Run focused tests, then `just ci` and `npm run check:herdr` (114/114 final tests passed).
8. [x] Main session updates affected executable contract docs, runs `just install` with native check, and checks installed parity/status (84 files, zero differences). No hand copying of the product Mod into app home.
9. [x] Main session applies Local + three requested queries + Start using the Mod settings/host APIs; hidden Cursor Query off. No direct shared.json edit.
10. [x] Perform a real native local refresh, inspect fresh local caches and native numeric chips for Codex, Antigravity and Grok, and confirm local target/no remote cache. Record actual outcomes and remaining limits; preserve secret redaction.
11. [x] Finish with uncommitted changes and a concrete validation receipt; no commit, push or archive unless separately requested.

## Checks

```powershell
node --test tests/local-query.test.mjs tests/command.test.mjs tests/store.test.mjs tests/ui.test.mjs
just ci
npm run check:herdr
just install
herdr-app status
```

Inspect a native `herdr-app shot` frame after refresh; keep unrelated workspace imagery outside repository artifacts. Read back sanitized settings/cache summaries, never raw provider output, identities or tokens.

## Coordination and rollback

- Main session owns planning, contracts, integration, real configuration, and native acceptance.
- Agree on the per-query deadline callback signature before parallel implement edits. It must originate from the active async context, cover response body reading, cancel settled timer tasks, and ignore late transport completions.
- Protect the pre-existing task artifacts. Workers own only assigned files.
- Keep generated output in sync with templates, and preserve the pinned third-party source tree.
- Installer-native-check failure must leave the existing Mod in place. Use its owned backup if rollback is required; do not reset unrelated configuration/history or delete provider-owned daemon files.
- No additional display/DPI/platform matrices: validate the changed Windows local-query behavior and directly affected regressions.

## Commit and archive authorization

The user requested commit and archive after native acceptance. Work commit: `59cd333497b659985c51b7701c18b65ac7b9d7ed`. Task archival and session recording follow; no push was requested.
