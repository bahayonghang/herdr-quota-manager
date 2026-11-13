# Installer

`scripts/install.mjs` is the only implementation. `install.ps1`, `install.sh`, and `just install` / `just uninstall` call it.

Exported for tests: `nativeCheck`, `installMod`, `uninstallMod`. The CLI runs only when the file is the process entry point.

## CLI

Default app home is `HERDR_APP_HOME`, otherwise `~/.config/herdr-app`.

| Flag | Effect |
| --- | --- |
| `--app-home <path>` | use this home instead of the default |
| `--skip-native-check` | install without `herdr-app check` |
| `--dry-run` | print the target path and exit. No version check, no copy |
| `--uninstall` | move an owned install aside |
| anything else | throw `Unknown or incomplete option` and exit 1 |

A real install checks `process.versions.node` and throws unless the version is at least 22.19. Dry-run and uninstall do not check the Node version. The Mod still does not download `quota-axi`. The success message tells the user to install `quota-axi@0.1.69` separately.

## Install

`installMod({ appHome, source, check, skipCheck })`:

1. Refuse a symlink or a non-directory at `<app-home>/mods/quota-manager`.
2. Copy `source` (default `mods/quota-manager`) to `<app-home>/.quota-manager-stage-<uuid>` with `dereference: false`.
3. Write `.quota-manager-install.json` containing `{ "project": "herdr-quota-manager", "version": "0.1.0" }`.
4. Unless `skipCheck`, call `check` on the staging directory. The default `nativeCheck` runs `herdr-app check <staging>` with a 30 second timeout. Failure throws before the live directory is moved.
5. If a current directory exists, `rename` it to `<app-home>/.quota-manager-backups/<timestamp>-<uuid>`.
6. `rename` staging onto the target. If that rename throws, move the backup back.
7. `finally` deletes staging if it is still there.

`nativeCheck` failure means the previous Mod, layouts, and `shared.json` were not modified. `--skip-native-check` must print that the install is not verified.

The installer does not edit `shared.json`, layout files, or `keys.json`.

## Uninstall

`uninstallMod(appHome)`:

- missing target returns `null`
- a symlink throws
- `.quota-manager-install.json` must parse and `project` must be `herdr-quota-manager`, otherwise throw
- `rename` the directory to `<app-home>/.quota-manager-backups/removed-<timestamp>-<uuid>`

Preferences and history keys stay in shared state. The CLI tells the user to remove a leftover layout block. It does not uninstall the global collector.

## Tests

`tests/install.test.mjs` passes a fake `check` and a temporary home. Keep using that. A test that calls the real `herdr-app` belongs in `npm run check:herdr`, not in the fixture suite.

When the marker shape or the backup directory changes, update `installMod`, `uninstallMod`, and the install tests in the same change. `main.js` does not read the marker.
