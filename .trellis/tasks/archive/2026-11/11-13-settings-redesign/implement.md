# 执行计划：设置页

1. [x] `ui.js` 新增 `switchControl`、`segmented`、`settingRow`、`group`、`ghostButton`、`iconButton`，并更新 kind chip 的外观。先给结构写单测（id、role、选中态 token）。
2. [x] `i18n.js` 新增分组标题、主开关、列头等 key（中英文）。
3. [x] `main.js` 的 `render` 头部：tab 改成 `segmented`，关闭和帮助改成 `iconButton`，删掉 Machine 行和底部 Setup 条。`help` id 移到图标按钮上。
4. [x] `main.js` 的 `settingsView` 按设计重排为四组；服务行的选中态、指示条、列对齐、↑↓ 显示条件、点击选中。
5. [x] `tests/ui.test.mjs`：已有测试全部通过；补 PRD 验收中列出的新断言。
6. [x] 更新 `.trellis/spec/mod/ui.md`（Nodes、Screens、settings 内容、选中行 token）。
7. [ ] `npm run validate` → `just ci` → `npm run check:herdr` → `just install`；原生环境下中英文各截顶部和底部共 4 张图，对照 PRD R1–R8 检查，有问题就修。
8. [ ] trellis-check 复查后，再交给用户验收。

审查关口：第 4 步完成后先截一张原生图给用户看方向，确认后再做第 5–7 步的收尾。

## 进展（2026-11-13）

- 第 1–6 步完成。`just ci` 119/119，`npm run check:herdr` 通过，已 `just install`。
- 原生中文截图（设置页顶部）确认四组结构、分段控件、开关列对齐、选中行指示条都已生效。
- 截图暴露的问题：关闭状态的开关轨道用 `t.hover`，放在 `raised` 卡片上看不见，已改成 `background` 加 `border` 细线。
- 事故：用 `herdr-app do quota-manager.settings` 打开的弹窗会抢键盘焦点，在弹窗里 Space 会切换 Query。验收期间 Codex/Antigravity/Grok 的 Query 变成了关闭，用户需要在界面里重新打开。之后不再用命令打开会抢焦点的弹窗来截图。
- 待用户确认：设置页滚动到底部（显示、提醒与历史两组）和英文界面的截图。

## 收尾（2026-11-13）

- 用户原生验收中发现两个问题，均已修复：一是历史页内容少时弹窗被宿主按内容收缩，根节点改为固定使用 `props.height`；二是从不同 chip 打开时弹窗位置不同，改为统一对齐 `quota-strip` 的右边缘。
- 最终 `just ci` 121/121 通过，`npm run check:herdr` 通过。用户确认设置页、历史页和弹窗位置均符合预期。
- 提交：`3830daf`（三个子任务合并为一个提交，因为它们改的是同一批文件）。
