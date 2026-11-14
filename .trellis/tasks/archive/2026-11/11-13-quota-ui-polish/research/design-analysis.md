# 设计分析：额度条与设置弹窗

日期：2026-11-13。证据：用户提供的两张截图（状态栏右下角、Settings 弹窗），`mods/quota-manager/ui.js`、`main.js`，Herdr 自带 mod `~/.config/herdr-app/mods/better-config/main.js`，Herdr 二进制里的 `OverlaySpec` 类型，Orca 文档与源码。

## 现有方向（保持不变）

Quota Manager 是 Herdr 原生 GPUI 里的一块安静的工具面板：只用 `theme()` 色板（`popover` / `raised` / `selected` / `hover` / `border` / `accent` / `muted` / `dim`），字号 10–15，没有动效。本轮只做增量打磨，不换风格，不引入自定义色。

## 问题 1：额度条 chip 结构不一致

- 现象：`Codex [prolite] 97% 6d 6h`，而 `Antigravity 49% 6d 2h`、`Grok 48% 1d 14h` 没有 plan 胶囊。
- 原因：`stripChip`（`ui.js:195`）只在 `item.lane?.plan` 有值时画胶囊；plan 来自 quota-axi 各 provider 自己的上报（`model.js:69`），Codex 报 `plan_type`，Grok 不报，Antigravity 有时报。“全部都显示”做不到，数据源不保证有值。
- 次要问题：胶囊用 `t.selected` 底色 + `rounded(4)`，是状态栏里唯一一个带填充的元素，视觉权重比百分比还高。
- Orca 参照：状态栏 provider segment 只放图标、名称、百分比和 mini bar，**不放 plan**；plan 只出现在点开后的 Usage popover（“icon · name · plan · soonest reset · per-window bars”）。
- 结论：从 chip 移除 plan，`stripBudget` 删掉 plan 这一档宽度。plan 留在 tooltip 和 Usage 卡片里（`providerCard` 已经显示）。

## 问题 2：弹窗盖住状态栏

- 现象：从状态栏点开 Settings，弹窗底边压到了 28px 状态栏上，下面只露出一半 `Codex prolite`。
- 原因：`open()`（`main.js:61`）调用 `openOverlay({ kind: "popup", width: 540, height: 620 })` 时没有传 `at`。Herdr 的类型定义写着 `popup: at \`at\` (default: the pointer)`，`at?: "pointer" | { x, y }`。默认把指针当锚点，窗口底部空间不够时，宿主把弹窗往上推到刚好贴着窗口底边，于是盖住了状态栏。
- 可用信号：鼠标事件带 `e.position`（窗口坐标）和 `e.local_position`（元素内坐标）。Herdr 自带 mod 有 `e.position.x / scale()` 这种写法，说明坐标单位需要实测确认（逻辑像素还是物理像素）。
- 结论：点击时记录状态栏根节点的顶边 y 和指针 x，`at` 取 `{ x: clamp(pointerX - width + 24), y: barTop - height - 6 }`。如果 `barTop - 12` 小于 620，就把 `height` 一并缩到这个值，让弹窗右下角贴着状态栏上沿。键盘或命令打开（没有指针）时改用 `kind: "dialog"` 居中。
- 风险：`at` 的坐标单位和宿主会不会再夹紧，只能在原生窗口里验证，所以要先做一个 spike。

## 问题 3：设置页“很丑”

截图中能直接看到的缺陷，按严重程度排：

1. **所有控件长一个样。** Tab、主开关、检测按钮、Query/Show、↑↓、Setup 全都调用同一个 `button()`（`raised` 底 + `px8 py5`）。用户分不清哪个是导航、哪个是开关、哪个是一次性动作。
2. **选中行把开关吃掉了。** 选中行底色是 `t.selected`（`main.js:200`），开关打开时底色也是 `t.selected`（`ui.js:9`）。结果 Codex 行的 `✓ Query ✓ Show` 和行背景融成一片，看起来像是没有按钮。
3. **列对不齐。** `✓ Query` 和 `○ Query` 的字形宽度不同，Antigravity 行的 Query 起点在 x≈790，Cursor 行在 x≈779，右侧一列在抖。
4. **主开关像输入框。** “Pause all queries” 是一条横跨全宽的 `raised` 条，没有状态说明，看起来像文本框或标题，而不是“当前在采集”这个最重要的状态开关。
5. **没有分组和层级。** 约 16 个 provider 行和 interval、display、language 等偏好挤在一条长滚动里；`choice()` 把标签放在按钮组上方，又是一种新的排列方式。没有分区标题，提示文字（11px、`px4`）的缩进和行（`p4`）也不一致。
6. **噪声多。** 每一行都常驻 ↑↓（选了“剩余最少优先”排序时它们根本没用）；`Machine: This computer` 这一行和下面的 Machine 设置重复；底部 “Setup / troubleshooting” 也是一条全宽 raised 条，看起来同样像输入框。
7. **Tab 不像 tab。** 三个 tab 就是三个普通按钮，和下面的动作按钮没有区别。

### 同类组件词汇（Herdr better-config，直接复用）

- 开关：`w36 h20 rounded10 p2`，开 `t.accent` + `accent_foreground` 圆点，关 `t.hover` + `t.muted` 圆点。
- 分段：外框 `p2 gap2 rounded8 border t.border bg t.background`；选中段 `bg t.raised` + border + `t.foreground`；未选中 `t.muted`，hover 变 `t.foreground`。不超过 4 个选项用分段，更多用下拉。
- 行：`h_flex w_full gap16 py12 items_center border_b t.border`；左边标题 + 一行说明（`flex_1`），右边控件。

### Orca 设置逻辑（借鉴结构，不抄样式）

- 一个 Section 下分若干 Group：组标题在卡片外，卡片内一行一个设置，行与行之间用细线隔开（`SettingsGroup`）。
- 每个设置都是“标题 + 说明 + 控件”（`SearchableSetting`），说明紧跟在它说明的那个控件旁边，而不是漂在组顶部。
- 少用的项放进 “Advanced” 折叠区（`SettingsGroupDisclosure`）。
- Agents 页：检测到的 CLI 列成清单，每行一个启用开关；% used / % remaining、Compact / Detailed 归在外观设置里。
- 状态栏只放数字，细节和 plan 放到 popover。

### 目标信息架构（540 宽弹窗）

1. 头部：标题 + 关闭按钮；tab 改成分段控件（Usage / Settings / History）；Setup 改成头部的一个小链接按钮（`?`）。去掉单独的 Machine 行。
2. **采集**：主开关行（“查询所选服务”，说明当前机器）；机器（当前空间 / 本机，分段）；刷新间隔（5 档，用下拉或分段）。
3. **服务**：工具行（检测已安装 · 选中检测结果 · 取消全部，用幽灵按钮）+ 检测说明；表头只写一次 `查询  显示`；每行 = 图标 + 名称 + 检测徽标 + 两个开关；↑↓ 只在 `sort === "custom"` 且该行被选中或悬停时出现。
4. **显示**：百分比（剩余 / 已用）、顺序（自定义 / 剩余最少优先）、语言（English / 中文），都用分段；额度周期用多选 chip；“显示不可用服务”用开关。
5. **提醒与历史**：低额度提醒（关 / 5 / 10 / 20%，分段）；保留本地快照（开关 + 说明）。
6. 页脚：隐私说明（`privacy`），一行 muted 文字。

交互：没有动效（低频工具面板，保持安静）。每次点击的反馈靠开关滑块位置和分段选中态直接体现。键盘：↑↓ 选行，Space 切 Query，Shift+Space 切 Show，Ctrl+↑/↓ 排序，这些保持不变。
