# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**. The executable contracts are in `.trellis/spec/mod/` and `.trellis/spec/tooling/`.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning collector, store, and UI |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] A change touches quota-axi JSON, normalized lanes, shared state, and the GPUI tree
- [ ] A new preference must survive `normalizeConfig` and round-trip through `changeConfig`
- [ ] UI or command code starts reading `stdout`, `accountKey`, or raw `state`
- [ ] A collector command is built anywhere except `command.js`
- [ ] Installer backup behavior and the Mod's retained history could drift

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) and [Data Contracts](../mod/data-contracts.md)

### When to Think About Code Reuse

- [ ] You are about to type a provider id, window kind, error string, or interval that already exists
- [ ] A second parser for collector JSON is appearing
- [ ] `main.js` is formatting a percentage that `model.js` already computes
- [ ] The same `i18n.js` key is being inlined as a literal in a test or help string
- [ ] You are adding a helper next to one that already lives in `providers.js`, `config.js`, or `model.js`

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Verifying AI Cross-Review Results

- [ ] Reviewer claims "user input can be malicious" → Check the actual data source (allowlisted provider id? stored preference? collector stdout?)
- [ ] Reviewer flags "missing validation" → Is the value already passed through `normalizeConfig` or `normalizeReport`?
- [ ] Reviewer says "behavior change" → Read the code comments — is it intentional design?
- [ ] Reviewer identifies a "bug" in a test → Mentally delete the feature being tested — does the test still pass? If yes → tautological test

**Common AI reviewer false-positive patterns**:

1. **Trust boundary confusion**: Treating `PROVIDERS` or a normalized lane as if it were raw shell input
2. **Ignoring design comments**: Flagging intentional behavior documented in code comments as bugs
3. **Variable misreading**: Not tracing a variable to its actual definition (lane `key` hash vs account email)

**Verification rule**: Every CRITICAL/WARNING finding must be verified against the actual code before prioritizing. Budget ~35% false-positive rate for AI reviews.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

Search for the value you are about to change: `CONFIG_KEY`, a `stateKey` kind, an id in `IDS`, a `KINDS` entry, an `i18n.js` key, or a flag in `queryArgs`.

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.

**Language**: Specs in this tree are written in English.
