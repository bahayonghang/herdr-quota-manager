# 额度条与设置界面体验优化（父任务）

## 来源需求（用户，2026-11-13）

1. 右下角额度条显示不统一：Codex 有 `prolite` 标签，别的没有。要么都显示，要么都去掉。
2. 打开的设置弹窗会盖住下面的状态栏，需要优化。
3. 设置界面难看，样式和排版需要分析后优化，并参考 Orca 的设置组织逻辑。

设计分析见 `research/design-analysis.md`。

## 任务拆分

| 子任务 | 交付 | 依赖 |
| --- | --- | --- |
| `11-13-strip-plan-label` | 状态栏 chip 去掉 plan 标签 | 无 |
| `11-13-popup-anchor` | 弹窗锚定在状态栏上方，不遮挡状态栏 | 在 strip-plan-label 之后（都改 `ui.js` 的条带部分） |
| `11-13-settings-redesign` | 设置页分组重排、控件统一 | 在 popup-anchor 之后（都改 `main.js` 和弹窗尺寸） |

三个子任务改的是同一批文件（`ui.js`、`main.js`、`i18n.js`、`tests/ui.test.mjs`），按上表顺序串行，不并行。

## 跨子任务验收

- `just ci` 通过，`npm run check:herdr` 通过（本机有 `herdr-app`）。
- `just install` 后在原生 Herdr 里验收：状态栏 chip 结构一致；从状态栏打开 Usage 和 Settings 时状态栏完整可见；设置页按新分组显示，中英文都没有截断或换行错位。
- 不改变的东西：consent / Query / Show 语义、配置键和 `normalizeConfig` 结构、缓存与历史 key、键盘快捷键、`stripFace` 颜色规则。
- `.trellis/spec/mod/ui.md` 和 `runtime-boundary.md` 中关于 chip 组成、`openOverlay` 参数、设置页内容的描述随实现同步更新。

## 不做

- 不加设置搜索、拖拽排序、账户登录或任何 Out of scope 列表里的功能。
- 不加自定义颜色或动效。
