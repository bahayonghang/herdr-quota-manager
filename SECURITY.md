# Security and privacy

Herdr Mods are trusted code with process and network capabilities. Review this repository, including the vendored quota-axi snapshot at `third_party/quota-axi`, before enabling queries.

## Implemented safeguards

- No collection until explicit first-run Start; providers must be in a fixed allowlist.
- Every local query runs directly in-process inside the Mod via `mods/quota-manager/vendor/quota-axi/` (adapted from upstream `quota-axi` 0.1.69, MIT, Copyright (c) 2026 Kun Chen) with `allowKeychainPrompt: false` and `refreshCredentials: false`. Every remote command selects one provider and passes `--no-credential-refresh`.
- No `--allow-claude-inference`, automatic login, browser-cookie import, or automatic keychain permission request.
- No arbitrary shell command, executable path, or remotely supplied remedy command is run.
- On this computer, local execution runs no subprocess or CLI binary: `queryLocalQuota` pre-reads only allowlisted provider credential paths under `home()`, runs `fetch` directly through the Mod runtime, and persists normalized collector cache/Muse-ledger files only under `<appHome>/quota-manager-collector/quota-axi/`. Remote shell fallbacks contain only the command name `quota-axi`, fixed tokens, and allowlisted provider IDs. Machine names and `home()`/`appHome()` are host API values, never preference text and never interpolated into remote shell strings.
- Provider stderr and arbitrary upstream error messages are not persisted or shown. UI errors use a fixed vocabulary.
- Normalized caches omit account emails, raw identity objects, tokens, credential-file contents, and source/locator metadata. Hash-based lane labels are not cryptographic anonymization.
- Bounded subprocess timeouts, per-host admission, short-lived leases, retry backoff, and Retry-After handling limit repeated requests.
- Native preflight happens before replacing an installed Mod; previous files are backed up. The installer does not overwrite `shared.json`, layouts, keys, or agent settings.

## Important boundaries

quota-axi reads auth sources available to it and calls first-party endpoints. This Mod does not prevent the collector or vendor from changing behavior. Its native secure-store grants, if previously approved, remain owned by that collector. No claim is made that every endpoint is a formally supported public API.

**Muse**: the collector documents a vendor quota-read endpoint that may issue a server-side API key. Muse requires separate explicit UI consent and is excluded from bulk detection selection. The key is not imported or stored by this Mod, but the vendor side effect is real.

The Mod never downloads code or self-updates at runtime. `just install` builds `mods/quota-manager/vendor/quota-axi/` from the pinned snapshot already in this repository (`third_party/quota-axi`) and retires any owned legacy collector directories under `<app-home>/collectors/`. Remote machines still depend on their own `quota-axi` program and shell startup files. Do not paste provider tokens into GitHub issues.

Already-running subprocesses cannot be cancelled through the current Herdr exec API. Selection changes discard their results but cannot retroactively prevent a network call already made.

## Authentication troubleshooting

Sign in with the vendor's own CLI on the machine being queried. Where appropriate, inspect quota-axi's documentation and explicitly approve secure-store access from your terminal with a provider-scoped command. Never turn on inference merely to make this Mod show a number without understanding the cost.

The Mod's help panel displays commands but does not execute approval or login actions.

## Reporting

For a suspected security issue, send a minimal redacted description through the repository owner's available private contact channel. Do not create a public issue containing tokens, credential files, account emails, full raw quota reports, or terminal transcripts.
