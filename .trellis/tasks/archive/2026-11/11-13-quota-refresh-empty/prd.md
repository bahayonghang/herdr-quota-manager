# Restore real local quota querying

## Goal

Make the installed Herdr Mod show current real quota for this Windows machine's Codex, Antigravity and Grok accounts after refresh. The user first requested diagnosis, then explicitly requested code and configuration repair for local querying. Fixing code alone without configuring and validating the running app is insufficient.

## Background and evidence

- Screenshot: three visible chips remain `—` after refresh. Baseline branch `bottom-right-quota-strip`, HEAD `cb3a756`; product worktree initially clean.
- Current installed 83 JS/JSON files match the repository. Consent is false, the three visible Query flags are off, hidden Cursor Query is on, and scope follows the active remote space. Source/runtime trace: `research/runtime-findings.md` (config.js:48, store.js:18, ui.js:104-107). Eight isolated handler/admission checks and 56 existing targeted tests passed during diagnosis.
- Local bundle gaps were reproduced independently: agy discovery/transport is stubbed, and Grok's binary response reader requires a body stream Herdr lacks. See `research/source-trace.md` (agy process/HTTP stubs and grok.js:722-759).
- Authorized read-only local preflights now establish viable data sources: Codex returned fresh JSON quota; Antigravity's loopback daemon returned four valid windows; Grok's official JSON billing route returned a valid weekly allowance. These Node probes did not install code or change settings and do not replace native Herdr acceptance. See the three local feasibility/preflight reports.
- A related scope defect is proven: a remote-pinned popup keeps querying remote after its Local setting is saved because main.js:38-40 and config.js:51-53 preserve the original pin. See `research/local-repair-preflight.md`.

## Requirements

- **R1 Local collection:** repair the three displayed providers' actual in-process local path, preserving direct `queryLocalQuota`, schema 5/6 normalization, and zero local subprocess/CLI calls. Implement only verified sources; never display fixtures or inferred full quota as live data.
- **R2 Native-compatible transports:** Antigravity must discover validated daemon states and read its fixed loopback JSON endpoint without process inspection/TLS bypass; Grok must use the verified fixed first-party JSON allowance endpoint. Preserve valid/missing/invalid field distinctions. Source semantics and generator ownership are detailed in design.md and the feasibility reports.
- **R3 Scheduling integrity:** bound new daemon discovery/transport waiting with real host deadlines, preserve admission limits and revision/lease guards, and prevent late responses from crossing runtime contexts or publishing obsolete data. Do not claim underlying fetch cancellation when only waiting/publication is bounded.
- **R4 Target and interaction:** explicitly selecting Local in an open popup must immediately make its queries local while ordinary active-space changes preserve popup pinning. Blocked manual refresh must expose Start/Query guidance without silently enabling collection.
- **R5 Apply configuration:** after checked installation, use the Mod settings/host API to select local scope, Query ON for Codex/agy/Grok, Query OFF for hidden Cursor, and Start. Keep unrelated preferences/history; never edit physical shared.json.
- **R6 Privacy and acceptance:** never print/persist tokens, CSRF, raw provider responses/errors, emails, identity objects, remedy commands or stderr. Verify actual local cache publication and numeric quota in the running native app, separately from mocked tests and initial render.

## Out of scope

- Credential refresh/login, inference, browser-cookie import, arbitrary endpoint/shell settings, another collector, or local fallback from remote failure.
- Remote installation/credentials, unrelated providers, product layout/style changes, broad platform/display matrices, or cleanup of Antigravity-owned stale state files.
- Git commits/pushes or task archival without separate authorization.

## Acceptance Criteria

- [x] Diagnose and persist the original symptoms, admission cause, local capability gaps, and explicit scope-switch defect.
- [x] Prove local source feasibility with bounded, redacted real quota reads for the requested providers.
- [x] R1/R2: regression fixtures matching native response/FS capabilities show valid local reports and fail safely on malformed/missing quota and invalid daemon metadata; no local exec calls. Templates and generated output stay synchronized.
- [x] R3: tests establish stale candidates followed by a valid one beyond the first 16, discovery bounds/concurrency, actual deadline handling, and ignored late completions.
- [x] R4: click-level tests prove Local retargeting and preserved ordinary popup pinning, plus zero queries and settings guidance when manual refresh is blocked.
- [x] New defect guards have observed red and green runs in isolated baseline/fixed fixtures. Relevant tests, just ci and native initial-render check pass (114/114 final tests).
- [x] R5/R6: installed app reads back local scope, consent true, the requested three Query flags on and hidden Cursor off; a native local refresh publishes fresh real numeric windows for all three and the chips display them with no remote quota cache. See native receipt for exact evidence limits.
- [x] Record actual native outcomes and privacy checks without copying unrelated workspace imagery or raw reports into the repository.

## Authorization and artifact status

Code/config repair, checked installation, and local read-only quota collection were requested and the final plan was explicitly approved. Initial report-only restrictions remain historical context, not a restriction on the follow-up scope.

Implementation and native acceptance are complete; see research/native-acceptance-20261113.md. The final native frame displayed Codex 97%, Antigravity 69%, Grok 50% remaining. The user subsequently requested commit and archive; implementation is committed as `59cd333497b659985c51b7701c18b65ac7b9d7ed`. No broader catalog/platform compatibility is claimed.
