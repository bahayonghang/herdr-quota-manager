export const state = { data: new Map(), props: {}, executions: [], overlays: [], commands: [], agents: [], roster: [], keys: [], spaces: [], notices: [], window: { platform: "windows" }, execCode: 1 };
export const shared = key => state.data.get(key);
export const setShared = (key, value) => state.data.set(key, value);
export const props = () => state.props;
export const spaces = () => state.spaces;
export const agents = () => state.roster;
export const keys = () => state.keys;
export const window = () => state.window;
export const home = () => state.home ?? "C:/herdr-nonexistent-home";
export const appHome = () => state.appHome ?? "C:/herdr-app";
export const knownAgents = async options => { state.detectOn = options.on; return state.agents; };
export const openOverlay = spec => { state.overlays.push(spec); return "overlay"; };
export const closeOverlay = id => { state.closed = id; };
export const nextCommand = () => new Promise(() => {});
export const run = (...args) => state.commands.push(args);
export const notify = info => state.notices.push(info);
export const exec = async (...args) => {
  state.executions.push(args);
  return { code: state.execCode, stdout: JSON.stringify({ schemaVersion: 5, generatedAt: new Date().toISOString(), providers: [{ provider: args[1][2], windows: [], state: { status: "auth_required" } }] }) };
};
export const theme = () => Object.fromEntries(["chrome", "popover", "selected", "raised", "hover", "foreground", "muted", "accent", "border", "dim", "blocked", "ansi1", "ansi2", "ansi3"].map(k => [k, `theme.${k}`]));
export function reset() {
  state.data.clear(); state.props = {}; state.executions = []; state.overlays = []; state.commands = [];
  state.agents = []; state.roster = []; state.keys = []; state.spaces = []; state.notices = []; state.closed = null;
  state.window = { platform: "windows" }; state.execCode = 1; state.home = null; state.appHome = null;
}
