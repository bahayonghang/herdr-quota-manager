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
export function choice(id, label, values, selected, select, t) {
  return column().child(text(label, t)).child(row().flex_wrap().children(values.map(([value, name]) =>
    button(`${id}-${value}`, name, cx => select(value, cx), t, selected === value))));
}
export function toggle(id, label, enabled, action, t) {
  return button(id, `${enabled ? "✓" : "○"} ${label}`, action, t, enabled);
}
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
      .child(providerIcon(id))
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
// Logical px. The 14 is the mark slot. Tiers 0–2 always count the name; do not pass 3.
export function stripBudget(item, cfg, now, tier) {
  const name = provider(item.id).name.length * 8;
  const head = item.lane && headline(item.lane, cfg, now);
  let width = 8 + 14 + 4 + 36;
  if (tier < 3) width += name + 4;
  if (tier < 2 && item.lane?.plan) width += Math.min(64, 12 + [...item.lane.plan].length * 8) + 4;
  if (tier < 1 && head?.resetsAt) width += 56 + 4;
  return width;
}
function fitStrip(items, width, cfg, now) {
  const gap = 10;
  const shell = 12 + 16; // row px(6)*2 + pill px(8)*2
  const chrome = 13 + gap + 13; // refresh, the gap before settings, settings
  const overflowW = 36;
  const base = shell + chrome;
  const chipsWidth = (tier, list) => list.reduce((sum, item) => sum + stripBudget(item, cfg, now, tier), 0);
  // One trailing gap per chip, including the gap before refresh.
  const fitted = (tier, list) => base + chipsWidth(tier, list) + gap * list.length;
  for (let tier = 0; tier <= 2; tier++) {
    if (fitted(tier, items) <= width) return { tier, capacity: items.length };
  }
  let capacity = 0;
  for (let n = 1; n <= items.length; n++) {
    const list = items.slice(0, n);
    // (n - 1) gaps between chips, plus chip-to-+N, plus +N-to-refresh.
    const used = shell + chipsWidth(2, list) + gap * (n + 1) + overflowW + chrome;
    if (used > width) break;
    capacity = n;
  }
  return { tier: 2, capacity };
}
function providerIcon(id) {
  return image(`mods/quota-manager/icons/${id}.svg`).w(14).h(14).flex_none();
}
function refreshIcon(t) {
  return svg("mods/quota-manager/icons/refresh.svg").size(13).flex_none().text_color(t.muted);
}
function settingsIcon(t) {
  return svg("mods/quota-manager/icons/settings.svg").size(13).flex_none().text_color(t.muted);
}
function flatButton(id, visual, action, t, label, box) {
  const el = div().id(id).flex_none().items_center().justify_center()
    .text_size(11).rounded(4).cursor_pointer().text_color(t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(visual);
  return box ? el.w(box).h(box).px(0).overflow_hidden() : el.px(4);
}
export function stripChip(item, cfg, t, now, open, tier) {
  const p = provider(item.id);
  const face = stripFace(item, cfg, t, now);
  const tip = `${p.name}${item.multiple ? ` · ${item.lane.key.slice(-4)}` : ""}: ${face.head?.label ?? ""} ${face.text} ${tr(cfg, cfg.percentage)}\n${tr(cfg, face.key)}\n${face.head ? countdown(face.head.resetsAt, now) : ""}`;
  return h_flex().id(`chip-${item.id}-${item.lane?.key ?? "empty"}`).px(4).gap(4).items_center().flex_none().rounded(4)
    .cursor_pointer().hover(s => s.bg(t.hover))
    .role("button").accessibility_label(tip.replaceAll("\n", ", ")).tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); open(cx); })
    .child(div().w(14).h(14).flex_none().overflow_hidden().items_center().justify_center().child(providerIcon(item.id)))
    .child(div().text_size(11).text_color(t.foreground).whitespace_nowrap().child(p.name))
    .when(tier < 2 && item.lane?.plan, el => el.child(div().text_size(10).px(4).rounded(4).bg(t.selected).text_color(t.muted).max_w(64).truncate().child(item.lane.plan)))
    .child(div().text_size(11).font_semibold().whitespace_nowrap().text_color(face.color).child(face.text))
    .when(tier < 1 && face.head?.resetsAt, el => el.child(div().text_size(10).text_color(t.dim).whitespace_nowrap().child(countdown(face.head.resetsAt, now))));
}
export function quotaStrip({ items, cfg, t, now, width, onUsage, onSettings, onRefresh }) {
  const fit = fitStrip(items, width, cfg, now);
  const shown = items.slice(0, fit.capacity);
  const overflowLabel = `+${items.length - fit.capacity}`;
  return h_flex().id("quota-strip").flex_none().h(24).px(8).gap(10).items_center()
    .rounded(8).bg(t.chrome).border(1).border_color(t.border).overflow_hidden()
    .when(items.length === 0, el => el.child(flatButton("open", tr(cfg, "stripEmpty"), onSettings, t, tr(cfg, "stripEmpty"))))
    .children(shown.map(item => stripChip(item, cfg, t, now, onUsage, fit.tier)))
    .when(items.length > fit.capacity, el => el.child(flatButton("overflow", overflowLabel, onUsage, t, overflowLabel)))
    .child(flatButton("bar-refresh", refreshIcon(t), onRefresh, t, tr(cfg, "refresh"), 13))
    .child(flatButton("bar-settings", settingsIcon(t), onSettings, t, tr(cfg, "settings"), 13));
}
