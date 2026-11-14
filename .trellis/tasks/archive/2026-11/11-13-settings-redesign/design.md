# 设计：设置页

## 方向

沿用 Herdr 原生工具面板：只用 theme token，不加自定义色，不加动效。变化集中在控件词汇和信息架构上，组件尺寸直接取自同类组件 `~/.config/herdr-app/mods/better-config/main.js`。

## 新 builder（`ui.js`）

| Builder | 规格 | 替代 |
| --- | --- | --- |
| `switchControl(id, on, action, t, label)` | `w36 h20 rounded10 p2`；开：底 `t.accent`，圆点 `t.accent_foreground` 靠右；关：底 `t.hover`，圆点 `t.muted`；`role("switch")` 加 `accessibility_label` | `toggle()` 用于布尔量 |
| `segmented(id, values, selected, select, t)` | 外框 `p2 gap2 rounded8 border t.border bg t.background`；段 `px10 py4 rounded6 text_size12`；选中段 `bg t.raised` 加 border、`t.foreground`；未选中 `t.muted`，hover 变 `t.foreground`。段 id 仍为 `${id}-${value}` | `choice()` 的按钮组 |
| `settingRow(id, title, hint, control, t)` | `h_flex w_full gap16 py10 items_center`；左 `v_flex flex_1`：标题 `t.foreground` 12.5，说明 `t.muted` 11；右边放控件 | 标签在上的 `choice()` |
| `group(id, title, rows, t)` | 组标题 `text_size11 font_semibold t.muted`（大写英文 / 中文原样），放在卡片外；卡片 `rounded8 border t.border bg t.raised px12`；行之间 `border_t t.border`，第一行不画线 | 没有对应 |
| `ghostButton(id, label, action, t)` | 无底色，`t.muted` → hover `bg t.hover` 加 `t.foreground`，`px8 py4 rounded6` | 一次性动作用的 `button()` |
| `iconButton(id, glyph, action, t, label)` | `size24 rounded6`，hover `t.hover`，带 tooltip | 关闭按钮、帮助按钮 |

`toggle()` 还用于多选的 kind chip，但外观改成和分段里的段一致。`button()` 保留给 Usage 和 History 里没有改动的地方。

## 布局（`main.js` 中 `settingsView` 和 `render` 头部）

```
[Quota Manager]                         [?] [×]
[ Usage | Settings | History ]   ← segmented

采集
┌ 查询所选服务 · 在 本机 上查询          (switch) ┐
│ 机器                       [当前空间 | 本机]     │
│ 刷新间隔        [手动|1|2|5|10 分钟]             │
└──────────────────────────────────────────────────┘
服务                       检测已安装 · 选中检测结果 · 取消全部
┌ 检测到 CLI 不等于拥有订阅…（说明，一行）         ┐
│                                 查询   显示      │
│ ▌[icon] Codex   已检测到        (sw)   (sw)  ↑↓  │ ← 仅选中/悬停且自定义排序时
│  [icon] Antigravity              (sw)   (sw)     │
└──────────────────────────────────────────────────┘
显示 …   提醒与历史 …
隐私说明（muted 11px）
```

- 服务行：`id select-<id>`，`py6`。选中时 `bg t.hover`，并在最左侧画一个 `w2 h16 rounded1 bg t.accent` 的指示条。两列开关各放在 `w48` 的列里居中，保证对齐。
- ↑↓：`when(cfg.sort === "custom" && (selected || hovered))`。GPUI 没有 hover 状态回调时，退化成只在选中行显示（键盘 ↑↓ 选中，点击行也会把该行设为选中）。点击行设为选中是新增行为，需要补测试。
- 刷新间隔的段标签：`manual` 加数字，单位只在最后一段后面写一次。

## i18n

新增：`groupCollect`、`groupProviders`、`groupDisplay`、`groupAlerts`、`consentRow`（“查询所选服务”）、`consentHint`（“在 {machine} 上查询；关闭后不再采集”）、`queryCol`、`showCol`、`intervalShort` 等。每个 key 都要有中英文。`queryHint` 拆成两部分放进服务组。

## 取舍

- 不做 Orca 那样的侧边栏导航和搜索：540px 宽的弹窗里只有 4 组，一列滚动就够了。
- 不加 “Advanced” 折叠：额度周期和不可用服务放在显示组的末尾，数量不多。
- 刷新间隔不用下拉：下拉需要另一个 overlay 和焦点管理（better-config 的 `dropdown` 有约 60 行），5 段分段控件在 540 宽里放得下。spike 时如果英文超宽，再改成下拉。

## 兼容与回滚

- 配置结构、`save` / `changeConfig` / `moveProvider` 调用、测试 id 都不变。
- 回滚：`settingsView` 和头部是独立的函数，可以整体恢复；新 builder 只增不删，不影响 Usage 和 History。
