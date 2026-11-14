# UI

`ui.js` builds GPUI nodes from a normalized lane, a config object, and `theme()`. `main.js` chooses the screen and passes callbacks. Copy comes from `tr(config, key)` in `i18n.js`.

## Nodes

Builders used by the View: `button`, `line`, `text`, `note`, `row`, `column`, `meter`, `providerCard`, `quotaBar`, `quotaStrip`, `stripChip`, and the settings vocabulary `dialogHeader`, `segmented`, `switchControl`, `chip`, `ghostButton`, `iconButton`, `settingRow`, `group`, `providerRow`, `providerColumns`, `hintBlock`, `noticeBox`, `settingsPage`. `laneStatus` and `creditsText` return strings. `stripFace`, `pressureTone`, and `stripBudget` feed the strip. `popupPlacement` places the bar's popup. `main.js` imports no `gpui-kit` element or `gpui-base` layout builder: every node comes from `ui.js`.

- Colors, borders, and type sizes come from the theme argument (`foreground`, `muted`, `dim`, `border`, `chrome`, `popover`, `raised`, `selected`, `hover`, `accent`, `accent_foreground`, `background`, `ansi1`, `ansi2`, `ansi3`). Do not hard-code a palette. Tile fills live only in the SVG files.
- `button` sets `role("button")`, `accessibility_label`, and stops propagation on mouse-down and click. Clicks call `action(cx)`.
- Interactive nodes that tests click need a stable `id`: `open`, `chip-<provider>-<laneKey>`, `provider-<id>-<laneKey>`, `query-<id>`, `show-<id>`, `tab-usage`, `consent`, `muse-confirm`, `group-collect`, `group-providers`, `group-display`, `group-alerts`, `select-<id>`. Segment ids are `<control>-<value>` (`interval-300000`, `scope-local`, `language-zh`). The empty lane uses the suffix `empty`.
- `row` is `h_flex` and `column` is `v_flex`, both with `gap(6)` unless a call site overrides it.

`meter` uses `displayPercent`. `null` draws an empty bar and a caption (`resetDue`, `unknown`, `shared`, or the percentage mode). It does not draw `0%` for unknown data. Share bars use `t.muted`. Remaining uses `ansi1` at or below 10, `ansi3` at or below 25, otherwise `ansi2`. That scale is `tone()`. `pressureTone` is strip-only and is not called from `meter()` or `providerCard()`. It classifies used pressure of the same window: `ansi1` at used ≥ 80, `ansi3` at used ≥ 50, otherwise `ansi2`. Printed digits stay `displayPercent`.

`stripFace` is the only strip color procedure. Order: consent or query off (`paused`, cached digits in `t.muted` or `—` in `t.dim`); else busy (`loading`, same split); else no numeric headline and a failed status or `snapshot.error` (`—` in `t.ansi1`); else no numeric headline (`—` in `t.dim`, one key from idle, filtered, shared before a passed reset, resetDue, unknown); else a numeric headline that is failed, not fresh, or stale (digits in `t.muted`); else `pressureTone` with key `fresh`. There is no visible ` !`.

`laneStatus` order: paused when Query is off or consent is off, then `snapshot.error`, then `idle` when there is no lane, then the lane status when it is not `fresh`, then `stale` from `isStale`, otherwise `""`. Cards and meters still use it. The strip does not.

`stripChip` always shows the provider name beside a 14px mark. The percent is `stripFace`'s text (`—` when there is no numeric headline). The tooltip carries the provider, the plan when the lane has one, account suffix, window, percent, mode, the `stripFace` key, and the countdown. It does not append ` !`.

## Screens

`render` switches on `this.screen`:

| Screen | Root id | Contents |
| --- | --- | --- |
| `bar` | `quota-manager-bar` | status row: `machine-label`, optional `branch-label`, `agent-count`, trailing `quota-slot` / `quota-strip`, then `palette`. `open` only when `items.length === 0` |
| `usage` | `quota-manager-dialog` | consent note, compact/detailed, cards |
| `settings` | same dialog | four `group` cards: `group-collect` (consent switch, machine, interval), `group-providers` (detect / select detected / none in the group header, hints, Query and Show columns, provider rows), `group-display` (percentage, order, language, window kinds, unavailable), `group-alerts` (threshold, history), then the privacy line |
| `history` | same dialog | snapshot rows and `clear-history` |
| `help` | same dialog | pinned collector commands as text, not buttons that run them |

The dialog header is `dialogHeader`: the title, `· <machine>` in `t.dim`, then the `help` (`?`) and `close` (`×`) icon buttons. Below it, the tabs are one `segmented` control (`tab-usage`, `tab-settings`, `tab-history`); no tab is selected on `help`. The settings vocabulary follows Herdr's `better-config` mod: `switchControl` is a 36 x 20 pill (on: `accent` track and `accent_foreground` knob; off: `background` track with a `border` hairline and a `muted` knob, because a `hover` track vanishes on a `raised` card); `segmented` is a `background` well with a `raised`, bordered selected segment; `settingRow` puts the title and a one-line hint on the left and the control on the right (`stacked` puts a wide control below). A `group` title sits outside its `raised`, bordered card; every row after the first draws a `border_t` hairline. Provider rows keep the keyboard selection on `t.hover` plus a 2px `accent` tick. They never use `t.selected`, which is the old on-button fill and swallowed the toggles. `up-<id>` / `down-<id>` render only on the selected row and only while `sort` is `custom`. A press on a row selects it, and moving a provider moves the selection with it. Query and Show switches sit in fixed 48px columns under one column header. The bar fills the layout's existing 28px status block. It uses `t.chrome`, a top border, and `text_size` 11.8. `main.js` does not import `h_flex`. `quotaBar` places `quotaStrip` in `quota-slot` (`flex_1`, `justify_end`), so the chips sit immediately left of `palette`. The strip has no background and no border. It packs a 14px mark, the name, the percent, and an optional countdown. Every chip has the same parts: the plan never sits on the chip, because providers report it unevenly (Codex does, Grok does not). The plan goes into the tooltip after the name and stays on the Usage card. `fitStrip` measures the slot width from `on_size_change` and drops the countdown (tier 0 to tier 1), then whole chips from the end. Width 220 still shows `overflow` and does not show the empty control. All shows off paints `open` (`stripEmpty`), `bar-refresh`, and `bar-settings`, and does not paint `overflow`. `palette` runs `app.palette`. Strip controls report their press bounds through `onAnchor`; `quotaBar` and `quotaStrip` report their own bounds through `onBarBounds` and `onStripBounds` from `on_mouse_move`; `runtime-boundary.md` describes how `open` turns them into a popup above the bar.

`place` is `none`. One layout block with `content.mod` `quota-manager` replaces `workspace-status`. A second block repeats the whole row. The installer does not write that layout.

Provider marks are 14px, on the chip and the card header. `BRAND` in `ui.js` points at Herdr's shipped files: `image("icons/codex.svg")` and `image("icons/antigravity.svg")` keep their colors; `svg("icons/grok.svg")` and `svg("icons/cursor.svg")` use `t.foreground`. The same split covers Claude, Copilot, Kimi, OpenCode Go, and Command Code. Every other id uses `image("mods/quota-manager/icons/<id>.svg")`, the local two-letter tile. This repository does not copy Herdr's icon files. Refresh and settings are `svg()` masks at 13px (`icons/refresh.svg`, `icons/settings.svg`) with `tooltip` and `accessibility_label`. A missing image leaves the name and the percent.

`items` lists providers with Show on. With `showUnavailable` false, it skips a provider that has no lanes and skips a lane that has no windows and no credits. `sort === "remaining"` orders by headline remaining; missing headlines sort last (`101`). This sort is display-only.

Settings mutations go through `save` / `changeConfig` or `moveProvider`. Query and Show are independent. Turning consent on also force-polls. Select detected writes query and show from the detection list captured for `this.host()`, and never turns Muse on. Select none sets every provider's query and show to false.

The scope control uses `setScope`: explicit Local re-pins the current popup to null immediately; explicit Current captures the active space's machine. A later active-space change alone must not re-pin the popup. All manual refresh controls/keys/commands call `poll(..., true)`, which opens settings without collecting when consent or the requested Query selection blocks the request. Automatic polling does not open overlays.

The help view may display `quota-axi --provider codex --json --no-credential-refresh` and the keychain-prompt example. Those strings are not passed to `exec`.

## Copy

Every `i18n.js` entry is `[english, simplifiedChinese]`. `tr` uses index `1` when `config.language === "zh"`, otherwise index `0`. A missing key returns the key, so a new key must be added to `copy` before it is used.

Add both languages in the same edit. Status and error keys match the stored vocabulary: `paused`, `idle`, `loading`, `stale`, `fresh`, the lane statuses, the four `safeErrors`, and the three `reason` codes.

## Tests

`tests/ui.test.mjs` copies the Mod into a temp directory, rewrites `gpui-kit`, `gpui-base`, and `herdr` imports to `tests/mock-kit.mjs` and `tests/mock-host.mjs`, then constructs `QuotaManager`. Find controls with `attrs.id` and invoke `events.on_click`. Assert on `shared` state and `host.state.executions`, not on HTML.

A new control that changes preferences needs a click assertion. A new screen must render under the existing per-view test, which also asserts that the first paint does not call `exec` before consent. `tests/icons.test.mjs` reads `mods/quota-manager/icons/` and rejects external URLs, scripts, embedded images, and `currentColor` on the local fallback tiles. Branded marks are path strings into Herdr's `icons/` directory, so that test does not read those files.
