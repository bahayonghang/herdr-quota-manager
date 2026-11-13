# UI

`ui.js` builds GPUI nodes from a normalized lane, a config object, and `theme()`. `main.js` chooses the screen and passes callbacks. Copy comes from `tr(config, key)` in `i18n.js`.

## Nodes

Builders used by the View: `button`, `line`, `text`, `note`, `row`, `column`, `choice`, `toggle`, `meter`, `providerCard`, `quotaStrip`, `stripChip`. `laneStatus` and `creditsText` return strings. `stripFace`, `pressureTone`, and `stripBudget` feed the strip.

- Colors, borders, and type sizes come from the theme argument (`foreground`, `muted`, `dim`, `border`, `chrome`, `popover`, `raised`, `selected`, `hover`, `accent`, `ansi1`, `ansi2`, `ansi3`). Do not hard-code a palette. Tile fills live only in the SVG files.
- `button` sets `role("button")`, `accessibility_label`, and stops propagation on mouse-down and click. Clicks call `action(cx)`.
- Interactive nodes that tests click need a stable `id`: `open`, `chip-<provider>-<laneKey>`, `provider-<id>-<laneKey>`, `query-<id>`, `show-<id>`, `tab-usage`, `consent`, `muse-confirm`. The empty lane uses the suffix `empty`.
- `row` is `h_flex` and `column` is `v_flex`, both with `gap(6)` unless a call site overrides it.

`meter` uses `displayPercent`. `null` draws an empty bar and a caption (`resetDue`, `unknown`, `shared`, or the percentage mode). It does not draw `0%` for unknown data. Share bars use `t.muted`. Remaining uses `ansi1` at or below 10, `ansi3` at or below 25, otherwise `ansi2`. That scale is `tone()`. `pressureTone` is strip-only and is not called from `meter()` or `providerCard()`. It classifies used pressure of the same window: `ansi1` at used ≥ 80, `ansi3` at used ≥ 50, otherwise `ansi2`. Printed digits stay `displayPercent`.

`stripFace` is the only strip color procedure. Order: consent or query off (`paused`, cached digits in `t.muted` or `—` in `t.dim`); else busy (`loading`, same split); else no numeric headline and a failed status or `snapshot.error` (`—` in `t.ansi1`); else no numeric headline (`—` in `t.dim`, one key from idle, filtered, shared before a passed reset, resetDue, unknown); else a numeric headline that is failed, not fresh, or stale (digits in `t.muted`); else `pressureTone` with key `fresh`. There is no visible ` !`.

`laneStatus` order: paused when Query is off or consent is off, then `snapshot.error`, then `idle` when there is no lane, then the lane status when it is not `fresh`, then `stale` from `isStale`, otherwise `""`. Cards and meters still use it. The strip does not.

`stripChip` always shows the provider name beside a 14px mark. The percent is `stripFace`'s text (`—` when there is no numeric headline). The tooltip carries the provider, account suffix, window, percent, mode, the `stripFace` key, and the countdown. It does not append ` !`.

## Screens

`render` switches on `this.screen`:

| Screen | Root id | Contents |
| --- | --- | --- |
| `bar` | `quota-manager-bar` | trailing `quota-strip`: chips that fit, overflow, refresh, settings. `open` only when `items.length === 0` |
| `usage` | `quota-manager-dialog` | consent note, compact/detailed, cards |
| `settings` | same dialog | query/show rows, interval, display, machine, sort, language, window kinds, alerts, history |
| `history` | same dialog | snapshot rows and `clear-history` |
| `help` | same dialog | pinned collector commands as text, not buttons that run them |

The dialog always shows machine, the three tabs, and a help button. The bar is `row().justify_end()` with no background and no `border_t`. `main.js` does not import `h_flex`. `quotaStrip` is `flex_none`, 24px tall, and packs a 14px mark, the name, an optional plan, the percent, and an optional countdown. `fitStrip` drops the countdown, then the plan, then whole chips from the end. Width 220 still has `capacity === 0`: `overflow` is present and `open` is not. All shows off paints `open` (`stripEmpty`), `bar-refresh`, and `bar-settings`, and does not paint `overflow`.

Provider marks are `image("mods/quota-manager/icons/<id>.svg")` at 14px, on the chip and the card header. They are original two-letter tiles, not vendor logos. Refresh and settings are `svg()` masks at 13px (`icons/refresh.svg`, `icons/settings.svg`) with `tooltip` and `accessibility_label`. A missing image leaves the name and the percent.

`items` lists providers with Show on. With `showUnavailable` false, it skips a provider that has no lanes and skips a lane that has no windows and no credits. `sort === "remaining"` orders by headline remaining; missing headlines sort last (`101`). This sort is display-only.

Settings mutations go through `save` / `changeConfig` or `moveProvider`. Query and Show are independent. Turning consent on also force-polls. Select detected writes query and show from the detection list captured for `this.host()`, and never turns Muse on. Select none sets every provider's query and show to false.

The help view may display `quota-axi --provider codex --json --no-credential-refresh` and the keychain-prompt example. Those strings are not passed to `exec`.

## Copy

Every `i18n.js` entry is `[english, simplifiedChinese]`. `tr` uses index `1` when `config.language === "zh"`, otherwise index `0`. A missing key returns the key, so a new key must be added to `copy` before it is used.

Add both languages in the same edit. Status and error keys match the stored vocabulary: `paused`, `idle`, `loading`, `stale`, `fresh`, the lane statuses, the four `safeErrors`, and the three `reason` codes.

## Tests

`tests/ui.test.mjs` copies the Mod into a temp directory, rewrites `gpui-kit`, `gpui-base`, and `herdr` imports to `tests/mock-kit.mjs` and `tests/mock-host.mjs`, then constructs `QuotaManager`. Find controls with `attrs.id` and invoke `events.on_click`. Assert on `shared` state and `host.state.executions`, not on HTML.

A new control that changes preferences needs a click assertion. A new screen must render under the existing per-view test, which also asserts that the first paint does not call `exec` before consent. `tests/icons.test.mjs` reads `mods/quota-manager/icons/` and rejects external URLs, scripts, embedded images, and `currentColor` on provider tiles.
