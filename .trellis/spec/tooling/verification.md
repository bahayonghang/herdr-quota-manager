# Verification

`package.json` requires Node `>=22.19.0`. The Mod has no dependencies. Tests import the source tree directly.

## Commands

| Command | What it runs |
| --- | --- |
| `just ci` | `npm run check`, `npm run test:coverage`, `node scripts/install.mjs --dry-run` |
| `npm run validate` | `npm run check` and `npm test` |
| `npm test` | `node --test` |
| `npm run test:coverage` | `node --experimental-test-coverage --test` |
| `npm run check:herdr` | `herdr-app check` on `mods/quota-manager`, or on the path in argv |

`just ci` matches the `test` job in `.github/workflows/ci.yml` (Ubuntu, Windows, macOS, Node 22.19.0). CI does not install the Mod and does not start Herdr.

`scripts/check.mjs` walks the repo except `.git` and `node_modules`:

- every `.json` file must parse
- every `.js` and `.mjs` file must pass `node --check`
- every `.js` file under `mods/quota-manager/` must not contain `setTimeout(`, `setInterval(`, `require(`, or a `node:` import

## Tests

Files: `tests/command.test.mjs`, `config` cases inside `tests/model.test.mjs`, `tests/store.test.mjs`, `tests/ui.test.mjs`, `tests/install.test.mjs`.

`tests/helpers.mjs` exports `NOW`, `report`, `setup`, `deferred`, and `flush`. `setup` puts a consented config in a `Map`, builds a `QuotaStore` with an in-memory `exec`, and records calls. Default `exec` returns schema 5 for the `--provider` argument. Pass `execute` to replace it.

Store and command tests call the real modules. UI tests do not import `mods/quota-manager/main.js` from the repo path, because that path imports `herdr`. They copy the Mod and rewrite those specifiers. Coverage of `main.js` and `ui.js` therefore does not show up as coverage of the original files. `docs/VALIDATION.md` already says this. Do not treat a coverage gap on those two files as a failed run.

What a new test should pin:

| Area | Assertion |
| --- | --- |
| Command | exact argv, no second spawn on exit 1, timeout does not fall through to another shell |
| Config | unknown ids and unknown enums disappear; Muse query stays off without `museConsent`; revision increments |
| Model | schema other than 5/6 throws; share and expired windows do not become a headline; raw account fields are absent |
| Store | no consent and Query off perform no `exec`; leases and the two-slot cap hold; revision mismatch drops the write |
| UI | element id receives the click; `shared` config actually changes; first render does not `exec` |
| Install | failed `check` leaves the previous directory in place; uninstall refuses a directory without the marker |

`npm run check:herdr` and `docs/VALIDATION.md` are still required before calling a Herdr build verified. Structural tests are not a screenshot.

## justfile

```just
just ci
just install [--app-home <path>] [--skip-native-check] [--dry-run]
just uninstall [--app-home <path>] [--dry-run]
```

Recipes call `node`. They do not reimplement copy, backup, or `herdr-app check`. Extra arguments are forwarded unchanged: `just install --dry-run`, not `just install -- --dry-run`. On Windows the justfile sets `windows-shell` to `pwsh.exe` because `sh` is not assumed to be on `PATH`. Unix keeps just's default shell.
