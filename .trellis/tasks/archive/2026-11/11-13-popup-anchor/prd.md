# 弹窗锚定在状态栏上方

父任务：`11-13-quota-ui-polish`。分析见 `../11-13-quota-ui-polish/research/design-analysis.md` 的“问题 2”。前置：`11-13-strip-plan-label` 已完成。

## 问题

从状态栏 chip、`+N`、设置齿轮或空态按钮打开的 popup 没有传 `at`，宿主以指针为锚点，再把弹窗推回窗口内，于是弹窗底边压在 28px 状态栏上，挡住了正在看的额度条。

## 需求

- R1：从状态栏点击打开的 Usage / Settings popup，底边在状态栏顶边之上（留 4–8px 间距），右边缘尽量对齐被点击的控件，并且不超出窗口左右边界。
- R2：窗口高度不够放 620px 时，弹窗高度缩到可用高度（状态栏顶边到窗口顶部减去边距），内容区滚动；不能因为缩高而挡住状态栏。
- R3：没有指针位置可用时（键盘 `s` / `h` / `u`、`nextCommand` 的 `menu` / `settings` / `history`，以及阻塞的手动刷新自动跳转设置），用居中的 `kind: "dialog"` 打开，不要落到指针默认位置。
- R4：`props: { view, on: this.host() }` 和机器固定（pin）语义不变。弹窗已经打开时切换 tab 仍然只改 `this.screen`。

## 验收

- `tests/ui.test.mjs`：点击 `chip-*` / `bar-settings` 并传入带 `position` 的模拟事件后，`host.state.overlays.at(-1)` 带 `at: { x, y }`，满足 `y + height <= 状态栏顶边 - 间距`；模拟一个矮窗口，`height` 被缩小；键盘打开时为 `kind: "dialog"` 且不带 `at`。
- `.trellis/spec/mod/runtime-boundary.md` 中 `openOverlay` 的调用形状同步更新。
- 原生验收（Windows，100% 和 150% 缩放各一次）：最大化窗口和较矮的窗口里，从 chip 和齿轮打开时状态栏完整可见，弹窗不越出窗口。
