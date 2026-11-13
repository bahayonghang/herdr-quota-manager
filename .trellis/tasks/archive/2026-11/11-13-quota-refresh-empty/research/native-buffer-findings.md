# Native Buffer mismatch discovered during acceptance

Date: 2026-11-13; Herdr 0.1.15. This finding came from actual installed-app acceptance after initial synthetic tests passed.

## Observed symptom

The repaired Antigravity daemon path produced a fresh lane with four real windows inside Herdr. The same app reported auth_required with no windows for Codex and Grok, although bounded Node preflights had already read their real current quota. Local config read-back was correct, no remote cache existed, and Herdr reported no module errors.

## Discriminating native probe

`research/probe-native-runtime.mjs` uses a temporary native Mod, the documented lifecycle and native async filesystem APIs. It writes only fixed diagnostic booleans and synthetic byte results, then closes/removes its helper and diagnostic output. It does not print credential text, JWT claims, errors containing credential contents, raw reports, or identities.

Measured inside the same native JS engine:

| Check | Native result |
| --- | --- |
| Buffer.isBuffer / byteLength / digest.readUInt32BE exist | yes |
| fs readFile(path) | Uint8Array |
| Direct fs readFile(path, "utf8") parses both credential files | yes |
| Buffer.from(new Uint8Array([123,125])).length | 0 |
| Buffer.from("{}").length / first byte | 2 / 123 |
| Buffer.from("{}").toString(), utf8, utf-8, or explicit range | empty string |
| atob("e30=") === "{}" | true |
| Uint8Array.from(Buffer.from("{}")) | real 2-byte view, [123,125] |
| Existing VFS path exists | true |
| Existing VFS readFileSync(path,"utf8") parses auth JSON | no |

The initial missing-method hypothesis was disproven; hash operations succeeded. A hypothesis that isBuffer misclassified the host array was also disproven (it returned false). The final synthetic checks establish an actual Buffer conversion/decoding incompatibility.

## Root cause

`runtime.preloadFile` converted native Uint8Array input with Buffer.from, which yielded zero bytes; `readFileSync(...,"utf8")` then used Buffer.toString, which also returned empty text in this runtime. Both JSON credential readers consequently saw invalid JSON. Antigravity succeeded because its new helper uses the host's UTF-8 string read directly. JWT decoding in the selected providers contained the same incompatible Buffer-to-string assumption.

## Owning repair and guard

Repair the generator/runtime VFS to preserve exact text from host UTF-8 reads and on text writes; return that text on UTF-8 reads and flush it through the host string write API. Maintain genuine byte-array views for hashing/size rather than relying on the broken host Buffer view. Decode selected provider JWT text through verified standard base64 facilities. Do not add a general Buffer reimplementation or infer that methods work merely because their names appear in declarations.

The implementation must add an isolated fixture matching these observed host semantics, observe red/green, cover Unicode and cache reload/read-after-write, regenerate, reinstall via the official installer, and repeat actual native queries. Current diagnosis alone is not acceptance.

## Resolution

Completed and verified: the isolated observed-Buffer fixture failed on the old VFS and passed after repair; the same native probe then parsed both credential files through the VFS. Final official reinstall and native refresh produced fresh visible quota for all three providers. Full tests passed 114/114. See `native-acceptance-20261113.md`.
