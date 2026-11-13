# Tooling

Node-side checks, tests, and the installer. None of this code is loaded by Herdr.

---

## Guidelines Index

| Guide | Use it when |
| --- | --- |
| [Verification](./verification.md) | Running or changing CI, `just`, or tests |
| [Installer](./installer.md) | Changing install, uninstall, backup, or native preflight |

---

## Pre-Development Checklist

- [ ] Keep install behavior in `scripts/install.mjs`. `install.ps1`, `install.sh`, and the `justfile` only forward to it
- [ ] A new installer flag is parsed in `main` and covered in `tests/install.test.mjs`
- [ ] A new check in `scripts/check.mjs` has a fixture that would fail the old scan
- [ ] Do not add a runtime npm dependency. The Mod has none

---

## Quality Check

- `just ci` is the local equivalent of `.github/workflows/ci.yml`
- `npm run validate` is the shorter loop: `scripts/check.mjs` plus `node --test`, without coverage
- Installer tests use a temporary app home. They must not write `~/.config/herdr-app`
- `npm run check:herdr` needs a local `herdr-app`. CI does not run it
