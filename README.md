# Herdr Quota Manager

Selectable provider quota monitoring for the **native Herdr desktop app**. This is a GPUI Mod, not a Herdr TUI plugin, React application, or Orca fork.

[中文说明](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Validation](docs/VALIDATION.md)

## What it does

| Capability | Behavior |
| --- | --- |
| Provider selection | Independent **Query** and **Show** switches. Query OFF excludes the provider from collection; Show OFF only hides its rows. |
| Status bar | Compact provider chips, overflow button, refresh, and settings. Uses the current Herdr theme. |
| Usage popup | Compact / Detailed, remaining / used percentages, reset countdowns, source timestamps, and explicit failure/stale states. |
| Ordering | Custom order with ↑ / ↓ buttons and Ctrl+↑ / Ctrl+↓, or least remaining first. |
| Windows | Session, weekly, monthly, model, credit, and unknown-window filters. No fabricated percentages for balances. |
| Accounts | Preserves separate account lanes returned by quota-axi schemas 5/6; labels are pseudonymous, not account emails. |
| Scheduling | Manual-only or 1 / 2 / 5 / 10 minutes; bounded concurrency, shared leases, retry backoff, Retry-After, and a manual-refresh cooldown. |
| Machines | Follow the current space or use this computer. A popup stays pinned to its original machine. Remote failures never fall back to local credentials. |
| History / alerts | Opt-in local quota snapshots and low-remaining alerts at 5 / 10 / 20%. Both are disabled initially. |
| Language | English and Simplified Chinese. |
| Installation | Windows/macOS/Linux installer, native preflight, backups, and reversible uninstall. No automatic layout/keybinding rewrites. |

The catalog contains Codex, Antigravity (`agy`), Grok, Cursor, Claude, Copilot, Kimi, OpenCode Go, Z.AI, MiniMax, Alibaba, Command Code, MiMo, DeepSeek, OpenRouter, ElevenLabs, Devin, Muse, and Higgsfield. Actual quota availability depends on the provider, account, installed CLI, and quota-axi support; catalog membership is not a live-account compatibility certification.

## Install

Requirements: Herdr desktop with the APIs in its installed `herdr.d.ts`, **Node.js 22.19+**, and pnpm (used at build/install time). The Mod itself has no npm runtime dependencies. This repository vendors the MIT-licensed quota-axi 0.1.69 snapshot at `third_party/quota-axi` (commit `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, Copyright (c) 2026 Kun Chen); `scripts/build-vendor.mjs` compiles and adapts its core query modules into `mods/quota-manager/vendor/quota-axi/` so local quota queries execute directly in-process inside the Mod. A remote machine still needs quota-axi on its PATH and a provider sign-in of its own.

```sh
git clone https://github.com/bahayonghang/herdr-quota-manager.git
cd herdr-quota-manager
node scripts/install.mjs
```

The last command also works in PowerShell. `install.ps1` and `install.sh` are convenience wrappers. The default home is `$HERDR_APP_HOME`, otherwise `~/.config/herdr-app`; an explicit location can be supplied:

```sh
node scripts/install.mjs --app-home "C:\Users\Your Name\.config\herdr-app"
```

The installer checks a staging copy with `herdr-app check` **before** changing an existing install. If Herdr cannot be found on PATH or the check fails, it stops and leaves the old Mod untouched. Add the installed Herdr executable's directory to PATH and retry. `--skip-native-check` is an explicit development escape hatch, not a verified installation.

The quota chips sit in the existing status row, immediately left of the command hint. Click the settings mark, enable **Query** for the providers you want, choose **Local** to read this computer, then **Start selected queries**. **Show** only controls visibility. Refresh while collection is paused or no requested provider is selected opens settings; it never grants consent. First-run defaults select Codex / Antigravity / Grok / Cursor but **do not query until Start is clicked**. An upgrade preserves an existing user's consent and preferences.

`place` is `none`, so Herdr does not add a row. On a personal layout, set the 28px status block's `content.mod` to `quota-manager`. That copy draws the machine, branch, agent count, the quota chips packed against the command hint. Remove any older `quota-manager` block. A second block repeats the row and shortens the terminal. A hidden block still polls. Clone a shipped layout before the edit. The installer does not write layouts.

## Usage

**Query is not Show.** A provider with Query ON and Show OFF continues collecting but stays out of the status bar and Usage popup. Query OFF stops future collection; a visible cached row is marked Paused. Turning all providers off never invokes an unscoped `quota-axi` command. An already-started process cannot be forcibly cancelled through the current Herdr exec API; its result is discarded when selection changes.

**Detect installed** asks Herdr for installed CLI entries. It does not read tokens or prove a subscription exists. **Select detected** replaces the selection with those results. Choose providers used through OMP/Pi or other harnesses manually; those harness names do not identify a unique billing provider.

Refresh runs one provider at a time. On this computer `command.js` invokes `queryLocalQuota` directly in-process inside `mods/quota-manager/vendor/quota-axi/index.js` (`allowKeychainPrompt: false`, `refreshCredentials: false`), without spawning `node` or launching a CLI binary.

A remote machine still runs the `quota-axi` program with `--json --provider <id> --no-credential-refresh`.

Manual refresh uses `--max-age 0`; it still respects provider Retry-After and the five-second local cooldown. Automatic reads reuse upstream readings younger than 90 seconds. Manual-only mode performs no automatic first query, even after restart or machine switching. Clicking Start is an explicit manual query.

The compact percentage is the **least remaining measurable selected window**, with its window name available in the popup/tooltip. Different providers' percentages are not comparable token amounts and are never added together. Used-share rows are always labeled used; unknown, untrusted, and reset-expired windows do not become invented remaining quotas. A passed reset time is not proof of a successful reset.

Keyboard while the Mod has focus: `U` Usage, `S` Settings, `H` History, `R` refresh, `Esc` close/leave. In Settings, ↑/↓ selects a provider, Space toggles Query, Shift+Space toggles Show, and Ctrl+↑/↓ reorders it. Optional commands are `quota-manager.menu`, `quota-manager.settings`, `quota-manager.history`, and `quota-manager.refresh`; bindings in Herdr's `keys.json` use its `quota-manager:refresh` notation. No shortcuts are installed automatically.

## Windows and remote machines

On this computer, local queries run directly inside the Mod via `mods/quota-manager/vendor/quota-axi/index.js` (`home()` provides credential discovery paths and `appHome()` provides `<app-home>/quota-manager-collector/` cache storage). It does not spawn `node`, look up a global `quota-axi`, or launch `dist/bin/quota-axi.js`. A remote call runs in Herdr `exec` with `{ on: machine }`: it looks up `quota-axi` on the remote machine, then a login shell, then a fixed `cmd.exe /d /s /c` shim. Only static flags and catalog IDs enter those remote shell strings. Local Windows paths are never passed to remote machines.

Remote calls always carry Herdr's `{ on: machine }` option, including fallbacks. Install Node, quota-axi, and provider credentials on that remote host. A popup retains its original machine even after the selected space or machine preference changes; reopen it to follow the new selection. Caches, leases, history, and alerts are separated by machine and provider.

The collector inherits that machine's Herdr execution environment. Per-terminal custom `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, container credentials, or arbitrary profile mappings are **not automatically inferred from terminal contents**. Account lanes are the ones quota-axi discovers, not an account switcher implemented by this Mod.

## Privacy and provider caveats

The Mod does not log in, execute inferred remedy commands, refresh credentials, request inference, scrape browser cookies, or store tokens. The collector necessarily reads permitted local auth sources and contacts the provider; it is not an offline-only tool. Secure-store approval remains an explicit terminal action. Read [SECURITY.md](SECURITY.md) before enabling providers.

**Muse exception:** its vendor quota endpoint can issue an API key server-side. Muse is disabled by default, excluded from Select detected, and requires a separate warning confirmation before enabling. Other providers also remain subject to upstream endpoint behavior.

History stores normalized quota snapshots, not bills or token-cost estimates: at most 120 snapshots per provider/machine, with entries older than 30 days pruned when that machine is next visited/polled. Pausing history stops new recording; clearing history removes existing snapshots for the popup's machine. Never edit `shared.json` while Herdr is running.

## Update / remove

```sh
git pull --ff-only
node scripts/install.mjs
# Reversible removal; configuration/history are deliberately retained:
node scripts/install.mjs --uninstall
```

Previous installed files are retained under `<app-home>/.quota-manager-backups/`. Both install and uninstall also move any `.quota-manager-collector.json`-marked legacy directories under `<app-home>/collectors/` into backups while leaving unmarked/foreign folders untouched. Uninstall only removes a Mod marked as installed by this installer. Remove a dangling block from your personal layout if Herdr keeps it after removal. The installer never uninstalls a global `quota-axi` installation.

## Develop and validate

No dependency download is required for the Mod's fixture tests:

```sh
npm run validate
npm run test:coverage
npm run check:herdr
```

CI runs syntax checks, fixture tests, and installer dry-run on Windows, macOS, and Linux. UI tests use strict structural GPUI doubles; they do **not** establish native rendering correctness. A real native check and interactive acceptance with your Herdr build/accounts remain necessary; see [the validation checklist](docs/VALIDATION.md).

Current scope deliberately excludes account login/switching, arbitrary shell adapters, drag-and-drop ordering, historical billing charts, and modifying/routing agents. Ordering buttons and snapshot history are implemented. No Gallery submission or live native screenshot is claimed by this repository.

## Sources and attribution

The Mod UI, preferences, and shared-state scheduling are written in this repository. The local quota-query implementation under `mods/quota-manager/vendor/quota-axi/` is compiled and adapted from the vendored upstream [quota-axi](https://github.com/kunchenguid/quota-axi) 0.1.69 snapshot at `third_party/quota-axi` (`5734c41eee52eb9a80ba67f47269ebc06c0c41fc`, MIT License, Copyright (c) 2026 Kun Chen). The architecture was also informed by [Herdr's Mod guide](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md), [Lakris2407's quota Mod](https://github.com/Lakris2407/herdr-mods/tree/main/quota), and [Orca's usage UI](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/status-bar/UsageRosterPanel.tsx). This Mod is not a migration of Orca's React/Electron implementation. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT License.
