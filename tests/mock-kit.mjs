// A strict structural GPUI test double, not a native renderer.
const methods = ["id", "px", "py", "p", "rounded", "flex_none", "cursor_pointer", "bg", "text_color", "text_size", "font_semibold", "role", "accessibility_label", "h", "w", "w_full", "gap", "items_center", "justify_between", "justify_end", "justify_center", "flex_wrap", "flex_1", "size_full", "border", "border_t", "border_color", "tooltip", "track_focus", "overflow_y_scrollbar", "overflow_hidden", "max_w", "truncate", "whitespace_nowrap", "size"];
export class Node {
  constructor(kind) { this.kind = kind; this.attrs = {}; this.events = {}; this.content = []; }
  child(value) { this.content.push(value); return this; }
  children(values) { if (!Array.isArray(values)) throw new Error("children expects an array"); this.content.push(...values); return this; }
  when(condition, fn) { return condition ? fn(this) : this; }
  hover(fn) { fn(new Node("hover")); return this; }
}
for (const method of methods) Node.prototype[method] = function (...args) { this.attrs[method] = args[0]; return this; };
for (const event of ["on_click", "on_mouse_down", "on_key_down", "on_size_change"]) Node.prototype[event] = function (...args) { this.events[event] = args.at(-1); return this; };
export class View {}
export const div = () => new Node("div");
export const h_flex = () => new Node("row");
export const v_flex = () => new Node("column");
function graphic(kind, path) {
  const node = new Node(kind);
  node.attrs.path = path;
  return node;
}
export const image = path => graphic("image", path);
export const svg = path => graphic("svg", path);
