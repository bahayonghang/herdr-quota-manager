import { View } from "gpui-kit";
import { exec, props, theme, shared, setShared, spaces, agents, keys, window, knownAgents, openOverlay, closeOverlay, nextCommand, run, notify, home, appHome } from "herdr";
import { IDS, provider, detectedProviders } from "./providers.js";
import { CONFIG_KEY, INTERVALS, KINDS, normalizeConfig, changeConfig, moveProvider, machineFor, selectedProviders } from "./config.js";
import { headline } from "./model.js";
import { QuotaStore, stateKey } from "./store.js";
import { tr } from "./i18n.js";
import { button, line, text, note, row, column, choice, toggle, providerCard, quotaBar } from "./ui.js";

export default class QuotaManager extends View {
  init(_props, cx) {
    this.screen = props()?.view ?? "bar";
    this.width = 800;
    this.selected = 0;
    this.detected = null;
    this.focusHandle = cx.focus_handle();
    this.store = new QuotaStore({ read: shared, write: setShared, exec,
      local: { home: () => home(), appHome: () => appHome() },
      alert: e => notify({ title: `${provider(e.provider).name} · ${Math.round(e.remaining)}%`,
        body: `${e.host ?? tr(this.config(), "local")} · ${e.label}`, level: "warning", timeout: 6000 }),
    });
    if (this.screen !== "bar") this.focusHandle.focus();
    this.poll(cx);
    // Data admission is cheap; unchanged snapshots never write shared state.
    cx.timer.every(10000, cx => this.poll(cx));
    cx.timer.every(30000, cx => cx.notify());
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.focusHandle.focus();
        else if (command === "refresh") this.poll(cx, true);
        else if (["menu", "settings", "history"].includes(command)) this.open(command === "menu" ? "usage" : command);
        cx.notify();
      }
    });
  }
  config() { return normalizeConfig(shared(CONFIG_KEY)); }
  host() {
    const p = props();
    const pinned = this.scopeHost !== undefined ? this.scopeHost : p?.view && Object.prototype.hasOwnProperty.call(p, "on") ? p.on : undefined;
    return machineFor(this.config(), spaces(), pinned);
  }
  save(patch, cx) { setShared(CONFIG_KEY, changeConfig(this.config(), patch)); cx.notify(); }
  setScope(scope, cx) {
    if (this.screen !== "bar") this.scopeHost = machineFor({ ...this.config(), scope }, spaces());
    this.save({ scope }, cx);
  }
  poll(cx, force = false, only = null) {
    if (force && !selectedProviders(this.config()).some(id => !only || id === only)) {
      this.open("settings"); cx.notify(); return;
    }
    const host = this.host();
    // herdr-app check has no window, so window() is null. A missing platform tries every launcher.
    const platform = host === null ? (window()?.platform ?? "unknown") : "unknown";
    cx.spawn(async cx => {
      const deadline = async (promise, ms) => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_resolve, reject) => {
            timer = cx.timer.after(ms, () => reject(new Error("query timed out")));
          })]);
        } finally { timer?.cancel(); }
      };
      await this.store.refresh(host, platform, { force, only, deadline: host === null ? deadline : null });
      cx.notify();
    });
  }
  open(view = "usage") {
    if (this.screen !== "bar") { this.screen = view; return; }
    openOverlay({ mod: "quota-manager", kind: "popup", width: 540, height: 620, props: { view, on: this.host() } });
  }
  close() { this.store?.close(); }
  detect(cx) {
    if (this.detecting) return;
    const host = this.host();
    this.detecting = true; this.detectionError = false;
    cx.spawn(async cx => {
      try { this.detected = { host, ids: detectedProviders(await knownAgents({ on: host })) }; }
      catch { this.detectionError = true; }
      finally { this.detecting = false; cx.notify(); }
    });
  }
  flip(id, field, cx) {
    const cfg = this.config(), p = cfg.providers[id];
    if (id === "muse" && field === "query" && !p.query && !cfg.museConsent) {
      this.museWarning = true; cx.notify(); return;
    }
    this.save({ providers: { [id]: { ...p, [field]: !p[field] } } }, cx);
  }
  move(id, delta, cx) { setShared(CONFIG_KEY, moveProvider(this.config(), id, delta)); cx.notify(); }
  key(e, cx) {
    const key = e.keystroke;
    if (key === "escape") {
      if (props()?.overlay) closeOverlay(props().overlay);
      else run("pane.go", { direction: "up" });
    } else if (key === "r") this.poll(cx, true);
    else if (key === "s") this.open("settings");
    else if (key === "h") this.open("history");
    else if (key === "u" || key === "enter") this.open("usage");
    else if (this.screen === "settings" && ["up", "down", "ctrl-up", "ctrl-down", "space", "shift-space"].includes(key)) {
      const cfg = this.config(), id = cfg.order[this.selected];
      if (key === "space" || key === "shift-space") this.flip(id, key === "space" ? "query" : "show", cx);
      else {
        const delta = key.endsWith("up") ? -1 : 1;
        if (key.startsWith("ctrl-")) this.move(id, delta, cx);
        this.selected = Math.min(IDS.length - 1, Math.max(0, this.selected + delta));
      }
    } else return;
    cx.stop_propagation(); cx.notify();
  }
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const binding = (keys() ?? []).find(k => k.section === "global" && k.action === "app.palette");
    const parts = binding && binding.keys.endsWith("--") ? [...binding.keys.slice(0, -2).split("-"), "-"] : binding?.keys.split("-");
    const key = parts && parts.map(part => mod[part.toLowerCase()] ?? part.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }
  items(cfg) {
    const host = this.host(), now = Date.now(), items = [];
    for (const id of cfg.order.filter(id => cfg.providers[id].show)) {
      const snapshot = this.store.snapshot(host, id), lanes = snapshot?.lanes ?? [];
      if (!lanes.length) {
        if (cfg.showUnavailable) items.push({ id, lane: null, snapshot, busy: this.store.busy(host, id) });
      } else for (const lane of lanes) {
        if (!cfg.showUnavailable && !lane.windows.length && !lane.credits) continue;
        items.push({ id, lane, snapshot, busy: this.store.busy(host, id), multiple: lanes.length > 1 });
      }
    }
    if (cfg.sort === "remaining") items.sort((a, b) =>
      (a.lane ? headline(a.lane, cfg, now)?.remaining ?? 101 : 101) -
      (b.lane ? headline(b.lane, cfg, now)?.remaining ?? 101 : 101));
    return items;
  }
  render(cx) {
    const cfg = this.config(), t = theme(), now = Date.now();
    if (!this.store) return text("Quota Manager", t); // Initial headless description can precede init.
    const items = this.items(cfg);
    if (this.screen === "bar") {
      const space = (spaces() ?? []).find(item => item.active);
      const list = agents() ?? [];
      return quotaBar({
        items, cfg, t, now, width: this.width, space, hint: this.hint(),
        agentCount: list.length, needs: list.filter(agent => agent.status === "blocked").length,
        onUsage: () => this.open("usage"),
        onSettings: () => this.open("settings"),
        onRefresh: cx => this.poll(cx, true),
        onPalette: () => run("app.palette"),
        onWidth: (size, cx) => {
          if (Math.abs(this.width - size.width) > 1) { this.width = size.width; cx.notify(); }
        },
      }).track_focus(this.focusHandle).on_key_down((e, cx) => this.key(e, cx));
    }
    const body = this.screen === "settings" ? this.settingsView(cfg, t)
      : this.screen === "history" ? this.historyView(cfg, t)
      : this.screen === "help" ? this.helpView(cfg, t)
      : this.usageView(items, cfg, t, now);
    return column().id("quota-manager-dialog").size_full().p(12).gap(10).bg(t.popover).text_color(t.foreground).text_size(12)
      .track_focus(this.focusHandle).on_key_down((e, cx) => this.key(e, cx))
      .child(row().justify_between().child(text(tr(cfg, "title"), t, false).font_semibold().text_size(15))
        .child(button("close", "×", () => { if (props()?.overlay) closeOverlay(props().overlay); }, t)))
      .child(text(`${tr(cfg, "machine")}: ${this.host() ?? tr(cfg, "local")}`, t).text_size(11))
      .child(row().children(["usage", "settings", "history"].map(view => button(`tab-${view}`, tr(cfg, view), cx => { this.screen = view; cx.notify(); }, t, this.screen === view))))
      .child(line(t))
      .child(column().id("quota-manager-scroll").flex_1().overflow_y_scrollbar().child(body))
      .child(button("help", tr(cfg, "setup"), cx => { this.screen = "help"; cx.notify(); }, t));
  }
  usageView(items, cfg, t, now) {
    return column().gap(10)
      .when(!cfg.consent, el => el.child(note(tr(cfg, "consent"), t)))
      .child(row().justify_between().child(row().children(["compact", "detailed"].map(mode =>
        button(`mode-${mode}`, tr(cfg, mode), cx => this.save({ mode }, cx), t, cfg.mode === mode))))
        .child(button("refresh-all", tr(cfg, "refresh"), cx => this.poll(cx, true), t)))
      .when(!items.length, el => el.child(note(tr(cfg, "empty"), t)))
      .children(items.map(item => providerCard(item, cfg, t, now, (id, cx) => this.poll(cx, true, id))));
  }
  settingsView(cfg, t) {
    const seen = this.detected?.host === this.host() ? this.detected.ids : null;
    const section = column().gap(10)
      .child(note(tr(cfg, "queryHint"), t))
      .child(button("consent", tr(cfg, cfg.consent ? "pause" : "start"), cx => {
        this.save({ consent: !cfg.consent }, cx); if (!cfg.consent) this.poll(cx, true);
      }, t, cfg.consent))
      .child(row().flex_wrap()
        .child(button("detect", this.detecting ? "…" : tr(cfg, "detect"), cx => this.detect(cx), t))
        .when(seen !== null, el => el.child(button("select-detected", tr(cfg, "selectDetected"), cx => {
          const providers = Object.fromEntries(IDS.map(id => [id, { query: seen.includes(id) && id !== "muse", show: seen.includes(id) && id !== "muse" }]));
          this.save({ providers }, cx);
        }, t)))
        .child(button("none", tr(cfg, "none"), cx => this.save({ providers: Object.fromEntries(IDS.map(id => [id, { query: false, show: false }])) }, cx), t)))
      .when(this.detectionError, el => el.child(note(tr(cfg, "detectFailed"), t)))
      .child(note(tr(cfg, "detectionHint"), t));
    if (this.museWarning) section.child(column().p(8).bg(t.raised).child(note(tr(cfg, "museWarning"), t)).child(row()
      .child(button("muse-confirm", tr(cfg, "accept"), cx => {
        this.museWarning = false; this.save({ museConsent: true, providers: { muse: { ...cfg.providers.muse, query: true } } }, cx);
      }, t))
      .child(button("muse-cancel", tr(cfg, "cancel"), cx => { this.museWarning = false; cx.notify(); }, t))));
    section.children(cfg.order.map((id, index) => {
      const p = provider(id), setting = cfg.providers[id];
      return row().id(`select-${id}`).p(4).rounded(5).bg(this.selected === index ? t.selected : t.popover)
        .child(column().flex_1().gap(1).child(text(p.name, t, false))
          .when(seen !== null, el => el.child(text(tr(cfg, seen.includes(id) ? "detected" : "notDetected"), t).text_size(10))))
        .child(toggle(`query-${id}`, tr(cfg, "query"), setting.query, cx => this.flip(id, "query", cx), t))
        .child(toggle(`show-${id}`, tr(cfg, "show"), setting.show, cx => this.flip(id, "show", cx), t))
        .child(button(`up-${id}`, "↑", cx => this.move(id, -1, cx), t))
        .child(button(`down-${id}`, "↓", cx => this.move(id, 1, cx), t));
    }));
    section.child(line(t))
      .child(choice("interval", tr(cfg, "interval"), INTERVALS.map(n => [n, n ? `${n / 60000} ${tr(cfg, "minutes")}` : tr(cfg, "manual")]), cfg.interval, (interval, cx) => this.save({ interval }, cx), t))
      .child(choice("percentage", tr(cfg, "display"), ["remaining", "used"].map(v => [v, tr(cfg, v)]), cfg.percentage, (percentage, cx) => this.save({ percentage }, cx), t))
      .child(choice("scope", tr(cfg, "machine"), ["current", "local"].map(v => [v, tr(cfg, v)]), cfg.scope, (scope, cx) => this.setScope(scope, cx), t))
      .child(choice("sort", tr(cfg, "sort"), [["custom", tr(cfg, "custom")], ["remaining", tr(cfg, "tightest")]], cfg.sort, (sort, cx) => this.save({ sort }, cx), t))
      .child(choice("language", tr(cfg, "language"), [["en", "English"], ["zh", "中文"]], cfg.language, (language, cx) => this.save({ language }, cx), t))
      .child(text(tr(cfg, "windows"), t))
      .child(row().flex_wrap().children(KINDS.map(kind => toggle(`kind-${kind}`, tr(cfg, kind), cfg.kinds[kind], cx => this.save({ kinds: { [kind]: !cfg.kinds[kind] } }, cx), t))))
      .child(toggle("unavailable", tr(cfg, "unavailableToggle"), cfg.showUnavailable, cx => this.save({ showUnavailable: !cfg.showUnavailable }, cx), t))
      .child(choice("threshold", tr(cfg, "warnings"), [0, 5, 10, 20].map(n => [n, n ? `${n}%` : tr(cfg, "off")]), cfg.threshold, (threshold, cx) => this.save({ threshold }, cx), t))
      .child(toggle("history-enabled", tr(cfg, "historyToggle"), cfg.history, cx => this.save({ history: !cfg.history }, cx), t))
      .child(note(tr(cfg, "privacy"), t));
    return section;
  }
  historyView(cfg, t) {
    const host = this.host(), output = column().child(note(tr(cfg, "historyHint"), t));
    let count = 0;
    for (const id of cfg.order) {
      const records = shared(stateKey("history", host, id)) ?? [];
      if (!records.length) continue;
      count++;
      output.child(text(provider(id).name, t, false).font_semibold());
      for (const record of records.slice(-6).reverse()) {
        output.child(text(new Date(record.at).toLocaleString(), t).text_size(10));
        for (const lane of record.rows) for (const w of lane.windows) {
          output.child(row().justify_between().child(text(`${lane.key.slice(-4)} · ${w.label}`, t))
            .child(text(`${Math.round(w.remaining)}% ${tr(cfg, "remaining")}`, t, false)));
        }
      }
      output.child(line(t));
    }
    if (!count) output.child(note(tr(cfg, "noHistory"), t));
    return output.child(button("clear-history", tr(cfg, "clearHistory"), cx => { this.store.clearHistory(host, IDS); cx.notify(); }, t));
  }
  helpView(cfg, t) {
    return column().gap(10).child(note(tr(cfg, "helpText"), t))
      .child(text("quota-axi --provider codex --json --no-credential-refresh", t, false))
      .child(note(tr(cfg, "privacy"), t))
      .child(note(tr(cfg, "keychain_access_required"), t))
      .child(note("quota-axi --provider <id> --allow-keychain-prompt --no-credential-refresh", t))
      .child(note("Keyboard: U / S / H / R · Settings: ↑ ↓, Space, Shift+Space, Ctrl+↑/↓", t));
  }
}
