# Validation status and acceptance checklist

## Automated verification

The initial implementation was checked on 2026-11-12 in a Linux development container:

- `npm run validate`: syntax/JSON checks and full `tests/*.test.mjs` fixture/unit suite (covering `tests/local-query.test.mjs`, command routing, config, model, store, install, icons, and structural UI); zero failures/skips.
- `npm run test:coverage`: passing. Structural UI tests import temporary stubbed copies and are not represented as original native-file coverage.
- Test runtime: Node.js 22.19+ (`scripts/build-vendor.mjs` builds `third_party/quota-axi` into `mods/quota-manager/vendor/quota-axi/`). `npm test` runs `tests/` only and does not execute `third_party/quota-axi/test`.
- `npm run check:herdr`: verifies `herdr-app check` passes on `mods/quota-manager` (initial load and render with the vendored modules).
- The CI workflow targets Node.js 22.19.0 on Linux, Windows, and macOS. Workflow existence alone does not establish that its runs passed; inspect the actual commit's checks.

Tests cover configuration sanitization, provider filtering, no-consent/no-selection cases, Windows shim commands, fixed shell input, remote forwarding, schema 5/6 account lanes, failure reports, stale/expired/untrusted quota, timestamps, share semantics, concurrency leases, obsolete responses, backoff, Retry-After, alerts, history, installer backups, and structural UI interactions.

## Required native checks

### Windows local acceptance on 2026-11-13

Herdr 0.1.15 was checked with the installed repair and real local accounts. A native refresh published fresh trusted windows and the actual status strip showed Codex 97%, Antigravity 69%, and Grok 50% remaining. Values are transient observations. Scope was Local, collection authorized, the three Query switches on, hidden Cursor Query off, with no remote quota cache or module errors.

Final `just ci` passed 114/114 tests; `npm run check:herdr` and the official installer's staged check passed. Native acceptance also caught a Buffer conversion mismatch that Node-only tests missed; the repaired VFS preserves host UTF-8 text and has an observed-host regression fixture. Detailed evidence and coverage limits are in `.trellis/tasks/archive/2026-11/11-13-quota-refresh-empty/research/native-acceptance-20261113.md`. This acceptance covers these three providers on Windows, not the entire provider catalog or other platforms.

On the actual Herdr machine, run:

```sh
npm run check:herdr
node scripts/install.mjs
herdr-app status
```

The native check loads and renders the initial state; it does not exercise every later async state. The installer intentionally stops before replacing the previous install if that check fails.

## Interactive acceptance

1. Verify first-run settings open without any quota request. Select only Codex and click Start; verify disabled providers are not queried.
2. Toggle Query and Show separately; reload Herdr and verify persistence. Test manual-only mode after restart.
3. Test Compact/Detailed, Used/Remaining, every quota-window filter, account-lane separation, ordering, and English/Chinese.
4. Resize the window until the overflow control appears. Open the popup from a chip, `+N`, and the gear: the whole status bar stays visible below it, also in a short window. Open it with `s` / `u`: it is a centered dialog. Open/close the popup with mouse and Escape, and test keyboard focus/controls in both themes and your zoom level.
5. Test an unauthenticated local provider, a missing remote `quota-axi` on PATH, an unreachable remote, and a provider rate limit. Unknown/stale information must stay visibly distinct from fresh quota. A remote miss means the `quota-axi` program is absent on that remote machine's PATH (never falls back to local).
6. Change active machine while a popup is open: it must stay on its original machine. Reopen it to follow the new selection. Verify no remote failure invokes the local collector.
7. Enable history/alerts deliberately, verify deduplication, and clear history on one machine without clearing another's.
8. Verify updates retain settings and back up installed files. Confirm a failed native preflight leaves the existing installation intact.
9. On the shown personal layout, the status block is the only `quota-manager` copy. `herdr-app shot` shows the chips immediately left of the command hint, with Herdr's own program icons, and no second quota row under it. Consent off does not start a collector. A narrow slot shows `+N`. Repeat in both themes at your zoom level.

After successful native acceptance, capture a real preview with `herdr-app shot preview.png`. No mock-generated image should be presented as a real native screenshot.
