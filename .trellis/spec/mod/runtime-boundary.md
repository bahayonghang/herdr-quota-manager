# Runtime Boundary

`scripts/check.mjs` rejects these in every `.js` file under `mods/quota-manager/`:

- `from "node:` or `from 'node:`
- `require(`
- `setTimeout(` and `setInterval(`

Host calls belong in `main.js` tasks. `ui.js` receives plain data and a theme object and returns nodes.

## Allowed imports

| Module | Imports |
| --- | --- |
| `main.js` | `gpui-kit` `View`; `herdr` host functions; relative `./` modules |
| `ui.js` | `gpui-kit` `div`, `image`, and `svg`; `gpui-base` `h_flex` / `v_flex`; `./providers.js`, `./i18n.js`, `./model.js` |
| `command.js` | `./providers.js`, `./model.js`, `./vendor/quota-axi/index.js` |
| `vendor/quota-axi/*.js` | relative `./` / `../` modules inside `vendor/quota-axi/`; unprefixed Herdr/Node built-ins (`fs/promises`, `crypto`, `buffer`, `path`, `url`, `os`) and global `fetch` |
| `config.js`, `model.js`, `store.js`, `providers.js`, `i18n.js` | relative Mod modules only |

`herdr` symbols used today: `exec`, `props`, `theme`, `shared`, `setShared`, `spaces`, `agents`, `keys`, `window`, `knownAgents`, `openOverlay`, `closeOverlay`, `nextCommand`, `run`, `notify`, `home`, `appHome`.

`main.js` passes `local: { home: () => home(), appHome: () => appHome() }` into `QuotaStore` so `command.js` forwards the host paths to `queryLocalQuota` when `on == null`. `command.js` does not import `herdr`. No Mod module spawns `node`, runs `query.mjs`, or invokes a local `quota-axi` binary.

The bar calls `spaces()`, `agents()`, and `keys()` while painting, and `window()?.platform` only to format the palette hint. `herdr-app check` has no window, so that call stays optional. Provider marks are chosen in `ui.js`: a `BRAND` entry uses `icons/<file>.svg` from the Herdr home (`image` or tinted `svg`), and every other id uses `image("mods/quota-manager/icons/<id>.svg")`. Refresh and settings use `svg()`. `main.js` does not import `h_flex`; `quotaBar` in `ui.js` builds the status row.

## View lifecycle

`QuotaManager` is the default export of `main.js` and extends `View`.

- `init` reads `props().view` (`bar` by default), builds one `QuotaStore`, focuses non-bar screens, calls `poll`, then starts timers.
- `cx.timer.every(10000, ...)` calls `poll`. `cx.timer.every(30000, ...)` only calls `cx.notify()` so countdowns repaint.
- A `cx.spawn` loop reads `nextCommand()`. Handled names: `focus`, `refresh`, `menu`, `settings`, `history`. Anything else is ignored.
- `render` may run before `init`. The `if (!this.store)` branch returns a text node and must stay.
- `close` calls `this.store.close()`. That sets `closed` so a late result is not published. Herdr does not cancel an `exec` that has already started.

Async work uses `cx.spawn`, not timers from the DOM or Node. `poll` always records the host before spawning:

```js
cx.spawn(async cx => {
  const deadline = async (promise, ms) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_resolve, reject) => {
        timer = cx.timer.after(ms, () => reject(new Error("query timed out")));
      })]);
    } finally { timer?.cancel(); }
  };
  await this.store.refresh(host, platform, { force, only, deadline: host === null ? deadline : null });
  cx.notify();
});
```

`platform` is `window()?.platform` for the local machine (`host === null`). `herdr-app check` has no window, so `window()` is null there; a missing platform uses `"unknown"`. A remote host also uses `"unknown"` so `command.js` can try the direct binary, a login shell, and the Windows shim.

## Overlays and machines

The bar calls `open(view, anchor)`. A press on a strip control (`chip-*`, `overflow`, `open`, `bar-refresh`, `bar-settings`) records that control's `event.bounds` on `on_mouse_down`, the bar root and the `quota-strip` group record their own bounds on `on_mouse_move` (chips stop mouse-down propagation, so neither sees the press). `on_click` carries no coordinates. `popupPlacement(anchor, barBounds, stripBounds)` in `ui.js` returns `{ at, width: 540, height }`: `at` is the popup's top-left in logical window px (the same space as `bounds`, as Herdr's `better-tabs` uses it), the bottom sits 6px above the bar top, the right edge lines up with the strip's right edge so every chip and icon opens it in one place (with the pressed control when the strip bounds are missing or do not contain it), `x >= 8`, and `height` shrinks to the space above the bar. Below 240px, or with no anchor, it returns `null`. The call is then `{ mod: "quota-manager", kind: "popup", at, width, height, props: { view, on: this.host(), height } }`, otherwise `{ mod: "quota-manager", kind: "dialog", width: 540, height: 620, props }` with `props.height` 620. The host shrinks a popup to its content, so the dialog root sets `h(props().height ?? 620)` rather than `size_full()`; without it a short page (empty History) collapses toward the anchored top edge. Keys (`u` / `s` / `h`), `nextCommand`, and a blocked refresh with no press use the dialog, never the host's pointer default, which would cover the bar. An anchor is taken once (`takeAnchor`); a later key press does not reuse it. `mod.json` keeps the 540 x 620 overlay size.

`machineFor` treats an explicit `on` property as pinned, including `null`. A popup must keep that pin when the active space changes. Its explicit scope choice uses `setScope(scope, cx)` to set `scopeHost` to the newly selected policy's machine before saving; selecting Local immediately pins `null`. Do not omit `on` on a later `exec` or `knownAgents` call. There is no remote-to-local fallback.

Escape on an overlay calls `closeOverlay(props().overlay)`. Escape on the bar calls `run("pane.go", { direction: "up" })`.

## Commands and keyboard

Optional command ids are `quota-manager.menu`, `quota-manager.settings`, `quota-manager.history`, and `quota-manager.refresh`. The Mod does not write `keys.json`. Herdr binding notation is `quota-manager:refresh`.

Keys handled in `key`: `escape`, `r`, `s`, `h`, `u`, `enter`. Settings also handles `up`, `down`, `ctrl-up`, `ctrl-down`, `space`, `shift-space`. Unhandled keys return without `stop_propagation`.

## Anti-patterns

- Starting a collector from `render`, `ui.js`, or a button builder. Buttons call back into `main.js`, which calls `poll`.
- Using `setTimeout` to wait for `exec`. Scheduling state lives on the cache entry (`nextAt`, `retryAt`, `attemptAt`) and is enforced by `QuotaStore`.
- Reading `props()` during a late async completion to decide the machine. Capture `host` before the spawn, and let `store.current` drop the result if the config revision changed.

## Scenario: native local quota transports

### 1. Scope / trigger

Antigravity daemon discovery and Grok JSON billing need native async FS/text-fetch support; a Node stream-shaped mock does not establish Herdr compatibility. Keep adaptations in `scripts/build-vendor.mjs` and regenerate vendor output together.

### 2. Signatures

`QuotaStore.refresh(host, platform, { force, only, deadline })` forwards `deadline(promise, milliseconds): Promise` only on local reads. `command.fetchQuota` passes it to `queryLocalQuota(id, { force, platform, home, appHome, deadline })` only when it is a function. It is not an environment variable or persisted preference.

### 3. Contracts

- `main.js` creates the callback inside the active `cx.spawn` AsyncContext. It races against `cx.timer.after` and cancels that task in `finally`; never use no-op vendor timer shims as native bounds.
- Capture fetch, deadline, request secrets and paths before awaiting. Deadline-losing work must not consult the next global runtime context, schedule more discovery, or publish data. Underlying native fetch is not cancelled.
- Herdr 0.1.15 exposes Buffer methods whose conversion semantics differ from Node: converting a host Uint8Array can yield zero bytes and Buffer.toString can yield empty text. Preserve allowlisted UTF-8 input/cache text in the VFS and flush text via host writes. Maintain real byte views for hash/size; method existence is not a capability test. Verify JWT decoding with standard base64 facilities and a native-shaped Buffer regression.
- Antigravity reads the fixed daemon directory under home, validates `hub_<port>.json` and its state, and contacts literal `127.0.0.1` at the fixed quota path. Do not use stat, filename recency assumptions, process inspection or a CLI.
- Its four logical workers bound awaited attempts, not native sockets. At most 256 matching candidates are considered once each; per-request/overall deadlines stop waiting and future discovery, while older uncancellable fetches may remain unsettled. Never claim a four-native-request limit.
- Grok reads the fixed JSON billing allowance. Require supported period metadata and finite percent; do not UTF-8 round-trip binary protobuf or sum product breakdowns into independent budgets.
- Persist only existing normalized reports/state; tokens, CSRF and raw network errors stay out of cache/history/diagnostics.

### 4. Validation and error matrix

| Input/outcome | Required behavior |
| --- | --- |
| Consent false or requested Query selection empty | Manual refresh opens settings, zero collection; automatic poll remains gated |
| Invalid/stale daemon metadata | Skip safely; no arbitrary host/path and no claim of logout/uninstallation |
| Discovery limit/deadline or malformed quota | Safe unavailable/error outcome, no invented percentage or late publication |
| Valid local JSON report | Existing semantics/schema/normalization and local cache publication |
| Remote machine | Existing remote argv and captured on; no local deadline/credential fallback |

### 5. Good / base / bad cases

Good: stale daemon candidates followed by a valid one produce a real quota. Base: missing local source reports unavailable. Bad: returning 100% for a missing percent, querying the old remote after explicit Local, or relying on response.body in Herdr.

### 6. Tests required

Use native-shaped response objects without body/headers; valid daemon after more than 16 stale states; file/port/token bounds; discovery concurrency and real deadline/late-response handling; valid/malformed/auth JSON billing; local zero-exec; actual scope-control click and ordinary popup pin preservation. Record separate native fresh-cache and visible-digit acceptance.

### 7. Wrong vs correct

Wrong: a forced poll overrides consent, or a Node-only successful stream fixture is called native acceptance. Correct: preserve admission, expose settings guidance, use verified native-capable JSON sources, and read back actual results from the running app.
