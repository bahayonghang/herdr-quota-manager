# Bottom-right quota strip — implementation plan

Follow `research/design-c6579289.md` for snippets, the `stripFace` procedure, the fitter, the icon table, and the assertion table. The PRD is already filled. Do not create another task directory.

Do not start until `task.py start` has moved this task to `in_progress`.

## Checklist

1. PR 1, repo only.
   - `mods/quota-manager/ui.js`: add `stripFace`, `pressureTone`, `stripBudget`, `fitStrip`, `quotaStrip`, `stripChip`. Leave `tone()` on the card and meters. Pill is `flex_none`.
   - `mods/quota-manager/main.js`: bar branch becomes outer `row().justify_end()` plus `quotaStrip`. No `h_flex` import.
   - `mods/quota-manager/i18n.js`: `stripEmpty` in both languages.
   - `tests/ui.test.mjs`: assertion table from the design API section, including width 220 without `open`, all-show-off without `overflow`, remaining 64 as `64%` / `ansi2`, remaining 40 as strip `ansi3` and card `ansi2`, both consent-off rows, and the share-only row with consent and query on.
   - `tests/mock-kit.mjs`: `justify_end`, `justify_center`, `border`, `max_w`, `truncate`, `whitespace_nowrap`.
   - `tests/mock-host.mjs`: `dim` on `theme()`.
   - `.trellis/spec/mod/ui.md`: bar, `stripFace` order, both color functions, `open` only when `items.length === 0`.
   - `docs/VALIDATION.md`: generic shot and one-block note. No absolute layout path and no generated block id.
   - `README.md` lines 46–57 and `RECIPE.md` line 14: personal-layout rules, no JSON block to paste.
   - No `svg()`, no `.size()`, no icon files, no layout file in the commit.
2. PR 2, repo only, after PR 1.
   - `mods/quota-manager/icons/*.svg`: 19 letter tiles plus `settings.svg` and `refresh.svg`, colors and bans from the design icon table.
   - `ui.js`: 14px `image()` in the mark slot and the card header. Chrome children become `svg().size(13).text_color(t.muted)`. Keep tooltip and `accessibility_label`.
   - `tests/mock-kit.mjs`: export `image` and `svg`, and allow `size`.
   - `tests/ui.test.mjs`: default chips reference `mods/quota-manager/icons/<id>.svg`.
   - `tests/icons.test.mjs`: asset bans.
   - `THIRD_PARTY_NOTICES.md`: one sentence that the tiles are monograms, not vendor logos.
   - `.trellis/spec/mod/ui.md`, `directory-structure.md`, `runtime-boundary.md`: icons directory; `ui.js` may import `image` and `svg` from `gpui-kit`.
   - Do not change `fitStrip`, `stripFace`, `pressureTone`, or the 13px chrome budget.
3. Validate the repo: `just ci`, then `npm run check:herdr` when `herdr-app` is on `PATH`.
4. Install with `just install` (or `node scripts/install.mjs`). Confirm the script does not rewrite layouts.
5. Local layout, after install, on this machine only.
   - Copy `C:\Users\lyh\.config\herdr-app\layouts\main-quota.json` to a path outside the mod backup tree.
   - Delete the single child of column `work` whose id is `quota-manager`.
   - Leave `b8aab61ac55b114d2a384835d2b0157db`.
   - `herdr-app status` still reports `main-quota`.
   - `herdr-app shot` shows one trailing pill and no row above workspace status.
6. Update specs if implementation discovers a contract the research document missed. Use `trellis-update-spec`. Do not edit product code to paper over a failed check.
7. Phase 3.4 commit only after the checks above. Do not push unless the user asks.

## Validation commands

- `npm test`
- `just ci` (`npm run check`, `npm run test:coverage`, `node scripts/install.mjs --dry-run`)
- `npm run check:herdr`
- `herdr-app status`
- `herdr-app shot <path>`

## Rollback

- Mod: restore the previous directory from `<app home>/.quota-manager-backups/<timestamp>-<uuid>`. That brings the old toolbar back inside the blocks that still exist.
- Layout: copy the step-5 backup over `main-quota.json`.
- If the kept block is deleted, Herdr will not dock it again. Restore the layout copy. Do not expect `just install` to recreate it.
- A failed `herdr-app check` aborts the swap. The previous mod and both layout blocks stay.

## Risky files

- `mods/quota-manager/ui.js` and `main.js` — the whole visible bar.
- `C:\Users\lyh\.config\herdr-app\layouts\main-quota.json` — one-time local edit, outside git. Wrong id deletes the only dock.
- `README.md` / `RECIPE.md` — leftover “add this block” text recreates the duplicate.
