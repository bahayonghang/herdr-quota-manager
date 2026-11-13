# Upstream quota-axi snapshot

Inspected 2026-11-13 against https://github.com/kunchenguid/quota-axi and verified in `third_party/quota-axi`.

## Pin

- Repository: https://github.com/kunchenguid/quota-axi
- Pinned commit: `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`
- Committer date: 2026-10-29T14:16:56Z
- Message: `chore(main): release quota-axi 0.1.69 (#363)`
- `package.json` version: `0.1.69`
- `packageManager`: `pnpm@11.1.1`
- `type`: `module`
- `engines.node`: `>=22.19`
- bin `quota-axi`: `./dist/bin/quota-axi.js` (upstream CLI entry; not used for local Mod queries)
- `scripts.build`: `tsc`
- `scripts.dev`: `tsx bin/quota-axi.ts`
- dependencies: `@toon-format/toon@2.1.0`, `axi-sdk-js@^0.1.10`, `proxy-from-env@2.1.0`, `undici@6.29.1`
- `tsconfig.json` is comment-free JSON. `include` is `src/**/*.ts` and `bin/**/*.ts`. `outDir` is `dist`. `module` / `moduleResolution` are `Node16`.

## License

`LICENSE` is MIT and begins `Copyright (c) 2026 Kun Chen`.

## Tree choices

Top-level entries at that commit include `.airlock`, `.github`, `.gitignore`, `.no-mistakes.yaml`, `.no-mistakes`, `.prettierignore`, `.release-please-manifest.json`, `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `LICENSE`, `README.md`, `VISION.md`, `bin`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `release-please-config.json`, `scripts`, `skills`, `src`, `test`, `tsconfig.json`, `vitest.config.ts`.

Upstream `.gitignore` ignores `dist/`, `node_modules/`, coverage, and logs.

`scripts/check.mjs` parses every `.json` and syntax-checks every `.js` / `.mjs` outside `.git`, `node_modules`, and `third_party`. Skipping `third_party` keeps upstream ESLint configs and test fixtures outside this repo's Mod syntax gate, while every generated file inside `mods/quota-manager/` remains subject to `scripts/check.mjs` and `herdr-app check`.

## Local toolchain

- `node -v` → `v26.7.0` (satisfies `>=22.19`)
- `pnpm --version` → `12.20.0` (newer than the declared `pnpm@11.1.1`)
- `corepack` is not on PATH
- `quota-axi` is not on PATH and is not installed in the global npm prefix

Frozen install in `third_party/quota-axi` tries local `pnpm install --frozen-lockfile` first, falling back to `npm exec --yes --package pnpm@11.1.1 -- pnpm ...` only if pnpm rejects the lockfile version.

## Core query path vs Herdr Mod runtime

See `research/mod-runtime.md` for full empirical `herdr-app check` and `scripts/check.mjs` evidence:

- In `src/commands.ts`, `--json --provider <id> --no-credential-refresh --max-age <0|90s>` maps directly to `fetchQuota([id], { allowKeychainPrompt: false, refreshCredentials: false }, force ? 0 : 90)`, `providerPresence`, and `quotaJsonReport(response, false, laneAbsent)` (schema 5 or 6).
- Herdr's Mod runtime (`gpui-shell`) resolves relative `./` imports inside `mods/quota-manager/` and unprefixed built-ins (`"fs/promises"`, `"crypto"`, `"buffer"`, `"path"`, `"url"`, `"os"`), plus global `fetch`, `Buffer`, and `crypto`, while rejecting `../` outside the Mod directory, all `node:*` specifiers, bare npm packages, and synchronous `fs`.
- Therefore, local collection compiles and adapts the core `quota-axi` query graph into `mods/quota-manager/vendor/quota-axi/` so the Mod calls it directly in-process without `exec`, `node`, `query.mjs`, or upstream `bin/quota-axi.js`.
- Remote `exec` (`{ on: machine }`) runs on the named remote machine, so local Windows paths and local `fs/promises` / `fetch` cannot serve remote hosts; remote hosts retain `quota-axi` PATH lookup via `exec` with zero remote-to-local fallback.

## Collection state

Shared `quota-manager.v1.config` has `consent: false`. No cache keys are present. `C:\Users\lyh\.config\herdr-app\collectors\quota-manager` exists from an earlier rejected prototype and carries `.quota-manager-collector.json` (`"project": "herdr-quota-manager"`), which the updated installer will retire by moving aside to `.quota-manager-backups/`. Consent stays `false` throughout this task.
