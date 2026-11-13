# Research: feasible Grok local transport

- Query: Can local Grok quota work inside the existing Herdr Mod without subprocesses or a binary HTTPS API?
- Scope: local source/type inspection, official upstream source, unauthenticated protocol checks, and one bounded authenticated read-only quota preflight after the main session explicitly relayed the user's repair/preflight authorization.
- Date: 2026-11-13

## Result

**Yes: use the first-party JSON billing route used by the official Grok Build client.** It avoids the host's missing binary-response API and returned a valid weekly quota with the user's existing local credential. This is a transport feasibility result, not a completed Mod repair or native acceptance.

## Verified host boundary

Installed Herdr 0.1.15 declarations at `gpui-kit.d.ts:22154-22202` expose:

- `fetch`: response `status`, `ok`, `url`, `text()`, `json()`; no headers, body stream, arrayBuffer, or bytes method.
- `net`: plain TCP sockets with binary reads, string writes; no TLS option or HTTPS client.
- `websocket`: framed WS/WSS messages, not arbitrary HTTPS requests. Authentication/control headers are restricted.

The pinned vendor's Grok consumer fetch remains binary gRPC-web (`vendor/quota-axi/providers/grok.js:677-759`). Its private body reader returns empty bytes when `body` is absent. The earlier positive/negative synthetic test in `source-trace.md` proved stream-shaped bytes succeed while an otherwise equivalent Herdr response shape fails. A UTF-8 round-trip cannot recover arbitrary protobuf bytes. There is no verified binary/TLS host mechanism to repair that route directly.

## Official JSON source

Official repository `xai-org/grok-build`, commit **`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`**, dated 2026-09-29; GitHub commit API checked during this research.

The official billing extension uses GET `/billing?format=credits`, bearer authentication, and a JSON response. Its source identifies the data as the same credits backend. The production base is `https://cli-chat-proxy.grok.com/v1`; the default token header value is `xai-grok-cli`. The response model carries usage percent, a weekly/monthly period, and purchased balance; the code treats balance amounts as cents. These are implementation contracts observed in current official client source, rather than a documented public API stability promise.

Primary references:

- [Official billing request and response model](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/billing.rs#L50), especially `handle_get_billing` at lines 170-233.
- [Production endpoint](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-env/src/lib.rs#L21).
- [Default token header](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-login/src/config.rs#L393).
- [Subject extraction](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-login/src/jwt.rs#L19).

The request uses the existing signed-in Grok credential. No management key, cookie import, inference, CLI execution, or credential rotation is needed.

## Bounded real local preflight

The main session explicitly authorized read-only local quota preflights during planning after the user's follow-up repair request. The probe read the existing local Grok auth file into Node memory, chose its OIDC/session candidate, and sent exactly one authenticated request:

```text
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <existing in-memory credential>
X-XAI-Token-Auth: xai-grok-cli
Accept: application/json
x-userid: <JWT sub, when present>
```

The probe used `AbortSignal.timeout(15000)` and refused redirects. It did not refresh, log in, perform inference, write cache/state, or display token/raw response/account identifiers. It imposed a 262144-byte post-read rejection. That last check is not a streaming bound; a product implementation should retain the existing response-size guard and not claim a preallocation limit where the native host only offers complete text.

Only the following safe result was printed:

```json
{"credentialCandidate":true,"httpStatus":200,"jsonObject":true,"hasConfig":true,"creditUsagePercent":50,"remainingPercent":50,"periodKind":"USAGE_PERIOD_TYPE_WEEKLY","hasValidReset":true,"productCount":2,"hasPrepaidBalance":true,"hasMonthlyLimit":false,"hasUsed":false}
```

This proves first-party endpoint access and usable numeric quota for the present local credential. It does **not** prove the repaired code works in Herdr: that native run remains required after implementation approval. Client-version headers were not required by this observed successful request; do not fabricate a Grok client version.

## gRPC-web-text investigation

The [official gRPC-Web protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md) describes text response negotiation using `Accept: application/grpc-web-text`, normally base64. It also warns that padded chunks can be concatenated; treating an entire response as one ordinary base64 entity is not generally sufficient.

Three unauthenticated requests to the existing Grok credits method used no credential or cookie:

| Request mode | HTTP | Response type | gRPC status | Body bytes |
| --- | --- | --- | --- | --- |
| binary gRPC-web | 200 | application/grpc-web+proto | 16 | 0 |
| text gRPC-web | 200 | application/grpc-web-text+proto | 16 | 0 |
| application/json to same RPC route | 200 | application/grpc | 13 | 0 |

The edge recognizes text-mode negotiation before authentication. Successful authenticated data framing in that mode was **not** verified. Status 16 without a body does not establish that usable quota will be base64-encoded on a successful call. Since the official JSON route already produced quota, adding a new gRPC-web-text decoder is unnecessary for this repair.

## Recommended minimal implementation boundary

1. Keep upstream `third_party/quota-axi` pinned. Put the local adaptation in the owning build templates (`scripts/build-vendor.mjs`) and regenerate the Mod bundle. Do not edit only generated vendor output.
2. Adapt only Grok's local consumer acquisition to the fixed JSON endpoint. Keep existing credential selection, no-refresh behavior, redacted failures, schema generation, normalization, and remote CLI route.
3. Start with the aggregate shared allowance: finite `creditUsagePercent` within 0-100, `currentPeriod.type` mapped to weekly/monthly, validated start/reset timestamps, `remaining = 100 - used`. Preserve one window rather than adding aggregate and product usage. Product rows are a breakdown of the same allowance, not independent budgets; their presence does not require new UI.
4. Missing percentages or period metadata must follow an explicit tested rule. The current preflight has a numeric percent. The official Rust field is optional; do not blindly assume a missing field means 0% on an arbitrary malformed JSON response. Proto3 omission semantics require a valid supported config/period to establish a zero case, or the adapter should report unavailable.
5. If including `prepaidBalance.val`, parse it as cents and convert deliberately. Do not relabel it as the quota percentage or as unlimited. Omitting prepaid balance initially is safer than inheriting the old binary adapter's generic credits unit without checking semantics.
6. Preserve authentication usability versus numeric quota distinctions. Existing Grok model-catalog success is not a quota. No inference request is needed for quota acceptance.

Validation: test JSON quota with a ShellFetchResponse-like object (no body/headers), finite percent boundaries and malformed responses, missing-field semantics, 401/403, transient/size failures, and one native local read that visibly publishes the normalized weekly quota. Keep zero `exec` calls on local paths, and keep remote routing unchanged. A test that provides a Node `ReadableStream` would not guard the native defect.

## Caveats / Not Found

- The current credential and Node networking worked; future credentials, endpoint changes, or native networking can still fail. The plan should not promise every Grok account has a numeric allowance.
- No evidence was found that ordinary model API keys expose this consumer quota. The documented Management API is a separate team/API-billing surface, requiring different authorization; it is not a substitute for this subscription allowance.
- No product-code/configuration edit or installation was performed by this researcher. Only this report was written.
