# 设置页分组重排与控件统一

父任务：`11-13-quota-ui-polish`。分析见 `../11-13-quota-ui-polish/research/design-analysis.md` 的“问题 3”。前置：`11-13-popup-anchor` 已完成。

## 问题（截图可见）

1. 所有控件都用同一个 `button()`，tab、主开关、开关、一次性动作、排序箭头分不出来。
2. 选中行底色和开关打开时的底色都是 `t.selected`，Codex 行的 Query/Show 开关看不见了。
3. `✓` 和 `○` 宽度不同，开关列左右抖动、对不齐。
4. 主开关 “Pause all queries” 和底部 “Setup / troubleshooting” 都是全宽 raised 条，看起来像输入框。
5. provider 列表和通用偏好挤在一条长滚动里，没有分组标题；`choice()` 把标签放在按钮组上方，和 provider 行的排列方式又不一样。
6. 每行常驻 ↑↓，“Machine: …” 一行与机器设置重复。

## 需求

- R1 控件词汇：开关、分段控件、行布局与 Herdr 自带 `better-config` 一致（尺寸和 token 见设计文档）。tab 用分段控件；一次性动作用无底色的幽灵按钮；只有关闭和帮助是图标按钮。
- R2 分组：设置页按 **采集 / 服务 / 显示 / 提醒与历史** 四组排列。组标题在组外，组内一行一个设置，行之间用 `t.border` 细线分隔。每行左边是标题加一行说明，右边是控件。
- R3 主开关：采集组第一行是“查询所选服务”开关，说明里写出当前机器（替代头部原来的 Machine 行）。开关打开时触发的强制刷新行为不变。
- R4 服务列表：表头只写一次“查询 / 显示”，两列开关固定宽度并右对齐。行内显示图标、名称，检测后显示“已检测到 / 未检测到”。键盘选中行用 `t.hover` 底色加 `t.accent` 左侧 2px 指示条，不再使用 `t.selected`，避免与开关底色混淆。↑↓ 只在 `sort === "custom"` 且该行被选中或悬停时出现。
- R5 选项控件：选项不超过 4 个时用分段控件（百分比、机器、顺序、语言、提醒阈值）；刷新间隔有 5 档，同样用分段控件，标签写短（`手动 / 1 / 2 / 5 / 10 分钟`）。额度周期是多选，保留 chip，但改成与分段一致的外观。
- R6 Muse 警告、检测失败提示原样保留，放在服务组内对应的位置。
- R7 帮助入口改成头部的 `?` 图标按钮；页脚只保留一行 muted 的隐私说明。
- R8 中英文都不能截断或孤字换行；540 宽和 popup-anchor 缩高后的最小高度下都要能用。

## 保持不变

- 所有配置语义（consent、Query/Show 独立、Muse 二次确认、选中检测结果不开 Muse、全部取消）。
- 测试依赖的 id：`consent`、`query-<id>`、`show-<id>`、`up-<id>`、`down-<id>`、`select-<id>`、`detect`、`select-detected`、`none`、`muse-confirm`、`muse-cancel`、`tab-usage` / `tab-settings` / `tab-history`、`interval-<n>`、`percentage-*`、`scope-*`、`sort-*`、`language-*`、`kind-*`、`unavailable`、`threshold-*`、`history-enabled`、`help`、`close`。
- 键盘：↑↓、Space、Shift+Space、Ctrl+↑/↓、U/S/H/R、Esc。

## 验收

- `tests/ui.test.mjs`：已有点击测试全部通过；新增断言包括：四个组 id（`group-collect`、`group-providers`、`group-display`、`group-alerts`）存在；`sort` 为 `remaining` 时不渲染 `up-*` / `down-*`；选中行不再使用 `t.selected`。
- `i18n.js` 新增的 key 同时有中英文。
- `.trellis/spec/mod/ui.md` 的 Screens 表和 Nodes 列表同步更新。
- 原生验收：中英文各截一张设置页（顶部和滚到底部各一张），与 `research/design-analysis.md` 的目标信息架构逐项对照。
