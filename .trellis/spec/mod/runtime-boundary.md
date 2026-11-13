# Runtime Boundary

`scripts/check.mjs` rejects these in every `.js` file under `mods/quota-manager/`:

- `from "node:` or `from 'node:`
- `require(`
- `setTimeout(` and `setInterval(`

Host calls belong in `main.js` tasks. `ui.js` receives plain data and a theme object and returns nodes.

## Allowed imports

| Module | Imports |
| --- | --- |
| `main.js` | `gpui-kit` `View` and `div`; `herdr` host functions; relative `./` modules |
| `ui.js` | `gpui-kit` `div`, `gpui-base` `h_flex` / `v_flex`, `./providers.js`, `./i18n.js`, `./model.js` |
| `config.js`, `command.js`, `model.js`, `store.js`, `providers.js`, `i18n.js` | relative Mod modules only |

`herdr` symbols used today: `exec`, `props`, `theme`, `shared`, `setShared`, `spaces`, `window`, `knownAgents`, `openOverlay`, `closeOverlay`, `nextCommand`, `run`, `notify`.

## View lifecycle

`QuotaManager` is the default export of `main.js` and extends `View`.

- `init` reads `props().view` (`bar` by default), builds one `QuotaStore`, focuses non-bar screens, calls `poll`, then starts timers.
- `cx.timer.every(10000, ...)` calls `poll`. `cx.timer.every(30000, ...)` only calls `cx.notify()` so countdowns repaint.
- A `cx.spawn` loop reads `nextCommand()`. Handled names: `focus`, `refresh`, `menu`, `settings`, `history`. Anything else is ignored.
- `render` may run before `init`. The `if (!this.store)` branch returns a text node and must stay.
- `close` calls `this.store.close()`. That sets `closed` so a late result is not published. Herdr does not cancel an `exec` that has already started.

Async work uses `cx.spawn`, not timers from the DOM or Node. `poll` always records the host before spawning:

```js
cx.spawn(async cx => { await this.store.refresh(host, platform, { force, only }); cx.notify(); });
```

`platform` is `window().platform` only for the local machine (`host === null`). A remote host uses `"unknown"` so `command.js` can try the direct binary, a login shell, and the Windows shim.

## Overlays and machines

The bar calls `openOverlay` with `{ mod: "quota-manager", kind: "popup", width: 540, height: 620, props: { view, on: this.host() } }`. `mod.json` uses the same overlay size.

`machineFor` treats an explicit `on` property as pinned, including `null`. A popup must keep that pin when the active space changes. Do not omit `on` on a later `exec` or `knownAgents` call. There is no remote-to-local fallback.

Escape on an overlay calls `closeOverlay(props().overlay)`. Escape on the bar calls `run("pane.go", { direction: "up" })`.

## Commands and keyboard

Optional command ids are `quota-manager.menu`, `quota-manager.settings`, `quota-manager.history`, and `quota-manager.refresh`. The Mod does not write `keys.json`. Herdr binding notation is `quota-manager:refresh`.

Keys handled in `key`: `escape`, `r`, `s`, `h`, `u`, `enter`. Settings also handles `up`, `down`, `ctrl-up`, `ctrl-down`, `space`, `shift-space`. Unhandled keys return without `stop_propagation`.

## Anti-patterns

- Starting a collector from `render`, `ui.js`, or a button builder. Buttons call back into `main.js`, which calls `poll`.
- Using `setTimeout` to wait for `exec`. Scheduling state lives on the cache entry (`nextAt`, `retryAt`, `attemptAt`) and is enforced by `QuotaStore`.
- Reading `props()` during a late async completion to decide the machine. Capture `host` before the spawn, and let `store.current` drop the result if the config revision changed.
