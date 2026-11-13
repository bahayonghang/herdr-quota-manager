# Directory Structure

The Mod is one directory of plain ES modules. There is no `src/`, `components/`, bundler, or package dependency inside the Mod.

```
mods/quota-manager/
├── mod.json        # place, size, focusable, overlay size
├── main.js         # QuotaManager View: lifecycle, screens, keyboard
├── ui.js           # GPUI node builders
├── i18n.js         # en / zh copy
├── providers.js    # frozen allowlist
├── config.js       # preference normalization
├── command.js      # quota-axi invocation
├── model.js        # schema 5/6 normalization and display math
└── store.js        # leases, cache, history, alerts
```

Node-only code stays outside that directory:

| Path | May import `node:` | Role |
| --- | --- | --- |
| `scripts/install.mjs` | yes | install, uninstall, native preflight |
| `scripts/check.mjs` | yes | syntax, JSON, forbidden-API scan |
| `scripts/check-herdr.mjs` | yes | `herdr-app check` wrapper |
| `tests/*.mjs` | yes | `node:test` fixtures and host doubles |

`install.ps1` and `install.sh` only forward arguments to `scripts/install.mjs`.

## Where a change goes

| Change | File |
| --- | --- |
| Poll interval, overlay open/close, keyboard, settings actions | `main.js` |
| Chip, card, meter, button geometry | `ui.js` |
| A visible string | `i18n.js`, both languages in one tuple |
| A collector id or CLI detection key | `providers.js` |
| A stored preference field | `config.js`, then the settings control in `main.js` |
| Flags, timeout, or shell fallback | `command.js` |
| Window math, redaction, history row shape | `model.js` |
| Admission, backoff, persistence keys | `store.js` |
| Copying files into a Herdr app home | `scripts/install.mjs` |

## Do not add

- A second Mod directory, a generic shell-command setting, or an adapter interface before a second real collector exists. `fetchQuota` in `command.js` is the collector boundary.
- React components, hooks, CSS files, or a `package.json` dependency for the Mod. `package.json` at the repo root only runs tests and checks.
- Direct reads or writes of the physical `shared.json`. Persistence goes through `shared` / `setShared`.
