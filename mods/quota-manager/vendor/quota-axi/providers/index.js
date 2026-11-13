// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { agyAdapter } from "./agy.js";
import { alibabaAdapter } from "./alibaba.js";
import { claudeAdapter } from "./claude.js";
import { commandCodeAdapter } from "./commandcode.js";
import { codexAdapter } from "./codex.js";
import { copilotAdapter } from "./copilot.js";
import { cursorAdapter } from "./cursor.js";
import { devinAdapter } from "./devin.js";
import { elevenLabsAdapter } from "./elevenlabs.js";
import { grokAdapter } from "./grok.js";
import { higgsfieldAdapter } from "./higgsfield.js";
import { kimiAdapter } from "./kimi.js";
import { opencodeGoAdapter } from "./opencode-go.js";
import { minimaxAdapter } from "./minimax.js";
import { mimoAdapter } from "./mimo.js";
import { museAdapter } from "./muse.js";
import { deepseekAdapter } from "./deepseek.js";
import { openrouterAdapter } from "./openrouter.js";
import { zaiAdapter } from "./zai.js";
import { PROVIDER_IDS, } from "../types.js";
export const PROVIDERS = {
    claude: claudeAdapter,
    codex: codexAdapter,
    cursor: cursorAdapter,
    copilot: copilotAdapter,
    grok: grokAdapter,
    kimi: kimiAdapter,
    zai: zaiAdapter,
    agy: agyAdapter,
    alibaba: alibabaAdapter,
    "opencode-go": opencodeGoAdapter,
    commandcode: commandCodeAdapter,
    minimax: minimaxAdapter,
    mimo: mimoAdapter,
    deepseek: deepseekAdapter,
    openrouter: openrouterAdapter,
    elevenlabs: elevenLabsAdapter,
    devin: devinAdapter,
    muse: museAdapter,
    higgsfield: higgsfieldAdapter,
};
export function parseProviders(value) {
    if (!value)
        return [...PROVIDER_IDS];
    const providers = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const invalid = providers.find((provider) => !isProviderId(provider));
    if (invalid) {
        throw new Error(`unsupported provider: ${invalid}`);
    }
    return [...new Set(providers)];
}
function isProviderId(value) {
    return PROVIDER_IDS.includes(value);
}
