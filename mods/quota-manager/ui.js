import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { provider } from "./providers.js";
import { tr } from "./i18n.js";
import { headline, visibleWindows, displayPercent, isStale, countdown } from "./model.js";

export function button(id, label, action, t, active = false) {
  return div().id(id).px(8).py(5).rounded(5).flex_none().cursor_pointer()
    .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .role("button").accessibility_label(label)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);
}
export function line(t) { return div().h(1).w_full().bg(t.border); }
export function text(value, t, muted = true) { return div().text_color(muted ? t.muted : t.foreground).child(value); }
export function note(value, t) { return text(value, t).text_size(11).px(4).py(4); }
export function row() { return h_flex().gap(6).items_center(); }
export function column() { return v_flex().gap(6); }
function tone(w, t) { return w?.remaining === null || !w ? t.muted : w.remaining <= 10 ? t.ansi1 : w.remaining <= 25 ? t.ansi3 : t.ansi2; }
// Strip step 6 only. meter() and providerCard() stay on tone().
export function pressureTone(w, cfg, t, now) {
  const shown = displayPercent(w, cfg, now);
  if (typeof shown !== "number") return t.muted;
  const used = cfg.percentage === "used" ? shown : (typeof w.used === "number" ? w.used : 100 - shown);
  const n = Math.round(used);
  if (n >= 80) return t.ansi1;
  if (n >= 50) return t.ansi3;
  return t.ansi2;
}
export function meter(w, cfg, t, now) {
  const value = displayPercent(w, cfg, now);
  const expired = w.resetsAt && w.resetsAt <= now;
  const caption = expired ? tr(cfg, "resetDue") : !w.trusted ? tr(cfg, "unknown") : w.share ? tr(cfg, "shared") : tr(cfg, cfg.percentage);
  return column().gap(3).child(row().justify_between()
    .child(text(w.label, t, false))
    .child(text(value === null ? caption : `${Math.round(value)}% ${caption}`, t)))
    .child(div().h(4).w(430).rounded(2).bg(t.border).child(div().h(4).w(value === null ? 0 : 4.3 * value).rounded(2).bg(w.share ? t.muted : tone(w, t))))
    .child(row().justify_between()
      .child(text(w.resetsAt ? `↻ ${countdown(w.resetsAt, now)}` : "—", t).text_size(10))
      .child(text(w.spentUsd !== null ? `$${w.spentUsd.toFixed(2)}${w.limitUsd !== null ? ` / $${w.limitUsd.toFixed(2)}` : ""}`
        : w.remainingCredits !== null ? `${w.remainingCredits} ${w.creditUnit}` : "", t).text_size(10)));
}
export function laneStatus(lane, snapshot, enabled, cfg, now) {
  if (!enabled || !cfg.consent) return tr(cfg, "paused");
  if (snapshot?.error) return tr(cfg, snapshot.error);
  if (!lane) return tr(cfg, "idle");
  if (lane.status !== "fresh") return tr(cfg, lane.status);
  return isStale(lane, cfg, now) ? tr(cfg, "stale") : "";
}
export function creditsText(lane, cfg) {
  const c = lane?.credits;
  if (!c) return tr(cfg, "filtered");
  if (c.unlimited) return `${tr(cfg, "credits")}: ∞`;
  return c.remaining === null ? tr(cfg, "filtered") : `${tr(cfg, "credits")}: ${c.unit === "usd" ? "$" : c.unit === "cny" ? "¥" : ""}${c.remaining.toFixed(2)}${c.unit === "credits" ? " credits" : ""}`;
}
export function providerCard(item, cfg, t, now, refresh) {
  const { id, lane, snapshot, busy } = item, p = provider(id);
  const status = busy ? tr(cfg, "loading") : laneStatus(lane, snapshot, cfg.providers[id].query, cfg, now);
  const head = lane && headline(lane, cfg, now);
  const title = `${p.name}${item.multiple ? ` · ${tr(cfg, "account")} ${lane.key.slice(-4)}` : ""}`;
  const card = column().id(`provider-${id}-${lane?.key ?? "empty"}`).p(10).rounded(7).bg(t.raised)
    .child(row().justify_between().child(row()
      .child(providerIcon(id, t.foreground))
      .child(column().gap(2).child(text(title, t, false).font_semibold())
        .child(text(lane?.plan ?? "", t).text_size(10))))
      .child(button(`refresh-${id}-${lane?.key ?? "empty"}`, "↻", cx => refresh(id, cx), t)));
  if (status) card.child(text(status, t).text_size(11));
  if (lane?.reason) card.child(note(tr(cfg, lane.reason), t));
  if (!lane) return card;
  if (cfg.mode === "detailed") {
    card.children(visibleWindows(lane, cfg).map(w => meter(w, cfg, t, now)));
    if (!visibleWindows(lane, cfg).length) card.child(note(creditsText(lane, cfg), t));
  } else if (head) {
    card.child(row().justify_between().child(text(head.label, t))
      .child(div().text_color(tone(head, t)).font_semibold().child(`${Math.round(displayPercent(head, cfg, now))}%`))
      .child(text(countdown(head.resetsAt, now), t)));
  } else card.child(note(creditsText(lane, cfg), t));
  card.child(text(`${tr(cfg, "updated")}: ${new Date(lane.refreshedAt).toLocaleString()}`, t).text_size(10));
  if (snapshot.retryAt > now) card.child(text(`${tr(cfg, "retry")}: ${countdown(snapshot.retryAt, now)}`, t).text_size(10));
  return card;
}
const FAILED = ["unavailable", "auth_required", "rate_limited", "error"];
function nullHeadlineKey(lane, cfg, now) {
  if (!lane) return "idle";
  const visible = visibleWindows(lane, cfg);
  if (!visible.length) return "filtered";
  if (visible.some(w => w.share)) return "shared";
  if (visible.some(w => w.resetsAt && w.resetsAt <= now)) return "resetDue";
  if (visible.some(w => !w.trusted)) return "unknown";
  return "filtered";
}
export function stripFace(item, cfg, t, now) {
  const queried = cfg.consent && cfg.providers[item.id].query;
  const head = item.lane ? headline(item.lane, cfg, now) : null;
  const shown = head ? displayPercent(head, cfg, now) : null;
  const text = typeof shown === "number" ? `${Math.round(shown)}%` : "—";
  const liveDigits = head && typeof shown === "number";
  const failed = item.snapshot?.error || FAILED.includes(item.lane?.status);
  if (!queried) return { text, color: liveDigits ? t.muted : t.dim, key: "paused", head };
  if (item.busy) return { text, color: liveDigits ? t.muted : t.dim, key: "loading", head };
  if (!liveDigits && failed) return { text: "—", color: t.ansi1, key: item.snapshot?.error || item.lane.status, head: null };
  if (!liveDigits) return { text: "—", color: t.dim, key: nullHeadlineKey(item.lane, cfg, now), head: null };
  if (item.snapshot?.error || item.lane.status !== "fresh" || isStale(item.lane, cfg, now)) {
    const key = item.snapshot?.error || (item.lane.status !== "fresh" ? item.lane.status : "stale");
    return { text, color: t.muted, key, head };
  }
  return { text, color: pressureTone(head, cfg, t, now), key: "fresh", head };
}
// Logical px. The 14 is the mark slot. Tier 0 adds the countdown; tier 1 is mark, name and percent.
// The plan never sits on the chip: providers report it unevenly, so it lives in the tooltip and the card.
export function stripBudget(item, cfg, now, tier) {
  const name = provider(item.id).name.length * 8;
  const head = item.lane && headline(item.lane, cfg, now);
  let width = 8 + 14 + 4 + 36 + name + 4;
  if (tier < 1 && head?.resetsAt) width += 56 + 4;
  return width;
}
function fitStrip(items, width, cfg, now) {
  const gap = 10;
  const shell = 0; // The chips sit in the status-bar slot, which already has the row padding.
  const chrome = 13 + gap + 13; // refresh, the gap before settings, settings
  const overflowW = 36;
  const base = shell + chrome;
  const chipsWidth = (tier, list) => list.reduce((sum, item) => sum + stripBudget(item, cfg, now, tier), 0);
  // One trailing gap per chip, including the gap before refresh.
  const fitted = (tier, list) => base + chipsWidth(tier, list) + gap * list.length;
  for (let tier = 0; tier <= 1; tier++) {
    if (fitted(tier, items) <= width) return { tier, capacity: items.length };
  }
  let capacity = 0;
  for (let n = 1; n <= items.length; n++) {
    const list = items.slice(0, n);
    // (n - 1) gaps between chips, plus chip-to-+N, plus +N-to-refresh.
    const used = shell + chipsWidth(1, list) + gap * (n + 1) + overflowW + chrome;
    if (used > width) break;
    capacity = n;
  }
  return { tier: 1, capacity };
}
// Herdr's own program icons. image() keeps a colored mark; svg() tints a one-color glyph.
// Paths stay in the Herdr home. This mod does not copy the artwork.
const BRAND = {
  codex: ["icons/codex.svg", false],
  agy: ["icons/antigravity.svg", false],
  grok: ["icons/grok.svg", true],
  cursor: ["icons/cursor.svg", true],
  claude: ["icons/claude.svg", false],
  copilot: ["icons/copilot.svg", true],
  kimi: ["icons/kimi.svg", false],
  "opencode-go": ["icons/opencode.svg", true],
  commandcode: ["icons/command-code.svg", true],
};
function providerIcon(id, color) {
  const brand = BRAND[id];
  if (!brand) return image(`mods/quota-manager/icons/${id}.svg`).w(14).h(14).flex_none();
  const [path, tint] = brand;
  return tint ? svg(path).size(14).flex_none().text_color(color) : image(path).w(14).h(14).flex_none();
}
function refreshIcon(t) {
  return svg("mods/quota-manager/icons/refresh.svg").size(13).flex_none().text_color(t.muted);
}
function settingsIcon(t) {
  return svg("mods/quota-manager/icons/settings.svg").size(13).flex_none().text_color(t.muted);
}
function flatButton(id, visual, action, t, label, box, anchor) {
  const el = div().id(id).flex_none().items_center().justify_center()
    .text_size(11).rounded(4).cursor_pointer().text_color(t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); anchor?.(e?.bounds); })
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(visual);
  return box ? el.w(box).h(box).px(0).overflow_hidden() : el.px(4);
}
export function stripChip(item, cfg, t, now, open, tier, anchor) {
  const p = provider(item.id);
  const face = stripFace(item, cfg, t, now);
  const plan = item.lane?.plan ? ` · ${item.lane.plan}` : "";
  const tip = `${p.name}${plan}${item.multiple ? ` · ${item.lane.key.slice(-4)}` : ""}: ${face.head?.label ?? ""} ${face.text} ${tr(cfg, cfg.percentage)}\n${tr(cfg, face.key)}\n${face.head ? countdown(face.head.resetsAt, now) : ""}`;
  return h_flex().id(`chip-${item.id}-${item.lane?.key ?? "empty"}`).px(4).gap(4).items_center().flex_none().rounded(4)
    .cursor_pointer().hover(s => s.bg(t.hover))
    .role("button").accessibility_label(tip.replaceAll("\n", ", ")).tooltip(tip)
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); anchor?.(e?.bounds); })
    .on_click((_e, cx) => { cx.stop_propagation(); open(cx); })
    .child(div().w(14).h(14).flex_none().overflow_hidden().items_center().justify_center().child(providerIcon(item.id, t.foreground)))
    .child(div().text_size(11).text_color(t.foreground).whitespace_nowrap().child(p.name))
    .child(div().text_size(11).font_semibold().whitespace_nowrap().text_color(face.color).child(face.text))
    .when(tier < 1 && face.head?.resetsAt, el => el.child(div().text_size(10).text_color(t.dim).whitespace_nowrap().child(countdown(face.head.resetsAt, now))));
}
export function quotaStrip({ items, cfg, t, now, width, onUsage, onSettings, onRefresh, onAnchor, onStripBounds }) {
  const fit = fitStrip(items, width, cfg, now);
  const shown = items.slice(0, fit.capacity);
  const overflowLabel = `+${items.length - fit.capacity}`;
  // The strip is one control group: every chip and icon opens the popup against its right edge.
  return h_flex().id("quota-strip").flex_none().gap(10).items_center().overflow_hidden()
    .on_mouse_move(e => onStripBounds?.(e?.bounds))
    .when(items.length === 0, el => el.child(flatButton("open", tr(cfg, "stripEmpty"), onSettings, t, tr(cfg, "stripEmpty"), undefined, onAnchor)))
    .children(shown.map(item => stripChip(item, cfg, t, now, onUsage, fit.tier, onAnchor)))
    .when(items.length > fit.capacity, el => el.child(flatButton("overflow", overflowLabel, onUsage, t, overflowLabel, undefined, onAnchor)))
    .child(flatButton("bar-refresh", refreshIcon(t), onRefresh, t, tr(cfg, "refresh"), 13, onAnchor))
    .child(flatButton("bar-settings", settingsIcon(t), onSettings, t, tr(cfg, "settings"), 13, onAnchor));
}
export function quotaBar({ items, cfg, t, now, width, space, agentCount, needs, hint, onUsage, onSettings, onRefresh, onPalette, onWidth, onAnchor, onBarBounds, onStripBounds }) {
  const label = (id, icon, value) => h_flex().id(id).gap(6).items_center()
    .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none().text_color(t.muted))
    .child(div().child(value));
  return h_flex().id("quota-manager-bar").size_full().px(14).gap(16).items_center()
    .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
    // Chips stop their own mouse-down, so the bar learns its edge from pointer moves instead.
    .on_mouse_move(e => onBarBounds?.(e?.bounds))
    .child(label("machine-label", space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
    .when(Boolean(space?.branch), el => el.child(label("branch-label", "branch", space.branch)))
    .child(h_flex().id("agent-count").gap(6).items_center()
      .child(div().size(6).rounded(3).bg(t.dim))
      .child(`${agentCount} agents`)
      .when(needs > 0, el => el.child(div().id("needs-you").text_color(t.blocked).child(`· ${needs} needs you`))))
    .child(h_flex().id("quota-slot").flex_1().items_center().justify_end().overflow_hidden()
      .on_size_change((size, cx) => onWidth(size, cx))
      .child(quotaStrip({ items, cfg, t, now, width, onUsage, onSettings, onRefresh, onAnchor, onStripBounds })))
    .child(div().id("palette").flex_none().cursor_pointer().text_color(t.dim)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onPalette(); })
      .child(hint));
}

// Logical window px, like event.bounds. `at` is the popup's top-left corner (as in Herdr's better-tabs).
// The popup's bottom sits `gap` above the status bar. Its right edge lines up with the strip's right edge,
// so every chip and icon opens it in the same place; without strip bounds, with the pressed control.
// Null means no usable anchor: the caller opens a centered dialog instead.
export const POPUP = Object.freeze({ width: 540, height: 620, min: 240, gap: 6, edge: 8, bar: 28 });
export function popupPlacement(anchor, bar, strip = null, size = POPUP) {
  if (!anchor || ![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)) return null;
  const barTop = bar && Number.isFinite(bar.y) && bar.y <= anchor.y ? bar.y : anchor.y - Math.max(0, (POPUP.bar - anchor.height) / 2);
  const height = Math.min(size.height, Math.floor(barTop - POPUP.gap - POPUP.edge));
  if (height < POPUP.min) return null;
  const group = strip && Number.isFinite(strip.x) && Number.isFinite(strip.width)
    && anchor.x >= strip.x - 1 && anchor.x + anchor.width <= strip.x + strip.width + 1 ? strip : anchor;
  const x = Math.max(POPUP.edge, Math.round(group.x + group.width - size.width));
  return { at: { x, y: Math.round(barTop - POPUP.gap - height) }, width: size.width, height };
}

// Settings vocabulary. Sizes and tokens follow Herdr's own settings mod (better-config) so the
// popup reads as part of the app: a pill switch, a segmented choice, and a title-left/control-right row.
function pressable(el, label, action) {
  return el.cursor_pointer().role("button").accessibility_label(label)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); });
}
export function switchControl(id, on, action, t, label) {
  // Off sits on the card's raised fill, so its track is the field color plus a hairline, not a hover tint.
  return pressable(div().id(id).w(36).h(20).flex_none().rounded(10).p(2).flex().items_center()
    .border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background).when(on, el => el.justify_end())
    .child(div().w(14).h(14).rounded(7).bg(on ? t.accent_foreground : t.muted)), `${label}: ${on ? "on" : "off"}`, action);
}
export function segmented(id, values, selected, select, t) {
  return h_flex().id(id).flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.background)
    .children(values.map(([value, name]) => {
      const on = selected === value;
      return pressable(div().id(`${id}-${value}`).px(10).py(3).rounded(6).text_size(12).whitespace_nowrap()
        .border_1().border_color(on ? t.border : t.background)
        .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
        .when(!on, el => el.hover(s => s.text_color(t.foreground))), name, cx => select(value, cx)).child(name);
    }));
}
export function chip(id, label, on, action, t) {
  return pressable(div().id(id).px(8).py(3).rounded(6).text_size(12).whitespace_nowrap().border_1()
    .border_color(on ? t.accent : t.border).bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
    .hover(s => s.text_color(t.foreground)), `${label}: ${on ? "on" : "off"}`, action).child(label);
}
export function ghostButton(id, label, action, t) {
  return pressable(div().id(id).flex_none().px(8).py(3).rounded(6).text_size(12).whitespace_nowrap().text_color(t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground)), label, action).child(label);
}
export function iconButton(id, glyph, action, t, label) {
  return pressable(div().id(id).w(24).h(24).flex_none().flex().items_center().justify_center().rounded(6)
    .text_size(14).text_color(t.muted).tooltip(label).hover(s => s.bg(t.hover).text_color(t.foreground)), label, action).child(glyph);
}
// The first row of a card draws no rule; every later one draws the card's hairline above itself.
export function settingRow(id, title, hint, control, t, stacked = false) {
  const words = v_flex().flex_1().min_w(0).gap(2)
    .child(div().text_size(12.5).text_color(t.foreground).child(title))
    .when(Boolean(hint), el => el.child(div().text_size(11).text_color(t.muted).child(hint)));
  return stacked
    ? v_flex().id(id).w_full().gap(8).py(10).child(words).child(control)
    : h_flex().id(id).w_full().gap(16).py(10).items_center().child(words).child(control);
}
export function group(id, title, rows, t, action = null) {
  const card = v_flex().w_full().px(12).rounded(8).border_1().border_color(t.border).bg(t.raised)
    .children(rows.filter(Boolean).map((row, index) => index ? row.border_t(1).border_color(t.border) : row));
  return v_flex().id(id).w_full().gap(6)
    .child(h_flex().w_full().px(2).items_center().justify_between()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title))
      .when(Boolean(action), el => el.child(action)))
    .child(card);
}
const column48 = child => div().w(48).flex_none().flex().justify_center().child(child);
export function hintBlock(lines, t, error = null) {
  return v_flex().w_full().gap(2).py(8)
    .children(lines.map(line => div().text_size(11).text_color(t.muted).child(line)))
    .when(Boolean(error), el => el.child(div().text_size(11).text_color(t.ansi1).child(error)));
}
export function noticeBox(message, actions, t) {
  return v_flex().w_full().gap(8).py(10)
    .child(div().text_size(11.5).text_color(t.ansi3).child(message))
    .child(row().children(actions));
}
export function providerColumns(queryLabel, showLabel, t) {
  return h_flex().w_full().gap(8).pt(8).pb(2).items_center()
    .child(div().flex_1())
    .child(column48(div().text_size(11).text_color(t.muted).child(queryLabel)))
    .child(column48(div().text_size(11).text_color(t.muted).child(showLabel)));
}
// Keyboard selection uses hover fill and an accent tick, never t.selected, so it cannot swallow a switch.
export function providerRow(r, t) {
  return h_flex().id(`select-${r.id}`).w_full().gap(8).py(6).items_center().cursor_pointer()
    .when(r.selected, el => el.bg(t.hover))
    .on_click((_e, cx) => r.onSelect(cx))
    .child(div().w(2).h(16).flex_none().rounded(1).bg(r.selected ? t.accent : t.raised))
    .child(providerIcon(r.id, t.foreground))
    .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).whitespace_nowrap().child(r.name))
    .when(r.detected !== null, el => el.child(div().text_size(10.5).whitespace_nowrap()
      .text_color(r.detected ? t.ansi2 : t.dim).child(r.detectedLabel)))
    .when(r.arrows, el => el
      .child(iconButton(`up-${r.id}`, "↑", r.onUp, t, "↑"))
      .child(iconButton(`down-${r.id}`, "↓", r.onDown, t, "↓")))
    .child(column48(switchControl(`query-${r.id}`, r.query, r.onQuery, t, `${r.name} ${r.queryLabel}`)))
    .child(column48(switchControl(`show-${r.id}`, r.show, r.onShow, t, `${r.name} ${r.showLabel}`)));
}
export function settingsPage(groups, footer, t) {
  return v_flex().w_full().gap(16).pb(4).children(groups)
    .child(div().px(2).text_size(11).text_color(t.dim).child(footer));
}
export function dialogHeader({ title, machine, onHelp, onClose, helpLabel, closeLabel }, t) {
  return h_flex().w_full().gap(8).items_center()
    .child(div().text_size(15).font_semibold().text_color(t.foreground).whitespace_nowrap().child(title))
    .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).whitespace_nowrap().truncate().child(`· ${machine}`))
    .child(iconButton("help", "?", onHelp, t, helpLabel))
    .child(iconButton("close", "×", onClose, t, closeLabel));
}
