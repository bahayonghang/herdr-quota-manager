// Explicit allowlist: values from configuration never become arbitrary shell syntax.
export const PROVIDERS = Object.freeze([
  ["codex", "Codex", "CX", ["codex"]],
  ["agy", "Antigravity", "AG", ["agy", "antigravity"]],
  ["grok", "Grok", "GK", ["grok"]],
  ["cursor", "Cursor", "CU", ["cursor", "cursor-agent"]],
  ["claude", "Claude", "CL", ["claude", "claude-code"]],
  ["copilot", "GitHub Copilot", "CP", ["copilot"]],
  ["kimi", "Kimi", "KM", ["kimi"]],
  ["opencode-go", "OpenCode Go", "OC", ["opencode"]],
  ["zai", "Z.AI", "ZA", []],
  ["minimax", "MiniMax", "MM", []],
  ["alibaba", "Alibaba", "AL", []],
  ["commandcode", "Command Code", "CC", ["commandcode"]],
  ["mimo", "MiMo", "MI", []],
  ["deepseek", "DeepSeek", "DS", []],
  ["openrouter", "OpenRouter", "OR", []],
  ["elevenlabs", "ElevenLabs", "EL", []],
  ["devin", "Devin", "DV", ["devin"]],
  ["muse", "Muse", "MU", ["muse", "muse-code"]],
  ["higgsfield", "Higgsfield", "HF", ["higgsfield"]],
].map(([id, name, glyph, agents]) => Object.freeze({ id, name, glyph, agents: Object.freeze(agents) })));
export const IDS = Object.freeze(PROVIDERS.map(p => p.id));
export function provider(id) { return PROVIDERS.find(p => p.id === id); }
export function assertProvider(id) {
  if (!IDS.includes(id)) throw new Error("Unsupported provider");
  return id;
}
export function detectedProviders(agents) {
  const installed = new Set((Array.isArray(agents) ? agents : []).filter(a => a.installed).map(a => a.key));
  // Presence is a hint, never proof of a subscription or authority to read credentials.
  return PROVIDERS.filter(p => p.agents.some(key => installed.has(key))).map(p => p.id);
}
