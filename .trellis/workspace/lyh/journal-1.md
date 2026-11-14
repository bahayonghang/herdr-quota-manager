# Journal - lyh (Part 1)

> AI development session journal
> Started: 2026-11-12

---



## Session 1: 填写 Quota Manager 开发规范
<!-- trellis-session: v=2 fp=4f131215ad732fda -->

**Date**: 2026-11-12
**Task**: 填写 Quota Manager 开发规范
**Branch**: `main`

### Summary

用 mod 与 tooling 规范替换前端模板，补上 AGENTS.md 和 just ci/install/uninstall，并归档初始化任务。

### Main Changes

- 引入 Trellis 工作流脚手架
- 写入 mod 与 tooling 规范、AGENTS.md 和 justfile

### Git Commits

| Hash | Message |
|------|---------|
| `09c1c55a48cad19f6f95c3bf35298a0fb6a68fa6` | chore: 引入 Trellis 工作流脚手架 |
| `eb62c1a746cadc5f79784081ffd72e3ab149a074` | docs: 补齐 Quota Manager 开发规范 |

### Testing

- [OK] just ci：73 项测试通过，安装与卸载仅 dry-run

### Status

[OK] **Completed**


## Session 2: 状态栏额度芯片整合与内置 quota-axi 本机直调
<!-- trellis-session: v=2 fp=277b5aeadb8e072c -->

**Date**: 2026-11-13
**Task**: 状态栏额度芯片整合与内置 quota-axi 本机直调
**Branch**: `bottom-right-quota-strip`

### Summary

将额度芯片并入既有 28px 状态栏并复用 Herdr 图标；引入 quota-axi 0.1.69 源码快照与构建脚本，使本机查询在 Mod 进程内直接调用核心逻辑并归档旧 collector 目录。

### Main Changes

- 把额度条收进 28px 状态行右侧并优先复用 Herdr 品牌图标
- 引入 quota-axi 0.1.69 源码快照至 third_party/quota-axi 并通过 scripts/build-vendor.mjs 生成 Mod 内置模块
- 修改 command.js/store.js/main.js：本机直调 queryLocalQuota（零 exec），远程保持 exec quota-axi 隔离
- 更新 install.mjs 自动归档带标记的旧 collectors 目录并保留用户配置
- 同步更新 README、ARCHITECTURE、SECURITY、THIRD_PARTY_NOTICES 与 Trellis 规范

### Git Commits

| Hash | Message |
|------|---------|
| `28a24b85287506bd9dc61e864d6b764d508b2974` | feat: 把额度条收成窗口右下角的一行 |
| `2b77953b2c20b4953536a31b6ea8faf6031a6d38` | chore: 引入 quota-axi 0.1.69 源码快照与 Mod 内置构建脚本 |
| `ea055fc6bfe23245aaef0d7731e3ecac5f0adc4b` | feat: 合并状态栏额度芯片并改为 Mod 进程内直调 quota-axi |
| `0d93aaea275f8071cb347826ec0fec74d3d8c791` | docs: 更新内置采集架构、第三方署名与 Trellis 开发规范 |

### Testing

- [OK] just ci：96 个 JS 模块语法与禁用 API 检查通过，90 项单元测试全部通过，--dry-run 通过
- [OK] npm run check:herdr：原生渲染检查通过
- [OK] just install：已安装新 Mod 并归档旧 collectors/quota-manager，shared.json consent 保持 false

### Status

[OK] **Completed**


## Session 3: 修复本机额度查询并完成原生验收
<!-- trellis-session: v=2 fp=65033164acf0664f -->

**Date**: 2026-11-13
**Task**: 修复本机额度查询并完成原生验收
**Branch**: `bottom-right-quota-strip`

### Summary

修复原生 UTF-8 凭据与缓存读取、Antigravity daemon 和 Grok JSON billing 采集，纠正显式本机范围切换与被阻止刷新引导；已配置并安装，完成三个服务的本机真实额度验收，按用户要求提交和归档。

### Main Changes

- 保留原生 UTF-8 文本并使用标准 JWT 解码，修复 Node 模拟未覆盖的 Buffer 兼容问题
- 本机零子进程查询 Antigravity daemon 和 Grok JSON billing，增加截止时间、候选上限及迟到响应保护
- 修复弹窗显式范围切换和刷新引导，更新规范、文档和归档验收记录

### Git Commits

| Hash | Message |
|------|---------|
| `59cd333497b659985c51b7701c18b65ac7b9d7ed` | fix: 恢复本机额度采集并修正刷新与机器范围 |

### Testing

- [OK] just ci：114/114 通过；npm run check:herdr 与安装器原生检查通过
- [OK] 实际 Herdr 本机刷新显示 Codex 97%、Antigravity 69%、Grok 50%；84 文件安装一致性检查通过
- [OK] 归档后上下文清单校验与 8 个隔离刷新复现场景通过

### Status

[OK] **Completed**


## Session 4: 额度条统一、弹窗锚定与设置页重排
<!-- trellis-session: v=2 fp=19eecc637837049f -->

**Date**: 2026-11-13
**Task**: 额度条统一、弹窗锚定与设置页重排
**Branch**: `bottom-right-quota-strip`

### Summary

结合截图做了设计分析，参照 Herdr better-config 与 Orca 的设置分组，拆成 1 个父任务和 3 个子任务。改动：额度条 chip 去掉套餐标签（各服务上报不一致，改放到悬停提示里）；状态栏弹窗用 bounds 锚定在状态栏上方，并统一对齐额度条右边缘，键盘打开时改为居中对话框，根节点固定高度，避免宿主按内容收缩；设置页重排为采集、服务、显示、提醒与历史四组，使用胶囊开关和分段控件，选中行不再使用 selected 底色。教训：用 herdr-app do 打开的弹窗会抢键盘焦点，用户的按键切换了真实的 Query 设置，之后改为由用户提供原生截图。121 项测试通过，用户已在原生界面验收。

### Git Commits

| Hash | Message |
|------|---------|
| `3830daf` | feat: 统一额度条、弹窗锚定状态栏上方并重排设置页 |

### Status

[OK] **Completed**
