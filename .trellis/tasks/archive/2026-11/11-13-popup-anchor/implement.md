# 执行计划：popup 锚点

1. [x] Spike（原生）：在本地临时分支里给 `bar-settings` 的点击加一次 `at: { x: e.position.x, y: e.position.y }` 并打日志，`just install` 后用 `herdr-app shot` 在 100% 和 150% 缩放下截图，确定三件事：`at` 是左上角还是锚点；坐标是否需要 `/ scale()`；宿主会不会夹紧越界。结论写进 `research/at-semantics.md`，然后丢弃 spike 代码。
2. [x] 按 spike 结论实现 `popupPlacement(e, size)` 纯函数及其单测（正常窗口、矮窗口、靠左边缘、没有 position）。
3. [x] `ui.js`：`stripChip` / `flatButton` 的回调改为传 `(e, cx)`；`quotaStrip` 和 `quotaBar` 的回调签名同步修改。
4. [x] `main.js`：`open(view, e)` 按设计选择 popup + at 或 dialog；键盘和 `nextCommand` 路径不传 `e`。
5. [x] `tests/mock-host.mjs` / `tests/ui.test.mjs`：`click()` 支持传入模拟事件；补 R1–R3 的断言；已有 overlay 断言（`overlays.at(-1)?.props.view`）保持通过。
6. [x] 更新 `.trellis/spec/mod/runtime-boundary.md`（openOverlay 形状）和 `ui.md`（入口回调）。
7. [x] `npm run validate` → `just ci` → `npm run check:herdr` → `just install`，按 PRD 做原生验收并截图。

回滚点：第 3 步之前改动都可以独立丢弃；第 4 步之后，回滚就是恢复 `open()` 原来的那一行调用。

## 结果

Spike 由 Herdr 类型声明和 `better-tabs` 的用法回答（见 `research/at-semantics.md`），没有写临时代码。`just ci` 117/117；命令打开的居中弹窗由 `herdr-app shot` 确认；从状态栏齿轮点击打开的锚定弹窗由用户在 2026-11-13 截图确认：弹窗底边在状态栏上方，右边缘对齐齿轮。
