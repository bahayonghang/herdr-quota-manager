# Local repair preflight

Date: 2026-11-13. User follow-up requests code/config repair for local querying. Read-only quota preflights are authorized; product edits and real configuration changes await final planning review.

## Codex feasibility

- Default local Codex auth exists in ChatGPT mode with access token and account id. Only credential-presence/type booleans were printed; credential contents and identity were not copied into task artifacts.
- Called the unchanged local `queryLocalQuota('codex')` in Node with the real home and an isolated temporary app home. The fetch wrapper imposed a 12-second request bound and returned only the native response shape (`status`, `ok`, `url`, `text`, `json`). No command or CLI was spawned by the collector.
- Result: one HTTP 200; normalized lane `fresh`, not stale; one trusted weekly window, 99% remaining, reset in the future. The temporary collector cache was removed afterward.
- This establishes that the current credential, upstream JSON response, and current adapter work in that probe. It does not replace a later real Herdr runtime query and visible-digit acceptance.

## Scope-switch bug relevant to local setup

`main.js:38-40` honors the popup's captured `on` prop. The settings scope choice (`main.js`, scope choice callback) only calls `save({scope}, cx)` and does not deliberately retarget that pin. `config.js:51-53` gives the pin precedence over local scope. Therefore a popup opened on a remote space retains the remote host after selecting Local; its Start/refresh action still captures that remote.

Small deterministic check run against the current config module:

```js
const current = [{active:true, machine:'diagnostic-remote'}];
const cfg = normalizeConfig({scope:'local'});
assert.equal(machineFor(cfg, current, 'diagnostic-remote'), 'diagnostic-remote');
assert.equal(machineFor(cfg, current, undefined), null);
```

Both assertions passed, proving the pin-vs-policy split. Source inspection confirms the scope button currently updates only policy. A product regression test must click that actual control, then refresh/Start and assert that it targets local. Preserve pinning when the active space merely changes; re-pin only when the user explicitly changes scope in that popup.

## Configuration application plan

Use the Mod's own settings controls/host shared API, never direct `shared.json` editing. Apply scope Local and Query ON for the screenshot's Codex/Antigravity/Grok, Query OFF for hidden Cursor, then Start last. Keep other preferences intact. Apply after installing the checked repair and verify read-back of normalized preferences and per-local-provider caches.

The requested outcome requires actual quota in the running native app. A mocked percentage, a parsed snapshot, or an unavailable reason alone does not satisfy it when a usable local account was established by preflight.
