# Upstream

This directory is a snapshot of [quota-axi](https://github.com/kunchenguid/quota-axi) so this project can customize the collector later.

- Project: https://github.com/kunchenguid/quota-axi
- Commit: `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`
- Version: 0.1.69
- Commit date: 2026-10-29
- License: MIT
- Copyright: Copyright (c) 2026 Kun Chen
- Retrieved: 2026-11-13

The nested git history was removed. Changes to this tree are committed in herdr-quota-manager. Do not auto-update the snapshot. A later refresh replaces the tree at a new reviewed commit and updates this file in the same change.

Omitted from the snapshot: `.git`, `.github`, `.airlock`, `.no-mistakes`, `.no-mistakes.yaml`, `.release-please-manifest.json`, and `release-please-config.json`.

`dist/`, `node_modules/`, and `.deploy/` stay untracked.

`scripts/build-vendor.mjs` (also invoked during `just install`) compiles this snapshot and generates Herdr-compatible ES modules under `mods/quota-manager/vendor/quota-axi/` so the Mod calls the core `quota-axi` query logic directly in-process without launching `dist/bin/quota-axi.js` or a standalone `node` wrapper script.
