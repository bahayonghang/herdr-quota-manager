import { div } from "gpui-kit";
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
      .child(div().w(24).text_size(10).font_semibold().text_color(t.accent).child(p.glyph))
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
export function chip(item, cfg, t, now, open, small = false) {
  const p = provider(item.id), head = item.lane && headline(item.lane, cfg, now);
  const status = laneStatus(item.lane, item.snapshot, cfg.providers[item.id].query, cfg, now);
  const value = head ? `${Math.round(displayPercent(head, cfg, now))}%` : "—";
  const label = `${small ? p.glyph : p.name} ${value}${status ? " !" : ""}`;
  return button(`chip-${item.id}-${item.lane?.key ?? "empty"}`, label, open, t)
    .text_size(11).py(2)
    .tooltip(`${p.name}${item.multiple ? ` · ${item.lane.key.slice(-4)}` : ""}: ${head?.label ?? ""} ${value} ${tr(cfg, cfg.percentage)}\n${status || tr(cfg, "fresh")}\n${head ? countdown(head.resetsAt, now) : ""}`);
}
