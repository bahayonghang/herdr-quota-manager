# Directory Structure

The Mod is one directory of plain ES modules. There is no `src/`, `components/`, bundler, or package dependency inside the Mod.

```
mods/quota-manager/
├── icons/            # fallback monogram tiles, plus refresh and settings masks
├── vendor/quota-axi/ # generated core quota-axi query modules + runtime shim + LICENSE (via scripts/build-vendor.mjs)
├── mod.json          # place, size, focusable, overlay size
├── main.js           # QuotaManager View: lifecycle, screens, keyboard
├── ui.js             # GPUI node builders
├── i18n.js           # en / zh copy
├── providers.js      # frozen allowlist
├── config.js         # preference normalization
├── command.js        # local vendor invocation + remote quota-axi commands
├── model.js          # schema 5/6 normalization and display math
└── store.js          # leases, cache, history, alerts
```

Node-only code stays outside that directory:

| Path | May import `node:` | Role |
| --- | --- | --- |
| `scripts/install.mjs` | yes | install, uninstall, native preflight, retire owned collectors |
| `scripts/build-vendor.mjs` | yes | compile `third_party/quota-axi` & emit `mods/quota-manager/vendor/quota-axi/` |
| `scripts/check.mjs` | yes | syntax, JSON, forbidden-API scan |
| `scripts/check-herdr.mjs` | yes | `herdr-app check` wrapper |
| `tests/*.mjs` | yes | `node:test` fixtures and host doubles |
| `third_party/quota-axi/` | upstream package | Vendored quota-axi 0.1.69 snapshot (`scripts/check.mjs` skips this tree) |

`scripts/check.mjs` also skips a directory named `third_party`. `third_party/syntax-skip/` holds an invalid `.js` and `.json` so a walker that enters `third_party` fails.

`install.ps1` and `install.sh` only forward arguments to `scripts/install.mjs`.

## Where a change goes

| Change | File |
| --- | --- |
| Poll interval, overlay open/close, keyboard, settings actions | `main.js` |
| Chip, card, meter, button geometry | `ui.js` |
| A provider tile or chrome mask | `mods/quota-manager/icons/` |
| A visible string | `i18n.js`, both languages in one tuple |
| A collector id or CLI detection key | `providers.js` |
| A stored preference field | `config.js`, then the settings control in `main.js` |
| Local query invocation, remote flags, or shell fallback | `command.js` |
| Window math, redaction, history row shape | `model.js` |
| Admission, backoff, persistence keys | `store.js` |
| Copying files into a Herdr app home & retiring old collectors | `scripts/install.mjs` |
| Vendor bundle build & Herdr runtime shim | `scripts/build-vendor.mjs` -> `mods/quota-manager/vendor/quota-axi/` |
| Collector source, lockfile, and upstream note | `third_party/quota-axi/` |

## Do not add

- A second Mod directory, a generic shell-command setting, or an adapter interface before a second real collector exists. `fetchQuota` in `command.js` is the collector boundary.
- React components, hooks, CSS files, or a `package.json` dependency for the Mod. `package.json` at the repo root only runs tests and checks.
- Direct reads or writes of the physical `shared.json`. Persistence goes through `shared` / `setShared`.
