# Architecture

## Runtime boundary

Herdr runs JavaScript describing GPUI nodes. The Mod does not import Node built-ins, DOM APIs, React, or npm libraries. Host calls happen only inside View lifecycle/event tasks. `cx.spawn`, `cx.timer`, `cx.notify`, `openOverlay`, and `shared` are the integration points.

The vendored quota-axi library owns provider auth discovery and first-party network calls. This repository keeps its 0.1.69 source at `third_party/quota-axi` (commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, MIT, Copyright (c) 2026 Kun Chen). `scripts/build-vendor.mjs` compiles and adapts the core query graph into `mods/quota-manager/vendor/quota-axi/`, shimming synchronous `node:fs` / `os` / `process` usage via Herdr's embedded unprefixed built-ins (`fs/promises`, `crypto`, `buffer`, `path`, `url`, `os`) and global `fetch`. Local queries call `queryLocalQuota` directly in-process inside the Mod without spawning `node` or launching a CLI binary. Remote machines still invoke `quota-axi` via `exec(..., { on: machine })`. Schema versions 5/6 remain the adapter boundary. The catalog is explicit and extendable in source; arbitrary commands or unvalidated provider identifiers are not accepted through preferences.

```
Native status bar / popup / settings / snapshot history
                 │
        validated persistent preferences
                 │
        per-machine/provider admission + cache
                 │
 local:  in-Mod queryLocalQuota(id, { force, platform, home, appHome })
         -> mods/quota-manager/vendor/quota-axi/index.js
 remote: exec("quota-axi", ["--json", "--provider", id, "--no-credential-refresh", ...], { on: machine })
                 │
       normalized, non-secret account lanes
```

## Selection and concurrency

`consent` gates the complete scheduler. Each provider has independent `query` and `show` flags. The query list is constructed before invoking any subprocess; it is never implemented as a filter after an unscoped collection.

Each app copy uses synchronous shared leases. A lease is keyed by machine/provider and expires after 150 seconds, longer than the bounded execution attempts. At most two provider reads are admitted per host in this shared-state domain. This is not a distributed lock spanning unrelated Herdr processes. quota-axi's 90-second fresh-reuse option provides an additional upstream deduplication layer where that collector supports it.

A config revision guards async completion. Changing settings or disposing the View causes obsolete responses to be discarded. Current Herdr `exec` does not offer cancellation, so stopping a query means no future admission and no stale publication, not a guarantee that an already-running vendor request is aborted.

Success waits for the chosen interval. Failures exponentially back off up to one hour; provider Retry-After can extend the wait. Manual refresh bypasses ordinary interval/backoff but not Retry-After or the five-second cooldown. Manual-only mode never auto-fetches its first result.

## Machine and account identity

A bar follows the current space unless configured local-only. Opening a popup snapshots the target machine into props. Every process fallback uses the same `on` option. No remote-to-local fallback exists.

Cache/lease/history/alert keys encode `[machine, provider]`. Each result preserves its account lanes instead of indexing only by provider. Account labels are deterministic non-cryptographic hashes of opaque local lane keys; source account emails, credentials, locators, and arbitrary error text are discarded. The labels provide separation, not a cryptographic privacy guarantee or a verified user identity.

## Data semantics

Only complete JSON reports with an understood schema are accepted. Unknown schemas fail closed. Exit code 1 is still parsed because quota-axi emits structured provider failures there; it does not trigger duplicate shell retries.

An independent allowance can derive remaining from used when necessary. A `shareOf` row cannot. Untrusted-window flags and source timestamps survive normalization. A reset time passing makes the previous value unverified; it does not refill a progress bar. Different providers' quotas are never summed.

On a process failure, last-known data is explicitly stale. An explicit auth-required report replaces previous lanes, rather than silently retaining quota that may belong to another signed-in account.

## Persistence

`quota-manager.v1.config` is the settings namespace. Other keys use `quota-manager.v1.<kind>:[machine,provider]`. No code edits the physical `shared.json` directly.

Snapshot history is opt-in and capped at 120 records per provider/host. Entries older than 30 days are pruned when that host is polled, including while collection is paused. An unvisited machine's persistent history is not cleaned by a separate background daemon. Clearing history is scoped to the popup machine.

## Extension points and deliberate limits

Add a supported collector identifier to `providers.js`, then verify its schema and add fixture tests. Avoid a generic shell-command setting. Add an adapter interface only when a second real collector is needed; the current boundary is `fetchQuota`.

Ordering is implemented through buttons and keyboard, not an unverified native drag API. History is a snapshot table, not a billing trend chart. Account login/switching, arbitrary profiles, per-terminal environment inference, and agent routing are outside v0.1.0. These limits are explicit rather than exposed as nonfunctional controls.
