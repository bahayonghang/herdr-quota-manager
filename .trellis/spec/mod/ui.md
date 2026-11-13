# UI

`ui.js` builds GPUI nodes from a normalized lane, a config object, and `theme()`. `main.js` chooses the screen and passes callbacks. Copy comes from `tr(config, key)` in `i18n.js`.

## Nodes

Builders used by the View: `button`, `line`, `text`, `note`, `row`, `column`, `choice`, `toggle`, `meter`, `providerCard`, `chip`. `laneStatus` and `creditsText` return strings.

- Colors, borders, and type sizes come from the theme argument (`foreground`, `muted`, `border`, `chrome`, `popover`, `raised`, `selected`, `hover`, `accent`, `ansi1`, `ansi2`, `ansi3`). Do not hard-code a palette.
- `button` sets `role("button")`, `accessibility_label`, and stops propagation on mouse-down and click. Clicks call `action(cx)`.
- Interactive nodes that tests click need a stable `id`: `open`, `chip-<provider>-<laneKey>`, `provider-<id>-<laneKey>`, `query-<id>`, `show-<id>`, `tab-usage`, `consent`, `muse-confirm`. The empty lane uses the suffix `empty`.
- `row` is `h_flex` and `column` is `v_flex`, both with `gap(6)` unless a call site overrides it.

`meter` uses `displayPercent`. `null` draws an empty bar and a caption (`resetDue`, `unknown`, `shared`, or the percentage mode). It does not draw `0%` for unknown data. Share bars use `t.muted`. Remaining uses `ansi1` at or below 10, `ansi3` at or below 25, otherwise `ansi2`.

`laneStatus` order: paused when Query is off or consent is off, then `snapshot.error`, then `idle` when there is no lane, then the lane status when it is not `fresh`, then `stale` from `isStale`, otherwise `""`.

`chip` shows the glyph when the bar is narrow (`main.js` uses width under 600) and the headline percent, or `—` when there is no headline. A non-empty status adds ` !`. The tooltip carries the provider, account suffix, window, and countdown.

## Screens

`render` switches on `this.screen`:

| Screen | Root id | Contents |
| --- | --- | --- |
| `bar` | `quota-manager-bar` | open button, chips that fit, overflow, refresh, settings |
| `usage` | `quota-manager-dialog` | consent note, compact/detailed, cards |
| `settings` | same dialog | query/show rows, interval, display, machine, sort, language, window kinds, alerts, history |
| `history` | same dialog | snapshot rows and `clear-history` |
| `help` | same dialog | pinned collector commands as text, not buttons that run them |

The dialog always shows machine, the three tabs, and a help button. Bar capacity is `max(0, floor((width - 180) / (small ? 78 : 125)))`. Extra items become the overflow button.

`items` lists providers with Show on. With `showUnavailable` false, it skips a provider that has no lanes and skips a lane that has no windows and no credits. `sort === "remaining"` orders by headline remaining; missing headlines sort last (`101`). This sort is display-only.

Settings mutations go through `save` / `changeConfig` or `moveProvider`. Query and Show are independent. Turning consent on also force-polls. Select detected writes query and show from the detection list captured for `this.host()`, and never turns Muse on. Select none sets every provider's query and show to false.

The help view may display `quota-axi --provider codex --json --no-credential-refresh` and the keychain-prompt example. Those strings are not passed to `exec`.

## Copy

Every `i18n.js` entry is `[english, simplifiedChinese]`. `tr` uses index `1` when `config.language === "zh"`, otherwise index `0`. A missing key returns the key, so a new key must be added to `copy` before it is used.

Add both languages in the same edit. Status and error keys match the stored vocabulary: `paused`, `idle`, `loading`, `stale`, `fresh`, the lane statuses, the four `safeErrors`, and the three `reason` codes.

## Tests

`tests/ui.test.mjs` copies the Mod into a temp directory, rewrites `gpui-kit`, `gpui-base`, and `herdr` imports to `tests/mock-kit.mjs` and `tests/mock-host.mjs`, then constructs `QuotaManager`. Find controls with `attrs.id` and invoke `events.on_click`. Assert on `shared` state and `host.state.executions`, not on HTML.

A new control that changes preferences needs a click assertion. A new screen must render under the existing per-view test, which also asserts that the first paint does not call `exec` before consent.
