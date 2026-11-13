# Code Reuse Thinking Guide

> **Purpose**: Stop and think before creating new code. Does it already exist?

Duplicated quota math is how a chip and a card start disagreeing. Search before adding a helper.

## Owners

| If you need | Use |
| --- | --- |
| The provider list, glyphs, or detection keys | `PROVIDERS`, `IDS`, `provider`, `assertProvider`, `detectedProviders` |
| A stored preference | `normalizeConfig` / `changeConfig` |
| Whether a subprocess may start | `selectedProviders` |
| Argv for quota-axi | `queryArgs` / `commandsFor` / `fetchQuota` |
| A lane, window, headline, or history row | `model.js` |
| A shared-state key | `stateKey` |
| A visible sentence | `tr` |
| A button, row, or card | `ui.js` builders |

`safeText`, `laneKey`, `validWindow`, `displayPercent`, and `headline` are the display contract. Do not reimplement the percent clamp or the share-row rule in `ui.js`.

## Before adding a function

- Does `model.js` already return this value?
- Is the constant already `INTERVALS`, `KINDS`, `QUERY_TIMEOUT`, or the lease duration inside `refreshOne`?
- Will a test and the UI both hard-code the same English string instead of the `i18n.js` key?
- Is this the second place that inspects `result.code` or `stdout`? The first place should stay `fetchQuota` / `parseReport`.

Abstract when the same rule is being copied into a third call site, or when a wrong copy would show a fabricated percentage. Do not extract a one-off settings callback out of `main.js` just to make that file shorter.

## After a multi-file edit

Search for the old id, key, and error string. Provider ids appear in `providers.js`, default selection in `config.js`, and fixtures in `tests/`. Error codes appear in `command.js`, `store.js` (`safeErrors`), and `i18n.js`.

Closed sets in this repo are enforced by allowlists, not by a type checker. Adding a status or a window kind means updating the allowlist and every `i18n.js` key that displays it. An unknown value must keep today's fallback (`unavailable`, `unknown`, or the default preference), not throw from `render`.
