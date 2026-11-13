# Local quota repair design

## Outcome and evidence

Repair this machine's Codex, Antigravity, and Grok collection and apply local settings. Read-only feasibility probes returned current valid quota for all three; see `research/local-repair-preflight.md`, `agy-local-feasibility.md`, and `grok-local-feasibility.md`. These probes used Node transport and are not native acceptance.

## Boundaries

- Keep the pinned `third_party/quota-axi` snapshot and zero local subprocess/CLI architecture.
- The owning adaptation remains `scripts/build-vendor.mjs`; regenerate tracked vendor output together.
- Keep report schema 5/6, normalization, revision guards, leases, Query/Show independence, and remote routing.
- No login, credential refresh, inference, browser-cookie import, new shell settings, or unrelated UI/layout changes.

## Local provider acquisition

### Codex

Retain the current in-process JSON collector and local OAuth discovery. It already returned a fresh trusted 99%-remaining weekly window using a native-shaped response in preflight. Validate it again inside real Herdr after installation.

### Antigravity

Read only the fixed `home/.gemini/antigravity/daemon` directory using host async `readdir/readFile`. Accept bounded `hub_<port>.json` entries with matching integer HTTP port, bounded nonempty CSRF token, and valid metadata. The native host has no stat: filename numbers are ports and must not be treated as recency.

Use a bounded discovery set large enough for the observed 89 states (256 maximum, explicit safe unavailable on overflow), four logical workers, and stop scheduling after the first valid quota response or overall deadline. A per-request timeout may let a worker try a later candidate while an older native fetch remains unsettled; the fixed candidate count bounds total attempts, and four workers do not imply four native sockets. Try the last successful file identity first on subsequent polls, rereading its token. Retain that identity only in memory. Do not clean up Antigravity-owned files.

Construct only `http://127.0.0.1:<validated-port>` and POST the pinned `RetrieveUserQuotaSummary` path with the existing CSRF header and `{request:{}, forceRefresh:false}`. Reuse `normalizeAgyQuotaSummary`; no identity lookup is needed for numeric windows. Missing/stale daemon state means unavailable, not proof that the app is uninstalled or logged out.

### Grok

Replace the local consumer quota transport with the official Grok Build JSON billing route verified for the current signed-in credential: fixed `https://cli-chat-proxy.grok.com/v1/billing?format=credits`, bearer and official token-auth header, optional JWT subject header. Preserve current credential discovery/selection and no-refresh semantics; do not invent a client version.

Normalize the aggregate shared allowance only: require finite percent in [0,100], recognized weekly/monthly period, and valid period/reset metadata. Missing or malformed numeric allowance yields unavailable rather than fabricated 0/100. Preserve auth/rate-limit/error distinctions. Do not add product budgets together or convert prepaid balance into a percentage; omit prepaid balance from this repair.

The old binary gRPC response must not be UTF-8 round-tripped. JSON avoids the missing native binary response capability without adding TLS, a helper process, or another collector.

## Host deadlines for new transports

The new stale-daemon search needs real deadlines; current vendor timer shims are no-ops. `main.js` supplies a deadline callback from the active `cx.spawn` AsyncContext, backed by `cx.timer.after` and cancelling timer tasks on settlement. Thread this through the existing store/command/local-runtime option seam; never capture an event Context across an await.

Bound each new transport request including complete text-body reading and the whole daemon search. Capture request URL, token, fetch implementation and deadline function before awaiting. On timeout stop future discovery admission and ignore late completions; they must not read a newer global runtime context or publish cache/history. This bounds Mod waiting/publication, not underlying network cancellation: native fetch has no AbortSignal. Preserve the existing store lease/revision publication guards.

This seam serves the new Antigravity/Grok transports; a general rewrite of every upstream provider's timing is outside scope.

## Explicit scope change and blocked refresh

On an explicit scope change in a settings popup, save the preference and deliberately re-pin that popup to the selected policy's machine. Local must mean `null` immediately, including Start and refresh from the same popup. Merely changing the active space must continue to preserve existing popup pinning.

Manual refresh when consent is off or the requested selection is empty should open settings with existing Start/Query guidance, while making zero collector calls. It must never silently enable authorization or Query. Route the manual button, key and command paths through the same behavior; automatic polling continues to use normal admission.

## Configuration and rollout

After tests/native preflight, run the official installer (`just install`), preserving backup/rollback. Through the Mod's own settings controls/host shared API, choose Local, enable Query for Codex/Antigravity/Grok, disable hidden Cursor Query, then Start last. Keep other preferences. Do not edit physical `shared.json` or introduce an automatic first-run consent migration.

Verify normalized config read-back, fresh local provider caches, zero remote collection for this refresh, no sensitive persistence, and visible current numbers in the running app. Do not mark live acceptance passed based on synthetic output.

## Files expected to change

- `scripts/build-vendor.mjs` and generated vendor modules: local source/JSON transport and captured deadline support.
- `main.js`, `store.js`, `command.js`: active host deadline injection, manual refresh guidance, explicit scope re-pin.
- `tests/local-query.test.mjs`, `tests/command.test.mjs`, `tests/store.test.mjs`, `tests/ui.test.mjs` as affected: real defect guards and seam compatibility.
- Architecture/security/runtime/data/UI/verification docs only where the resulting contracts change. No installer behavior change is expected.

## Acceptance and rollback

Run genuine red/green checks for the new source/shape and scope regression cases in isolated fixtures/checkouts; do not revert the shared worktree. Run focused tests, `just ci`, `npm run check:herdr`, installation native check, and a real native local refresh for the three providers. Restore the installer's owned Mod backup if installation/acceptance requires rollback; preserve user-owned settings/history. No commit or push is authorized.
