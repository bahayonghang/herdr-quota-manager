# Bottom-right quota strip — technical design

Normative detail, snippets, fitter arithmetic, icon hex table, and test rows live in `research/design-c6579289.md`. That file is the approved `/design` document (`c6579289`, review round 3, 0 open issues). Implement from its Proposed Design, API / Interface Changes, and PR Plan. This file is the task boundary. If the two disagree, the research document wins until the user changes it.

## Boundaries

`main.js` keeps the View, `cx.spawn`, polling, and host calls. The bar branch becomes an outer `row().justify_end()` plus `quotaStrip` from `ui.js`. `main.js` does not import `h_flex`.

`ui.js` owns the pill, `stripFace`, `pressureTone`, `stripBudget`, `fitStrip`, `quotaStrip`, and `stripChip`. `tone()`, `meter()`, and the card percent stay on remaining thresholds. `pressureTone` is not called from `meter()` or `providerCard()`.

`command.js`, `model.js`, `store.js`, `config.js`, `providers.js` behavior, `mod.json`, `scripts/install.mjs`, and `shared.json` do not change. `glyph` stays on each provider so PR 2 does not churn the allowlist.

## Placement

`mod.json` stays `"place": "bottom"`, `"size": 30`. Herdr does not content-size that slot. Alignment is `justify_end` on the outer row. The pill is `flex_none()` and 24px tall, so it does not grow into a full-bleed toolbar.

On this machine the kept block is `b8aab61ac55b114d2a384835d2b0157db` in `C:\Users\lyh\.config\herdr-app\layouts\main-quota.json`. Delete only the child of column `work` whose id is `quota-manager`. Do not `layout.hide` it. Do not edit shipped `main.json`, `terminals.json`, or `win98.json`.

A first automatic dock into a shipped layout is wiped on the next start and is not recreated. A durable strip is one block on a personal layout. `README.md` lines 46–57 and `RECIPE.md` line 14 say that, with no JSON block to paste.

## What the pill paints

Reading order: 14px mark, provider name, optional plan (`max_w(64)`), percent, optional countdown. No thin meter. No visible ` !`.

PR 1 mark: `p.glyph` at `text_size(8)` inside `w(14).h(14).overflow_hidden()`. Refresh and settings are text `↻` and `⚙`, 13px, `px(0)`, with `tooltip` and `accessibility_label` from `tr(cfg, "refresh")` and `tr(cfg, "settings")`.

PR 2 mark: `image("mods/quota-manager/icons/<id>.svg").w(14).h(14)`. Chrome children become `svg(...).size(13).text_color(t.muted)` inside the same controls. Tooltip and `accessibility_label` stay. The card header monogram uses the same `image()`. Do not also draw `p.glyph` beside a loaded image.

`open` and `overflow` use `text_size(11)`, `px(4)`, and no vertical padding. `open` renders only when `items.length === 0`. Width 220 still has `capacity === 0` (`226 > 220`): `overflow`, refresh, and settings, and no `open`.

Overflow drops countdown, then plan, then whole chips from the end. Empty label is new i18n key `stripEmpty`: `Choose providers` / `选择服务`.

## Color

`stripFace` is the only strip color procedure. Order:

1. Consent off or query off: cached digits in `t.muted`, or `—` in `t.dim`. Key `paused`. This wins over `busy` and `snapshot.error`.
2. Else `item.busy`: same digit split. Key `loading`.
3. Else no numeric headline, and `snapshot.error` or status in `unavailable`, `auth_required`, `rate_limited`, `error`: `—` in `t.ansi1`. Key is the error key or the status. No raw stderr.
4. Else no numeric headline: `—` in `t.dim`. One key from `nullHeadlineKey`: idle, filtered, shared (before a passed reset), resetDue, unknown.
5. Else numeric headline and error, non-fresh, or stale: digits in `t.muted`.
6. Else `pressureTone`. Round only when `displayPercent` is a number.

`pressureTone` classifies used pressure of that window. Remaining mode `64` prints `64%` and is `ansi2` because used is 36. Inclusive thresholds: `ansi1` at used ≥ 80, `ansi3` at used ≥ 50, else `ansi2`. Tokens come from the theme. No hex literals in JavaScript.

## Icons

Nineteen provider SVGs plus `settings.svg` and `refresh.svg`, under `mods/quota-manager/icons/`. Provider files are original two-letter tiles, drawn with `image()` so source colors survive. Chrome files use `currentColor` and `svg()`. No network, no `window()` on the paint path. A missing image leaves the name and percent. `herdr-app check` must still pass when the staging path cannot resolve the icon.

Asset test bans `currentColor` on provider files, and bans `script`, `foreignObject`, `image`, `use`, `http:`, `https:`, `javascript:`, `data:`, and `on…=` on all of them. `size` is added to `tests/mock-kit.mjs` in PR 2, the same change that calls it.

## Compatibility and rollback

Installing the mod does not rewrite the layout, so the duplicate remains until the local delete. Restoring a mod backup restores the old toolbar inside whatever blocks remain. Restoring the pre-edit `main-quota.json` brings the upper row back. Leave the extra block deleted across a mod rollback, or the duplicate toolbar returns.

`docs/VALIDATION.md` stays generic: one block on the shown personal layout, one trailing pill in the shot, consent off does not `exec`, a narrow window shows `+N`. It does not name this machine’s layout path or block id.

## Trade-off

The bottom slot stays full width because Herdr’s `place: "bottom"` block is not content-sized. The visible control is the trailing pill. A floating content-sized block, `place: "none"`, and hiding one copy in `render` were rejected in the design document: the first fights the dock, the second removes the only automatic slot, and the third leaves the extra poll running.
