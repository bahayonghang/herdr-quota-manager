# Repair and acceptance proposal

> Historical report-only proposal. The user subsequently approved the concrete local repair plan in prd.md/design.md/implement.md; the task is now in progress. Read those artifacts for current scope and authorization.

Date: 2026-11-13. This is a proposal following report-only analysis, not authorization to implement, change preferences, or run live collection.

## 1. Resolve the actual admission state first

The immediate screen is explainable without a code change. In the Quota Manager settings, the user must choose the intended machine scope, enable Query for the providers they want, and explicitly Start selected queries. Show alone does not permit collection. Starting with the current configuration would query only hidden Cursor, so Start alone is insufficient.

The current space is remote and scope follows it. Keeping this scope requires that machine's own `quota-axi`, provider sign-in, and endpoint access. Choosing local scope uses this Windows machine's bundled collector instead. Do not silently select a scope, auto-enable consent, or route a failed remote read to local.

Validation, after explicit collection authorization: refresh one selected provider on the intended machine; check cache state/status and native digits or an actionable safe failure reason. Confirm that unselected providers make zero calls. A number is only a passing result when it comes from a valid, current provider allowance; unavailable/unsupported states must remain honest.

## 2. Make blocked refresh explain itself

Minimal candidate product repair: when consent is off or no providers are Query-enabled, give explicit visible guidance from the refresh action and/or strip instead of silently retaining indistinguishable `—` chips. Existing `paused`, `consent`, and `queryHint` copy provides a starting point. This must preserve independent Query/Show behavior and the explicit Start gate.

Likely owning boundaries: `main.js` refresh/settings routing, `ui.js` visible status/action affordance, `i18n.js` English/Chinese copy, and `tests/ui.test.mjs`. Do not change `selectedProviders` to make forced refresh override privacy settings.

Regression acceptance: global pause, all Query off, hidden-but-enabled providers, and an already-authorized valid report must each produce distinct appropriate behavior. Include an actual bar-refresh click assertion and a positive numeric report case. Run the targeted store/UI tests plus a native interaction check; then the required project quality gates if product code changes.

## 3. Treat local provider capability as separate work

- **Antigravity**: the existing zero-subprocess adaptation intentionally disables command/process discovery and local socket requests. Removing stubs blindly would violate the local in-process boundary or fail in Herdr. Establish a supported in-process discovery/transport mechanism before promising live local Antigravity quota. Otherwise surface capability-unavailable honestly, distinguishing it from an absent installation or a logged-out account.
- **Grok**: the consumer provider's protobuf body reader requires a binary stream. Herdr 0.1.15's installed fetch type exposes response text/json only, and the synthetic stream-vs-shell comparison proves the mismatch. Verify a binary-preserving host transport before designing a repair; UTF-8 round-tripping is unsafe. Add a fixture matching the native response contract so mocked browser/Node streams cannot hide this gap.
- **Timeouts**: source review found no-op timer/signal adaptation. This is not the current screenshot cause and needs a separate bounded-request investigation if local query hangs are reported or transport work proceeds.

Generated-code rule: modify the templates in `scripts/build-vendor.mjs` and regenerate `mods/quota-manager/vendor/quota-axi/` together. Generated-only edits will be overwritten by build/install.

Provider-specific acceptance must include synthetic credential/response fixtures matching host capabilities, checks for unsupported paths, and a subsequently authorized native live provider check. Existing schema/snapshot tests are insufficient evidence of vendor API support.

## Decisions still needed before product implementation

The analysis itself is complete. Future implementation scope must choose whether to address blocked-refresh guidance, local provider capability, or both. A live check also needs the user's intended local/remote target and explicit permission to collect. No decision is needed to preserve and report the diagnosis already obtained.

Complex product repairs require reviewed `design.md` / `implement.md`, curated implementation/check manifests, and the normal task activation gate before product edits. This task remains in planning with research complete; it is not archived as a working live-quota feature.
