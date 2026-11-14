import { View } from "gpui-kit";
import { exec, props, theme, shared, setShared, spaces, agents, keys, window, knownAgents, openOverlay, closeOverlay, nextCommand, run, notify, home, appHome } from "herdr";
import { IDS, provider, detectedProviders } from "./providers.js";
import { CONFIG_KEY, INTERVALS, KINDS, normalizeConfig, changeConfig, moveProvider, machineFor, selectedProviders } from "./config.js";
import { headline } from "./model.js";
import { QuotaStore, stateKey } from "./store.js";
import { tr } from "./i18n.js";
import { button, line, text, note, row, column, providerCard, quotaBar, popupPlacement, POPUP,
  switchControl, segmented, chip, ghostButton, settingRow, group, providerRow, providerColumns, hintBlock, noticeBox, settingsPage, dialogHeader } from "./ui.js";

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
  poll(cx, force = false, only = null, anchor = null) {
    if (force && !selectedProviders(this.config()).some(id => !only || id === only)) {
      this.open("settings", anchor); cx.notify(); return;
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
  // A press on the bar passes its bounds and gets a popup above the bar. Keys and commands have no
  // pointer, so they get a centered dialog rather than the host's pointer default over the bar.
  open(view = "usage", anchor = null) {
    if (this.screen !== "bar") { this.screen = view; return; }
    const place = popupPlacement(anchor, this.barBounds, this.stripBounds);
    // The host shrinks a popup to its content; the view pins this height so a short page keeps its place.
    const props = { view, on: this.host(), height: place?.height ?? POPUP.height };
    openOverlay(place ? { mod: "quota-manager", kind: "popup", ...place, props }
      : { mod: "quota-manager", kind: "dialog", width: POPUP.width, height: POPUP.height, props });
  }
  takeAnchor() { const anchor = this.anchor ?? null; this.anchor = null; return anchor; }
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
  move(id, delta, cx) {
    const next = moveProvider(this.config(), id, delta);
    setShared(CONFIG_KEY, next);
    this.selected = Math.max(0, next.order.indexOf(id));
    cx.notify();
  }
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
        else this.selected = Math.min(IDS.length - 1, Math.max(0, this.selected + delta));
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
        onUsage: () => this.open("usage", this.takeAnchor()),
        onSettings: () => this.open("settings", this.takeAnchor()),
        onRefresh: cx => this.poll(cx, true, null, this.takeAnchor()),
        onAnchor: bounds => { this.anchor = bounds ?? null; },
        onBarBounds: bounds => { if (bounds) this.barBounds = bounds; },
        onStripBounds: bounds => { if (bounds) this.stripBounds = bounds; },
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
    const machine = this.host() ?? tr(cfg, "local");
    return column().id("quota-manager-dialog").w_full().h(props()?.height ?? POPUP.height).p(12).gap(12).bg(t.popover).text_color(t.foreground).text_size(12)
      .track_focus(this.focusHandle).on_key_down((e, cx) => this.key(e, cx))
      .child(dialogHeader({ title: tr(cfg, "title"), machine, helpLabel: tr(cfg, "setup"), closeLabel: tr(cfg, "close"),
        onHelp: cx => { this.screen = "help"; cx.notify(); },
        onClose: () => { if (props()?.overlay) closeOverlay(props().overlay); } }, t))
      .child(row().child(segmented("tab", ["usage", "settings", "history"].map(view => [view, tr(cfg, view)]), this.screen, (view, cx) => { this.screen = view; cx.notify(); }, t)))
      .child(column().id("quota-manager-scroll").flex_1().overflow_y_scrollbar().child(body));
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
    const machine = this.host() ?? tr(cfg, "local");
    const collect = group("group-collect", tr(cfg, "groupCollect"), [
      settingRow("row-consent", tr(cfg, "consentRow"), tr(cfg, "consentHint").replace("{machine}", machine),
        switchControl("consent", cfg.consent, cx => {
          this.save({ consent: !cfg.consent }, cx); if (!cfg.consent) this.poll(cx, true);
        }, t, tr(cfg, "consentRow")), t),
      settingRow("row-scope", tr(cfg, "machine"), "",
        segmented("scope", ["current", "local"].map(v => [v, tr(cfg, v)]), cfg.scope, (scope, cx) => this.setScope(scope, cx), t), t),
      settingRow("row-interval", tr(cfg, "interval"), tr(cfg, "intervalHint"),
        segmented("interval", INTERVALS.map(n => [n, n ? String(n / 60000) : tr(cfg, "manualShort")]), cfg.interval, (interval, cx) => this.save({ interval }, cx), t), t),
    ], t);

    const tools = row().gap(2)
      .child(ghostButton("detect", this.detecting ? "…" : tr(cfg, "detect"), cx => this.detect(cx), t))
      .when(seen !== null, el => el.child(ghostButton("select-detected", tr(cfg, "selectDetected"), cx => {
        const providers = Object.fromEntries(IDS.map(id => [id, { query: seen.includes(id) && id !== "muse", show: seen.includes(id) && id !== "muse" }]));
        this.save({ providers }, cx);
      }, t)))
      .child(ghostButton("none", tr(cfg, "none"), cx => this.save({ providers: Object.fromEntries(IDS.map(id => [id, { query: false, show: false }])) }, cx), t));
    const custom = cfg.sort === "custom";
    const providerRows = cfg.order.map((id, index) => {
      const p = provider(id), setting = cfg.providers[id], selected = this.selected === index;
      return providerRow({ id, name: p.name, selected, arrows: custom && selected,
        detected: seen === null ? null : seen.includes(id), detectedLabel: seen === null ? "" : tr(cfg, seen.includes(id) ? "detected" : "notDetected"),
        query: setting.query, show: setting.show, queryLabel: tr(cfg, "query"), showLabel: tr(cfg, "show"),
        onSelect: cx => { this.selected = index; cx.notify(); },
        onUp: cx => this.move(id, -1, cx), onDown: cx => this.move(id, 1, cx),
        onQuery: cx => this.flip(id, "query", cx), onShow: cx => this.flip(id, "show", cx) }, t);
    });
    const providers = group("group-providers", tr(cfg, "groupProviders"), [
      hintBlock([tr(cfg, "providersHint"), tr(cfg, "detectionHint")], t, this.detectionError ? tr(cfg, "detectFailed") : null),
      this.museWarning ? noticeBox(tr(cfg, "museWarning"), [
        ghostButton("muse-confirm", tr(cfg, "accept"), cx => {
          this.museWarning = false; this.save({ museConsent: true, providers: { muse: { ...cfg.providers.muse, query: true } } }, cx);
        }, t),
        ghostButton("muse-cancel", tr(cfg, "cancel"), cx => { this.museWarning = false; cx.notify(); }, t),
      ], t) : null,
      providerColumns(tr(cfg, "query"), tr(cfg, "show"), t),
      column().gap(0).pb(6).children(providerRows),
    ], t, tools);

    const display = group("group-display", tr(cfg, "groupDisplay"), [
      settingRow("row-percentage", tr(cfg, "percentRow"), "",
        segmented("percentage", ["remaining", "used"].map(v => [v, tr(cfg, v)]), cfg.percentage, (percentage, cx) => this.save({ percentage }, cx), t), t),
      settingRow("row-sort", tr(cfg, "sort"), "",
        segmented("sort", [["custom", tr(cfg, "custom")], ["remaining", tr(cfg, "tightest")]], cfg.sort, (sort, cx) => this.save({ sort }, cx), t), t),
      settingRow("row-language", tr(cfg, "language"), "",
        segmented("language", [["en", "English"], ["zh", "中文"]], cfg.language, (language, cx) => this.save({ language }, cx), t), t),
      settingRow("row-windows", tr(cfg, "windows"), "",
        row().flex_wrap().children(KINDS.map(kind => chip(`kind-${kind}`, tr(cfg, kind), cfg.kinds[kind], cx => this.save({ kinds: { [kind]: !cfg.kinds[kind] } }, cx), t))), t, true),
      settingRow("row-unavailable", tr(cfg, "unavailableToggle"), tr(cfg, "unavailableHint"),
        switchControl("unavailable", cfg.showUnavailable, cx => this.save({ showUnavailable: !cfg.showUnavailable }, cx), t, tr(cfg, "unavailableToggle")), t),
    ], t);

    const alerts = group("group-alerts", tr(cfg, "groupAlerts"), [
      settingRow("row-threshold", tr(cfg, "warnings"), "",
        segmented("threshold", [0, 5, 10, 20].map(n => [n, n ? `${n}%` : tr(cfg, "off")]), cfg.threshold, (threshold, cx) => this.save({ threshold }, cx), t), t),
      settingRow("row-history", tr(cfg, "historyTitle"), tr(cfg, "historyLimit"),
        switchControl("history-enabled", cfg.history, cx => this.save({ history: !cfg.history }, cx), t, tr(cfg, "historyTitle")), t),
    ], t);

    return settingsPage([collect, providers, display, alerts], tr(cfg, "privacy"), t);
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
