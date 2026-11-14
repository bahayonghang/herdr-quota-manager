# 设计：popup 锚点

## 宿主契约（来自 Herdr 二进制里的 `OverlaySpec`）

```ts
kind?: "dialog" | "popup" | "window"; // dialog: centered, dims. popup: at `at` (default: the pointer)
width?: number; height?: number;      // px, or up to 1: a share of the window
at?: "pointer" | { x: number; y: number };
```

文档没有写清 `at` 对 popup 来说是左上角还是锚点，也没写坐标是逻辑像素还是物理像素。Herdr 自带 mod 里有 `e.position.x / scale()` 这样的写法，所以第一步先做 spike，把这两点测清楚。

## 数据流

1. `stripChip`、`flatButton`（overflow / bar-settings / open）的 `on_click` 把事件 `e` 传给回调：`open(e, cx)`。
2. `main.js` 新增纯函数 `popupPlacement(e, size)`，放在 `ui.js` 或新的 `placement.js`（不放进 `main.js`，方便单测）：
   - `top = e.position.y - (e.local_position?.y ?? 0)`，即被点控件的顶边；`barTop = top - BAR_INSET`，其中 `BAR_INSET = (28 - 控件高) / 2`。spike 时用实测值确认。
   - `height = Math.min(620, barTop - GAP - TOP_MARGIN)`，下限 240，低于下限时退回 dialog。
   - `x = clamp(e.position.x + 控件剩余宽度 - width, EDGE, ∞)`；右侧越界由宿主夹紧，spike 时确认。
   - `y = barTop - GAP - height`。
   - 如果 spike 发现需要除以 `scale()`，那么换算只在这一个函数里做。
3. `open(view, e)`：有 `e.position` 时用 `kind: "popup", at, width, height`；没有时用 `kind: "dialog", width: 540, height: 620`。
4. 弹窗内部用 `size_full()` 和滚动区域，所以高度缩小时只是滚动区变短。

## 取舍

- 不在 bar 根节点上捕获 mouse_down，因为 chip 自己会 `stop_propagation`。改成从被点元素的 `local_position` 反推，这样所有入口共用同一个函数。
- 不改成全局固定的 dialog：从额度条点开时，用户需要同时看到额度条和弹窗。
- 键盘路径用 dialog，保证有一个确定的位置。

## 兼容与回滚

- 只改 `ui.js` 的回调签名、`main.js` 的 `open()`、新增一个纯函数，以及测试和 spec。
- 回滚：去掉 `at` / `height` 计算，恢复原来的 `openOverlay` 调用。
