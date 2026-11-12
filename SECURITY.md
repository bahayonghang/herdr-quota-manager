# Security and privacy

Herdr Mods are trusted code with process and network capabilities. Review this repository and the separately installed quota-axi collector before enabling queries.

## Implemented safeguards

- No collection until explicit first-run Start; providers must be in a fixed allowlist.
- Every collection command selects one provider and passes `--no-credential-refresh`.
- No `--allow-claude-inference`, automatic login, browser-cookie import, or automatic keychain permission request.
- No arbitrary shell command, executable path, or remotely supplied remedy command is run.
- Windows and Unix shell fallbacks contain only fixed tokens and allowlisted provider IDs. Machine names are host API options, never command-string interpolation.
- Provider stderr and arbitrary upstream error messages are not persisted or shown. UI errors use a fixed vocabulary.
- Normalized caches omit account emails, raw identity objects, tokens, credential-file contents, and source/locator metadata. Hash-based lane labels are not cryptographic anonymization.
- Bounded subprocess timeouts, per-host admission, short-lived leases, retry backoff, and Retry-After handling limit repeated requests.
- Native preflight happens before replacing an installed Mod; previous files are backed up. The installer does not overwrite `shared.json`, layouts, keys, or agent settings.

## Important boundaries

quota-axi reads auth sources available to it and calls first-party endpoints. This Mod does not prevent the collector or vendor from changing behavior. Its native secure-store grants, if previously approved, remain owned by that collector. No claim is made that every endpoint is a formally supported public API.

**Muse**: the collector documents a vendor quota-read endpoint that may issue a server-side API key. Muse requires separate explicit UI consent and is excluded from bulk detection selection. The key is not imported or stored by this Mod, but the vendor side effect is real.

Installed external CLIs and shell startup files remain trusted dependencies. Install the pinned collector intentionally; the Mod never downloads code or self-updates. Do not paste provider tokens into GitHub issues.

Already-running subprocesses cannot be cancelled through the current Herdr exec API. Selection changes discard their results but cannot retroactively prevent a network call already made.

## Authentication troubleshooting

Sign in with the vendor's own CLI on the machine being queried. Where appropriate, inspect quota-axi's documentation and explicitly approve secure-store access from your terminal with a provider-scoped command. Never turn on inference merely to make this Mod show a number without understanding the cost.

The Mod's help panel displays commands but does not execute approval or login actions.

## Reporting

For a suspected security issue, send a minimal redacted description through the repository owner's available private contact channel. Do not create a public issue containing tokens, credential files, account emails, full raw quota reports, or terminal transcripts.
