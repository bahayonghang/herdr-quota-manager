# Bottom-right quota strip

## Correction (2026-11-12, after the first live window)

The separate 30px row shortens the terminal. The chips belong in the existing status row, packed against the left side of the command hint. `place` is `none`. The personal layout's status block uses `quota-manager`, and the extra bottom block is removed. Marks for Codex, Antigravity, Grok, Cursor, and the other providers Herdr already ships use `icons/<file>.svg` from the Herdr home. Local two-letter tiles remain only where Herdr has no icon. Requirements 1–3 and 8 below are superseded by this correction. The installer still does not write layouts.

## Goal

The Herdr window shows one quota line, packed to the bottom-right, with a colored mark for each provider. The second copy above the workspace status line is gone.

The user value is the same as the Over9k footer: identity, plan, percent, and reset time on one short line, before the limit is hit. The digits stay the percent the mod already prints.

## Background

On 2026-11-12 the live window used personal layout `main-quota` (`cloned_from` shipped `main` 0.1.15). Two blocks both mount `quota-manager`:

- Hand-inserted block id `quota-manager`, child of column `work`, directly above `workspace-status`. This is the upper row in the screenshot.
- Auto-dock block id `b8aab61ac55b114d2a384835d2b0157db`, last child of outer column `r9e696357aa1b6319f4b71252502fcedb`. `mod.json` has `"place": "bottom"` and `"size": 30`. This is the row at the window bottom.

A hidden block still polls. The mod cannot tell the two copies apart. Shipped layouts `main`, `terminals`, and `win98` are replaced on start. Herdr docks a newly seen mod once, into the layout that is shown. A dock written into a shipped layout does not survive the next start, and Herdr does not dock again.

`chip()` in `mods/quota-manager/ui.js` paints a text button: glyph or name, then a percent. `tone()` colors meters and cards from remaining (≤10, ≤25). The default displayed percent is remaining. Alerts compare `w.remaining` with the stored threshold.

Normative visual and color detail is `.trellis/tasks/11-12-bottom-right-quota-strip/research/design-c6579289.md` (approved `/design` document, review round 3, 0 open issues).

## Requirements

1. The current `main-quota` window shows a single quota strip, in the bottom dock, with the chips packed to the trailing edge.
2. On this machine, remove only the hand-inserted block id `quota-manager` from `C:\Users\lyh\.config\herdr-app\layouts\main-quota.json`. Keep block `b8aab61ac55b114d2a384835d2b0157db`. Copy the layout file before the edit. This edit is local rollout. It is not installer behavior and it is not a commit.
3. The installer, `mod.json`, shipped layouts, keybindings, and `shared.json` stay unchanged.
4. The strip is one 24px rounded line inside the existing 30px bottom slot: mark, provider name, optional plan, percent, optional countdown. Refresh and settings stay on that line. Chip click still opens the usage overlay.
5. When the line is too narrow, drop the countdown, then the plan, then whole chips from the end, and show `+N`. Width 220 shows `overflow` and does not show the empty control. The empty control (`stripEmpty`) appears only when there are no items, together with refresh and settings.
6. Printed digits stay `displayPercent`. Default remaining `64%` stays the text `64%`. Color follows used pressure of that same window: under 50 used is `ansi2`, from 50 is `ansi3`, from 80 is `ansi1`. Card meters and alert thresholds stay on the remaining scale.
7. Consent off or query off does not start a collector. Show off hides that provider. A `shareOf` window has no remaining percent. A passed reset does not refill a bar. Percents are not added across windows or providers.
8. PR 1 paints the existing two-letter glyph in a 14px slot beside the name. PR 2 replaces that slot, and the card header monogram, with a colored tile SVG drawn by `image()`. Tiles are original letter marks for every id in `providers.js`. They are not vendor logos and they are not loaded from the network. Refresh and settings become `svg()` masks only in PR 2.
9. `README.md` (lines 46–57) and `RECIPE.md` (line 14) stop telling the reader to paste a second `quota-manager` block. A durable strip lives on a personal layout. A hidden block still polls.
10. New visible copy is the `stripEmpty` pair in both languages. Existing error text stays on i18n keys. The strip does not persist emails, tokens, raw errors, remedy commands, or stderr.

## Acceptance Criteria

- [ ] `herdr-app status` reports layout `main-quota`, and `herdr-app shot` shows one trailing quota line at the bottom of the window. The row above workspace status is absent.
- [ ] `C:\Users\lyh\.config\herdr-app\layouts\main-quota.json` contains `b8aab61ac55b114d2a384835d2b0157db` and does not contain a block whose id is `quota-manager`. A copy of the file from before the edit exists outside the mod backup tree.
- [ ] A fresh remaining-mode window at 64 remaining / 36 used renders the text `64%` in `ansi2`. Remaining 20 renders `20%` in `ansi1`. Used-mode 50 renders `50%` in `ansi3`. The same remaining-40 window is `ansi3` on the strip and `ansi2` on the card percent.
- [ ] Consent off with a cached headline keeps the digits and uses muted color, with no `!`. Consent off with no headline shows `—` in `dim`. Share-only with consent and query on shows `—` and the `shared` key, not `resetDue`.
- [ ] The width-220 bar has `overflow` and does not have `open`. All shows off has `open`, `bar-refresh`, and `bar-settings`, and does not have `overflow`.
- [ ] Consent off does not `exec`. Query off removes that provider before any subprocess. Muse still requires `museConsent`.
- [ ] `npm test` covers the rows above. `just ci` passes. `npm run check:herdr` passes when `herdr-app` is on `PATH`.
- [ ] `scripts/install.mjs` still does not write layouts, keybindings, or `shared.json`. `git diff` for the task does not touch `command.js`, `model.js`, `store.js`, `config.js`, `mod.json`, or shipped layout files.
- [ ] After PR 2, each default chip’s mark is `mods/quota-manager/icons/<id>.svg` via `image()`, and `tests/icons.test.mjs` rejects external URLs, scripts, and embedded images in those files.

## Out of Scope

- Collector command, schema 5/6 parsing, exit-code handling, consent rules, Muse confirm, leases, cache keys, and history.
- Recoloring overlay meters or moving alerts onto the 50/80 scale.
- Account login, credential refresh, inference opt-in, cookie import, profiles, drag-and-drop order, billing charts.
- Automatic layout or keybinding edits, including any installer change that would insert or delete a block.
- Copying Over9k chrome or vendor logomarks.
- A preference that restores the old full-width toolbar.

## Decisions

- Keep the auto-dock. Delete the hand-inserted block locally. The installer does not do that delete.
- Overlay meters stay on `tone()`. The strip uses `pressureTone` only for its own digits.
- Refresh stays on the pill. The control is the text glyph in PR 1 and a 13px `svg()` mask in PR 2.
