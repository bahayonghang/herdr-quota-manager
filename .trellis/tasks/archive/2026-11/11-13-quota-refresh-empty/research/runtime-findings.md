# Runtime findings: manual refresh leaves all three chips empty

> Pre-fix diagnosis. The later approved repair and final native acceptance are recorded in native-acceptance-20261113.md; the settings/source observations below describe the original baseline.

- Date: 2026-11-13
- Baseline: branch `bottom-right-quota-strip`, HEAD `cb3a756`, initially clean.
- Scope: report-only diagnosis; real app read-only observation plus isolated structural reproduction.

## Root cause supported by current state

The displayed providers are excluded before collection: the installed app's persisted configuration has global consent disabled and all three visible providers' Query switches disabled. Manual refresh preserves those gates, so no request is admitted and the empty chips render as paused `—`.

Observed settings, read from the default app home without changing it:

| Setting/provider | Value/Query | Show |
| --- | --- | --- |
| Global consent | false | n/a |
| Codex | false | true |
| Antigravity (`agy`) | false | true |
| Grok | false | true |
| Cursor | true | false |

Other relevant settings: revision 7; scope `current`; interval 120000; all window kinds enabled. No quota-manager cache or lease keys exist. There is therefore no persisted evidence of a provider error, an in-flight lease, rate limiting, or old cached quota in this app home. Those absences alone do not prove credential validity or network health.

Installed-code comparison checked 83 JS/JSON files against the repository, excluding the development-only `jsconfig.json`: zero differences. This rules out stale installed JS as the explanation in the inspected home.

## Source trace

1. `ui.js:207` wires the refresh control; `main.js:128` calls `poll(cx, true)`.
2. `main.js:43` captures the target and spawns `store.refresh(..., { force, only })`.
3. `config.js:48` returns an empty selection while consent is false. When consent is true it still filters on each provider's Query flag.
4. `store.js:18` constructs the worker list from that selection. `store.js:30` independently checks it before fetching. Force bypasses ordinary scheduling/backoff, not consent or Query selection; it also preserves cooldown and Retry-After.
5. `main.js:101` builds display items independently using Show. Show ON thus renders chips even when Query is OFF and there are no lanes.
6. `ui.js:104` uses `—` when no valid numeric headline exists; `ui.js:107` marks an unqueried chip as `paused`. `ui.js:190` places that reason in a tooltip/accessibility label, while the visible chip still contains only `—`.

This is an admission/configuration result, not evidence that the refresh click failed to reach its handler. The native click itself was not replayed during diagnosis; the unchanged handler was exercised in the structural reproduction below.

## Native observation and machine routing

- `herdr-app --version` reported 0.1.15. `herdr-app status` reached the running window, reported the custom quota layout and an active connected remote space, no overlays, and `errors: []`.
- `herdr-app shot` captured the current frame to a temporary image outside the repository. Visual inspection confirmed the same three empty chips shown by the user. No settings were changed and no refresh or Start action was sent to the real app.
- The frame shows a connected remote machine selected; with `scope: current`, `main.js:38` / `config.js:51` follow that space. The query that would run after enabling therefore uses remote `exec(..., { on: machine })` at `command.js:42`, not local `queryLocalQuota` at `command.js:23`.
- The previous local vendor migration does not install `quota-axi` or credentials on that remote machine. Whether that remote currently has a usable collector, authentication, or endpoint connectivity remains unverified. No remote command was launched during diagnosis.
- The raw native frame contains unrelated user workspace content and is deliberately not copied into task artifacts.

## Discriminating reproduction

Run from the repository root:

```powershell
node .trellis/tasks/archive/2026-11/11-13-quota-refresh-empty/research/reproduce-admission.mjs
```

The script copies the unchanged Mod into a temporary structural harness, uses sanitized observed preferences, invokes the actual `bar-refresh` handler, and injects fake local/remote collectors returning schema-5 reports with 42% remaining. Only in-memory preferences are changed. No real credential file, shared state, provider endpoint, or host command is used.

All eight checks passed: each row below was run for both local and remote target routing.

| In-memory scenario | Collector calls | Three visible chips |
| --- | --- | --- |
| Observed settings | none | `—`, all paused |
| Enable consent only | Cursor only (hidden) | `—`, all paused |
| Enable Codex Query only, leave consent off | none | `—`, all paused |
| Enable consent plus the three visible Query switches | Codex, agy, Grok | `42%`, `42%`, `42%` |

The positive case proves the handler, admission, schema parsing, cache publication, and numeric chip rendering can work together with a valid report. It does not certify live provider reads or native pixel layout.

## Existing regression coverage rerun

`node --test tests/store.test.mjs tests/ui.test.mjs`: **41 passed, 0 failed**.

These tests include consent blocking, Query/Show independence, host isolation, force cooldown, and paused strip rendering. No product code changed, so broader CI/install runs were unnecessary for this diagnosis.

## Assessment

- Proven immediate cause: the global and provider admission switches block the displayed providers.
- Proven UX gap: paused/Query OFF/no quota conditions collapse to the same visible `—`; the refresh control offers no visible explanation when selection is empty. Existing tooltip/usage statuses contain more information, but the screenshot alone does not expose it.
- Proven applicability limit: current space follows a remote machine, so claims about local vendor compatibility do not establish collection on this screen.
- Remaining investigation: source-level local provider limitations and test gaps are documented separately in `source-trace.md`. They must not be presented as the cause of this remote screenshot.
- Unverified: real provider authentication, remote collector availability, endpoint responses, and successful native numeric quota display. No authorization or settings were changed to test them.
