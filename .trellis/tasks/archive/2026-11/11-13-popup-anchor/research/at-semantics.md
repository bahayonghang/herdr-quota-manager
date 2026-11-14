# `openOverlay` `at` 语义（spike 结论）

日期：2026-11-13。证据来源：Herdr 0.9.4 预览版二进制中的 `herdr` 和 `gpui-kit` 类型声明，以及随 Herdr 一起发布的 `mods/better-tabs/views/arrangement.js` 与 `tab-bar.js`。

## 结论

1. **`at` 是弹窗的左上角**，使用窗口坐标。`better-tabs` 打开它的 “More actions” 菜单时传的是 `at: { x: bounds.x + bounds.width - menuWidth, y: bounds.y + bounds.height + 6 }`，也就是让菜单右边缘对齐按钮、顶边落在按钮下方 6px。
2. **单位是 GPUI 逻辑像素，与 `event.bounds` / `event.position` 一致。** 类型注释写明 `position is window-relative`；`better-tabs` 直接把 `bounds` 传给 `at`，没有做任何换算。`win98` 里的 `scale()` 是它自己的 2x 皮肤开关（读取 `shared("win98.scale")`），不是 DPI 换算，所以不需要模仿。
3. **`on_click` 拿不到坐标。** `ClickEvent` 只有 `click_count` 和 `modifiers`（键盘激活也算一次 click）。坐标只能从 `on_mouse_down`（`MouseButtonEvent`）或 `on_mouse_move`（`MouseMoveEvent`）拿到，两者都带 `position`、`local_position` 和 `bounds`。元素还没绘制时，`bounds` 可能为空。
4. **父节点收不到子节点的 mouse_down。** chip 和平面按钮在 mouse_down 里会 `stop_propagation`，所以状态栏根节点拿不到这次按下。改用根节点的 `on_mouse_move` 记录状态栏的 `bounds`（指针移到状态栏上时就会触发），再在每个可点击元素的 `on_mouse_down` 里记录它自己的 `bounds`。

## 对设计的修正

- 不用 `e.position - e.local_position` 反推位置，直接读 `bounds`。
- 状态栏顶边优先取根节点 `on_mouse_move` 记录的 `bounds.y`；没有记录时，用被点元素的 `bounds.y - (28 - bounds.height) / 2` 估算。
- 不需要做 DPI 换算。原生验收仍然在 100% 和 150% 缩放下各检查一次。
- 宿主会不会再夹紧越界位置不重要：我们自己把 x 限制在至少 8px，y 由高度上限保证不小于 8px。
