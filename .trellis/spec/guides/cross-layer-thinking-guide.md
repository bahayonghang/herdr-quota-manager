# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

This repository has four boundaries. The contracts are in `.trellis/spec/mod/data-contracts.md` and `.trellis/spec/tooling/installer.md`.

```
quota-axi stdout
    → model.parseReport / normalizeReport
    → store cache under stateKey
    → main.js items()
    → ui.js nodes

stored preferences
    → config.normalizeConfig
    → selectedProviders / settings controls

provider id
    → providers.assertProvider
    → command.queryArgs

app home on disk
    → scripts/install.mjs staging, herdr-app check, rename
```

`main.js` is the only module that sees both the host (`exec`, `shared`, overlays) and the store. `ui.js` does not import `command.js` or `store.js`.

---

## Before Implementing

- What shape enters this function, and which function is allowed to validate it?
- Can a late `exec` result still be published after consent, revision, or machine changes?
- Does Show change collection, or only the tree? Does Query change the tree, or only `selectedProviders`?
- If the new field is persisted, what does old shared state look like when the field is missing?
- If the installer also needs to know, is that the install marker or is it shared state? They are different stores.

## After Implementing

- [ ] Invalid JSON, unknown schema, and a missing provider fail closed in `model.js`
- [ ] A remote failure does not call `exec` with `on: null`
- [ ] UI tests assert on `shared` or recorded `exec` calls, not on a private copy of the same math
- [ ] Both `i18n.js` languages gained the new key
- [ ] Installer tests still prove a failed native check does not move the live directory

---

## Mistakes that show up here

**Parsing stdout in the View.** `parseReport` already skips banners and rejects unknown schemas. A second parser will accept a payload the store does not know how to display.

**Filtering after an unscoped collection.** `selectedProviders` is the query list. Building `quota-axi` without `--provider`, then hiding rows, violates the consent gate.

**Treating process failure like auth failure.** A thrown `cli_*` error keeps the previous lanes and marks them stale. A parsed `auth_required` report replaces those lanes. Mixing them hides an account switch.

**Pinned machine drift.** The popup's `on` prop is captured at open. Detection, refresh, and history clear must use `this.host()`, which honors that pin.

**Installer editing product state.** `install.mjs` copies the Mod and writes `.quota-manager-install.json`. It does not migrate `quota-manager.v1.*` keys. Preference migration belongs in `normalizeConfig`.
