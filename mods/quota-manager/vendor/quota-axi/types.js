// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export const PROVIDER_IDS = [
    "claude",
    "codex",
    "cursor",
    "copilot",
    "grok",
    "kimi",
    "zai",
    "agy",
    "alibaba",
    "opencode-go",
    "commandcode",
    "minimax",
    "mimo",
    "deepseek",
    "openrouter",
    "elevenlabs",
    "devin",
    "muse",
    "higgsfield",
];
/**
 * Published field name of the per-scope selection scalar. Declared once so the
 * scalar can be renamed in a single line without touching call sites.
 */
export const SELECTION_SCALAR_KEY = "spendPriority";
