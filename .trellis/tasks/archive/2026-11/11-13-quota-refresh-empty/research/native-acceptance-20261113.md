# Final Windows native acceptance

Date: 2026-11-13. Baseline branch `bottom-right-quota-strip`, HEAD `cb3a756`; implementation was uncommitted at the time of native acceptance. Target: running Herdr 0.1.15 on this Windows machine, three requested providers only.

## Outcome

**Passed:** the installed native status strip visibly showed Codex **97%**, Antigravity **69%**, and Grok **50%** remaining after the real `quota-manager.refresh` command. These are transient observed live readings, not test fixtures or guaranteed future values.

Read-back from native shared caches shortly after that refresh:

| Provider | Lane state | Trusted windows | Display headline | Local cache age |
| --- | --- | --- | --- | --- |
| Codex | fresh, not stale | 1 weekly, future reset | 97% | 7 s |
| Antigravity | fresh, not stale | 4 session/weekly, future resets | 69% | 4 s |
| Grok | fresh, not stale | 1 weekly, future reset | 50% | 3 s |

All cache errors were null. Herdr status reported no module errors and no remaining overlays. Configuration read-back: scope local, consent true, revision 9; Codex/agy/Grok Query and Show true; hidden Cursor Query false. No remote quota cache existed. Source/target routing and unit assertions establish local collection; this was not packet-capture verification of all app traffic.

## Installation and configuration

- Product installed exclusively with `just install`, including regeneration, staged native check and owned backup. Final backup: `.quota-manager-backups/1794574671895-5c652d14-bcf5-4177-94be-444f8a216f77` under the normal app home.
- Post-install comparison: **84 JS/JSON files checked, zero differences** from the repository (development-only jsconfig excluded).
- Native UI automation's named pipe was unavailable. A temporary separately checked setup Mod applied the approved configuration using `normalizeConfig/changeConfig` and documented `herdr.setShared`, then closed. No physical shared.json writes, global default-consent migration, local subprocess collector, login, refresh-credential or inference request was introduced.
- `herdr-app do quota-manager.refresh` returned ok and exercised the actual installed Mod's command/forced-poll path. A native shot was captured and visually inspected; all three numeric chips were visible immediately left of the command hint. The full frame contains unrelated workspace material and was not copied into repository artifacts.

## Native-only defect caught and resolved

The first native pass obtained Antigravity quota but Codex/Grok reported auth_required. Investigation disproved missing-method and isBuffer-classification hypotheses, then proved Herdr Buffer.from(Uint8Array) yielded no bytes and Buffer.toString yielded empty text. Direct host UTF8 reads worked. See `native-buffer-findings.md`.

The corrected generator preserves exact text through VFS preload/read/write/host flush and uses real byte views for size/hash; selected provider JWT parsing uses verified standard base64/UTF8 decoding. The same native probe then parsed both real credential files through the repaired VFS, and the final checked reinstall produced all three live quotas above. No login/credential mutation was needed.

## Verification

- Final `just ci`: **114/114 passed**, zero failures/skips/cancellations; 103 JS modules passed syntax/JSON/forbidden-API scanning; coverage and installer dry-run passed. Final command output: local RTK log `1794574654_just_ci.log`.
- Final `npm run check:herdr`: passed. Official installation also passed its own staged native check.
- Generator review earlier reproduced 76 generated files with zero drift. The subsequent Buffer fix is in the generator and regenerated output together; the final official install regenerated that source, and installed parity above covers the final product.
- Real red/green guards: initial local acquisition baseline 2 failures; host/scope/deadline baseline 8 failures; native-shaped text-VFS baseline failed; deterministic delayed-refresh test demonstrated the old 50-turn harness returned prematurely. Fixed cases and final full suite passed.
- Review had no remaining blocking product finding. Four logical daemon workers do not imply four underlying native sockets: waiting deadlines cannot cancel transport. At most 256 distinct candidates are admitted per cold search; late results are ignored. Candidate/late-settlement regression is included.
- Readable collector cache: valid JSON, 3 providers, 4612 bytes at inspection. The existing normalized quota cache and collector cache had no email/JWT/Bearer-pattern matches; fixture tests separately assert secret/raw-error redaction. This pattern check is supporting evidence, not a general secret-scanner guarantee.

## Cleanup and remaining scope

Temporary setup/probe Mods, probe JSON outputs, empty helper data directories, and native screenshot were removed after inspection. Provider-owned daemon files, user layouts/keybindings/history, and installer backups remain intact.

At the end of native acceptance, no commit, push or task archival had been performed, as specified in the then-approved execution plan. Other catalog providers' native stream/CLI capability gaps remain outside this three-provider acceptance. No additional window/DPI/theme/platform matrix was run.

## Subsequent repository closure

The user explicitly requested commit and archive after this acceptance. Implementation commit: `59cd333497b659985c51b7701c18b65ac7b9d7ed`. The acceptance observations above are unchanged; archival and journal recording are repository bookkeeping. No push was requested.
