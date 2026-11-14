# 额度条移除套餐标签

父任务：`11-13-quota-ui-polish`。分析见 `../11-13-quota-ui-polish/research/design-analysis.md` 的“问题 1”。

## 决策

选“都去掉”。plan 由各 provider 自己上报（`model.js:69` 的 `safeText(p.plan)`），Grok 不报，Antigravity 不一定报，所以“都显示”无法保证。Orca 的状态栏同样不放 plan，plan 只出现在 Usage popover 里。

## 需求

- `stripChip` 不再渲染 plan 胶囊。chip 结构固定为：14px 图标、名称、百分比，加上可选的倒计时。
- chip 的 tooltip 在有 plan 时带上 plan，例如 `Codex · prolite: Weekly 97% Remaining`。
- `stripBudget` 删掉 plan 那一档，`fitStrip` 的降级顺序变为：先去倒计时，再收起整个 chip（`+N`）。名称始终显示（沿用现有约定）。
- Usage 卡片（`providerCard`）里的 plan 显示不变。

## 验收

- `tests/ui.test.mjs`：一个 lane 带 `plan: "prolite"`，渲染出的 chip 子树里没有 plan 文本节点，tooltip / `accessibility_label` 里有。
- 已有的 `fitStrip` 宽度测试（例如宽度 220 时仍显示 `overflow`）更新后通过。
- `.trellis/spec/mod/ui.md` 中“an optional plan”“drops the countdown, then the plan”这两处描述同步改掉。
- 原生验收：Codex、Antigravity、Grok 三个 chip 结构一致。

## 执行

改动小，只需要这份 PRD。改 `mods/quota-manager/ui.js`（`stripChip`、`stripBudget`、`fitStrip`）、`tests/ui.test.mjs`、`.trellis/spec/mod/ui.md`。验证：`npm run validate`，然后 `just ci`。
