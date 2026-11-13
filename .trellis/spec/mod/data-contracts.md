# Data Contracts

One owner per boundary:

```
local queryLocalQuota / remote quota-axi stdout → model.parseReport / normalizeReport → store cache
preferences                                     → config.normalizeConfig               → main.js / ui.js
provider id                                     → providers.assertProvider              → command.js
```

UI code consumes normalized lanes and `normalizeConfig` output. It does not parse stdout or raw account keys.

## Provider catalog

`PROVIDERS` in `providers.js` is a frozen list of `{ id, name, glyph, agents }`. `IDS` is the id list. `assertProvider` throws `Unsupported provider` for anything else.

`detectedProviders` keeps ids whose `agents` key appears on an `{ installed: true }` entry from `knownAgents`. Detection is not a subscription check. `zai`, `minimax`, `alibaba`, `mimo`, `deepseek`, `openrouter`, and `elevenlabs` have empty `agents` arrays, so detection never selects them.

Muse may appear in detection results. `main.js` `select-detected` still forces Muse `query` and `show` off. Enabling Muse query requires `museConsent` through the warning buttons. `normalizeConfig` also clears Muse `query` unless `museConsent === true`.

Add a provider by extending the `PROVIDERS` table, then add a schema fixture. Do not accept a provider id from free text.

## Preferences

`CONFIG_KEY` is `quota-manager.v1.config`. `normalizeConfig` is the only reader of stored preferences. Missing or malformed input becomes a complete object:

| Field | Accepted values | Default |
| --- | --- | --- |
| `consent` | `true` only | `false` |
| `museConsent` | `true` only | `false` |
| `providers[id].query` / `.show` | booleans | `true` for `codex`, `agy`, `grok`, `cursor`; else `false` |
| `order` | ids in `IDS` | stored known ids, then the rest of `IDS` |
| `interval` | `INTERVALS`: `0`, `60000`, `120000`, `300000`, `600000` | `120000` |
| `mode` | `compact`, `detailed` | `compact` |
| `percentage` | `remaining`, `used` | `remaining` |
| `language` | `en`, `zh` | `en` |
| `scope` | `current`, `local` | `current` |
| `sort` | `custom`, `remaining` | `custom` |
| `threshold` | `0`, `5`, `10`, `20` | `0` (alerts off) |
| `history` | `true` only | `false` |
| `showUnavailable` | boolean | `true` |
| `kinds` | booleans for `KINDS` | all `true` |
| `revision` | safe integer `>= 0` | `0` |

`changeConfig` merges `providers` and `kinds`, then runs `normalizeConfig` and increments `revision`. `moveProvider` swaps `order` and goes through `changeConfig`. A no-op move returns the same object and does not bump the revision.

`selectedProviders` returns `[]` unless `consent` is true, then the ordered ids with `query` true. Build the subprocess list from this function. Do not query everyone and filter afterward.

`machineFor(config, spaces, pinned)`:

- `pinned !== undefined`, including `null`, wins
- else `scope === "local"` returns `null`
- else the active space's `machine`, or `null`

## Collector command & in-Mod local query

`queryArgs(id, force)` returns:

```js
["--json", "--provider", assertProvider(id), "--no-credential-refresh", "--max-age", force ? "0" : "90s"]
```

When `fetchQuota(exec, id, { on = null, platform = "unknown", force = false, now = Date.now, local = null, deadline = null })` is called with `on == null` (local machine):

- It never calls `exec`, never spawns `node`, and never starts an external CLI.
- It calls `queryLocalQuota(providerId, { force, platform, home, appHome })` in-process from `mods/quota-manager/vendor/quota-axi/index.js` (`allowKeychainPrompt: false, refreshCredentials: false`, `maxAgeSeconds` `0` if `force` else `90`), where `home` and `appHome` come from `local` (`main.js` binds them to Herdr `home()` and `appHome()`).
- Thrown messages matching `timeout`, `timed out`, `unreachable`, `disconnect`, or `offline` map to `host_unavailable`; `invalid_report` and `cli_missing` pass through as fixed keys; any other error maps to redacted `cli_failed`.
- Returned JSON string passes directly through `parseReport` and `normalizeReport`.
- An optional function `deadline(promise, milliseconds)` is forwarded to the local runner; absent/non-function values do not change the runner's options. It originates from the active native async context, not preferences. The native local transport rules are in [Runtime Boundary](./runtime-boundary.md#scenario-native-local-quota-transports).

When `on != null` (remote machine):

- `commandsFor(id, platform, force)` builds shell-safe invocations for `quota-axi` plus `queryArgs`. Local paths (`home`, `appHome`) never enter remote commands.
- `exec` is called with `{ on, timeout: 45000 }`, never falls back to `queryLocalQuota`:
  - `platform === "windows"`: direct `quota-axi`, then `cmd.exe /d /s /c`
  - `platform === "unknown"`: direct, login shell (`sh`), then `cmd.exe`
  - anything else: direct, then login shell (`sh`)

| Remote outcome | Behavior |
| --- | --- |
| `exec` throws and the message matches `timeout`, `timed out`, `unreachable`, `disconnect`, or `offline` | throw `host_unavailable`; do not try the next shell |
| `exec` throws anything else | try the next command |
| exit `127` or `9009` | try the next command |
| exit other than `0` or `1` | throw `cli_failed`; do not try the next shell |
| exit `0` or `1` | `parseReport` then `normalizeReport` once, then return |
| no command could start | throw `cli_missing` |

Exit code `1` is a structured provider failure. Parse it. Do not run it again.

## Report normalization

`parseReport` accepts a string of at most 1 MiB. It strips a leading BOM and `JSON.parse`s from the first `{` that starts a line, at most 16 times, so a login-shell banner can precede the document. The value must be an object with `schemaVersion` `5` or `6` and an array `providers`. Anything else throws `invalid_report`. Do not log stdout.

`normalizeReport(report, id, now)` throws `invalid_report` when the schema is not 5 or 6, `generatedAt` is not a parseable time, the requested provider is missing, there are more than 64 provider rows, or two rows hash to the same lane key.

Each lane keeps:

- `key` from `laneKey([id, accountKey or accountKeys[0] or "default"])`. The hash separates lanes. It is not cryptographic anonymization and it is not an email.
- `plan` through `safeText` (control chars stripped, bearer tokens / `sk-` / JWT-like / emails redacted, 80 chars)
- at most 100 windows
- `status` in `fresh`, `stale`, `unavailable`, `auth_required`, `rate_limited`, `error`; otherwise `unavailable`
- `reason` in `keychain_access_required`, `credentials_expired`, `inference_opt_in_required`; otherwise `null`
- `stale` when the source says so, status is not `fresh`, or `refreshedAt` is more than 60 seconds in the future
- `retryAt` from `state.retryAfter`
- optional `credits` with `remaining`, `unlimited`, and unit `usd` / `cny` / `credits`

Window rules:

- `kind` is `session`, `weekly`, `monthly`, `model`, or `credits`; anything else is `unknown`
- a `shareOf` string sets `share: true` and `remaining: null`. Do not invent remaining from used
- otherwise remaining comes from `percentRemaining`, or from `100 - percentUsed` when remaining is absent and used is present
- `trusted` is false when the window id is listed in `state.untrustedWindowIds`
- `spentUsd`, `limitUsd`, and `remainingCredits` stay numbers or `null`. They are not turned into a bar percentage

Dropped on purpose: account emails, raw account objects, tokens, locators, stderr, and arbitrary upstream error strings.

Display helpers:

- `validWindow`: trusted, not a share, numeric remaining, and no `resetsAt` or `resetsAt` still in the future
- `headline`: visible valid window with the smallest remaining. `null` if none
- `displayPercent`: `null` when untrusted or the reset has passed. Share rows and `percentage: "used"` show used. They do not show a manufactured remaining
- `isStale`: lane flag, or age greater than `max(600000, interval * 3)`
- an elapsed reset formats as `0m` and does not refill the meter

`recordHistory` appends only fresh, non-stale lanes that still have a valid window. The stored row is `{ at, rows: [{ key, windows: [{ id, label, remaining, resetsAt }] }] }`. Cap is the last 120 points inside 30 days.

## Shared state and scheduling

`stateKey(kind, host, id)` returns `quota-manager.v1.<kind>:` plus `JSON.stringify([host ?? null, id])`. Kinds in use are `cache`, `lease`, `history`, and `alerts`.

`QuotaStore.refresh` prunes history for the host first, then runs two workers over `selectedProviders`. `only` limits that list to one id.

`refreshOne` returns without a subprocess when:

- the store is closed, the provider is no longer selected, or its lease is busy
- this is not a forced read and `interval` is `0` or `nextAt` is still in the future
- this is a forced read and `attemptAt` was under 5 seconds ago, or `retryAt` is still in the future
- two or more providers on this host already hold an unexpired lease

A lease is `{ token, until: start + 150000 }` written before `fetchQuota`. The same token must still be present, the config `revision` must match, and the provider must still be selected before a cache write. The lease is cleared in `finally` only if the token still matches.

Success replaces `lanes` and sets `error: null`. A fresh lane resets `failures` to `0`. Otherwise failures increment. `nextAt` is `max(now + delay, retryAt)`.

```js
delay = min(3600000, max(interval, 60000) * 2 ** min(failures, 6))
```

A thrown error keeps the previous lanes, marks each `stale: true`, and stores `error` only if the message is `cli_missing`, `cli_failed`, `invalid_report`, or `host_unavailable`. Any other message is stored as `cli_failed`.

Process failure and auth failure are different. An `auth_required` report is a successful parse, so it replaces the old lanes. A thrown `cli_*` error keeps the old numbers and marks them stale.

History is written only when `config.history` is true. `clearHistory(host, ids)` writes `[]` for those keys only. `prune` drops points older than 30 days and keeps the newest 120, including while collection is paused, because `refresh` prunes before it looks at consent. It does not walk other machines.

Alerts run only when `threshold` is not `0`. The dedupe key is `JSON.stringify([lane.key, window.id, window.resetsAt, threshold])`. A low window alerts once. It stays latched until remaining rises at least 3 points above the threshold. Stale lanes and invalid windows do not alert. A throwing `alert` callback is swallowed.

## Wrong vs correct

Wrong: query every catalog id, then hide the ones with Show off.

Correct: `selectedProviders` already applies consent and Query. `main.js` `items` applies Show only when building the tree.

Wrong: on a remote `exec` failure, call `fetchQuota` again with `on: null`.

Correct: pass the captured host through, and surface `host_unavailable` or the stale cache.

Wrong: treat a passed `resetsAt` as remaining `100`.

Correct: `displayPercent` returns `null`, and the meter uses the `resetDue` copy.
