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
