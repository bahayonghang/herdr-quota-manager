# Third-party notices

The Herdr GPUI Mod UI, preferences, and shared-state scheduling in this repository are written here and licensed under MIT. `third_party/quota-axi` is a vendored snapshot of upstream quota-axi, and `mods/quota-manager/vendor/quota-axi/` holds the core quota-query modules compiled and adapted from that snapshot (preserving upstream `LICENSE` and file-level attribution) so the Mod can query directly without spawning an external CLI. That code remains under its own MIT license. This repository does not bundle Orca, Herdr, their binaries, fonts, brand artwork, or credentials.

Design references:

- Herdr's native Mod guide and host type declarations: https://github.com/herdrdev/herdr-app
- quota-axi CLI and normalized quota schema: https://github.com/kunchenguid/quota-axi
- Lakris2407's native quota Mod: https://github.com/Lakris2407/herdr-mods/tree/main/quota
- Orca's Usage roster / status-bar interaction: https://github.com/stablyai/orca

quota-axi is MIT-licensed. The snapshot in `third_party/quota-axi` is version 0.1.69 at commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, Copyright (c) 2026 Kun Chen. Its `LICENSE`, `README.md`, and `UPSTREAM.md` stay with the snapshot. See that `LICENSE` for the upstream grant. No provider-fetcher or React/Electron implementation from Orca is copied into this repository. Codex, Antigravity, Grok, Cursor, and the other branded marks are referenced from Herdr's shipped `icons/` directory. This repository does not copy those files. Providers without a shipped mark keep a local two-letter tile. No trademark rights are granted.

Product and provider names identify compatibility targets; they do not imply affiliation or endorsement. Consult each upstream repository's license before copying additional code, assets, or documentation into this project.
