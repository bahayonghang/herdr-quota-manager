# Herdr Quota Manager

面向 **Herdr 原生桌面应用**的额度管理 Mod。不是 Herdr TUI Plugin，也不是 React 页面或 Orca Fork。

[English](README.md) · [实现架构](docs/ARCHITECTURE.md) · [安全边界](SECURITY.md) · [验收说明](docs/VALIDATION.md)

## 已实现的功能

| 功能 | 说明 |
| --- | --- |
| 查询与显示独立 | 关闭 Query 真正停止该 Provider 的后续采集；关闭 Show 只隐藏状态栏和额度弹窗中的行。 |
| 原生状态栏 | 显示额度摘要，空间不足时提供 `+N` 入口；含刷新和设置按钮。 |
| 额度弹窗 | 紧凑 / 详细视图、剩余 / 已用百分比、重置倒计时、数据时间、登录失效和缓存过期提示。 |
| 自定义顺序 | ↑ / ↓ 按钮、Ctrl+↑ / Ctrl+↓，或按剩余额度排序。 |
| 周期筛选 | 短周期、每周、每月、模型专属、余额及其他窗口；不为无上限余额编造百分比。 |
| 多账户结果 | 保留采集器返回的独立账户行，以匿名化标签区分，不显示邮箱；不负责登录或切换账号。 |
| 调度 | 手动、1 / 2 / 5 / 10 分钟；并发限制、去重、错误退避、Retry-After 和手动刷新冷却。 |
| 多机器 | 跟随当前空间或只查本机；每个弹窗固定其打开时的机器，不会把远程失败替换成本机数据。 |
| 历史 / 通知 | 可选额度快照和 5 / 10 / 20% 低额度提醒，默认关闭。 |
| 平台与语言 | Windows / macOS / Linux 安装器，中英文界面，跟随 Herdr 主题。 |

Provider 白名单包含 Codex、Antigravity（`agy`）、Grok、Cursor、Claude、Copilot、Kimi、OpenCode Go、Z.AI、MiniMax、Alibaba、Command Code、MiMo、DeepSeek、OpenRouter、ElevenLabs、Devin、Muse 和 Higgsfield，共 19 项。实际是否能查询，取决于采集器支持、订阅、登录状态和系统；列入白名单不代表已用真实账号逐一验证。

## Windows 安装

需要 **Node.js 22.19+**、pnpm（用于构建阶段），以及已经安装的 Herdr 桌面应用。将 `herdr-app` 所在目录加入 PATH。采集实现参考并打包自仓库内的 quota-axi 0.1.69 源码快照，路径 `third_party/quota-axi`，提交 `5734c41eee52eb9a80ba67f47269ebc06c0c41fc`，版权 Copyright (c) 2026 Kun Chen，MIT；安装与构建脚本 `scripts/build-vendor.mjs` 会将其核心查询逻辑编译适配到 `mods/quota-manager/vendor/quota-axi/`，由 Mod 在进程内直接调用，本机不启动独立 CLI 或 Node 子进程。远程机器仍需要自己的 PATH 中的 quota-axi，以及当地的 Provider 登录。PowerShell 中运行：

```powershell
git clone https://github.com/bahayonghang/herdr-quota-manager.git
cd herdr-quota-manager
node scripts/install.mjs
```

`install.ps1` 只是上述 Node 安装器的薄封装，不修改 PowerShell 执行策略。macOS / Linux 使用同样的 Node 命令，或 `sh install.sh`。

安装目录优先使用环境变量 `HERDR_APP_HOME`，否则为用户目录下的 `.config/herdr-app`。自定义目录：

```powershell
node scripts/install.mjs --app-home "C:\Users\你的用户名\.config\herdr-app"
```

安装器先在暂存目录运行 `herdr-app check`，通过后才安装，并备份旧版本。找不到 Herdr 或原生检查失败时会退出，已有 Mod 不受影响。开发者可以显式传入 `--skip-native-check` 跳过，但这不等于安装已验证。

额度芯片画在现有状态栏里，紧挨命令快捷键的左边，不再单独占一行。点击设置标记，选择 Provider，再点击 **Start selected queries / 开始查询所选服务**。新安装预选 Codex、Antigravity、Grok、Cursor，但点击开始前不进行额度查询。更新安装会保留已有设置和授权状态。`mod.json` 的 `place` 是 `none`。在个人布局里把 28px 状态栏块的 `content.mod` 改成 `quota-manager`，并删掉旧的额度块。安装器不会改布局。

设置中的 Language 可切换到中文。原生界面尚需在你的实际 Herdr 版本中验收，具体检查项见 [VALIDATION.md](docs/VALIDATION.md)。

## 查询和显示到底有什么区别

`Query = ON, Show = OFF`：仍查询该服务，但不在状态栏和 Usage 弹窗显示。

`Query = OFF, Show = ON`：停止新的查询；存在旧缓存时保留并标注“已暂停”。

所有 Query 均关闭时，不会执行默认查询所有服务的裸 `quota-axi` 命令。每次采集都有明确 Provider，例如：

本机查询由 `command.js` 直接调用集成在 `mods/quota-manager/vendor/quota-axi/index.js` 中的 `queryLocalQuota`（`allowKeychainPrompt: false`、`refreshCredentials: false`），在进程内直接完成读取，不启动 `node` 或 `quota-axi` CLI。

远程机器仍执行带 `--json --provider <id> --no-credential-refresh` 的 `quota-axi` 程序。

手动刷新使用 `--max-age 0`，但依然遵守服务端 Retry-After 及本地五秒冷却。“仅手动”模式在启动、切换机器后也不自动查询；点击“开始”视为一次明确的手动查询。已经启动的外部进程无法通过当前 Herdr exec API 强制取消，但停用后的返回结果会丢弃。

“检测已安装”只查询 Herdr 的 CLI 检测结果，不证明已登录或拥有订阅。通过 OMP、Pi 等工具使用的底层 Provider 需要自行选择。“选中检测结果”会替换当前选择，且不会隐式启用 Muse。

## 额度含义

紧凑模式展示所选窗口中“剩余最少”的可计量额度，同时在弹窗或提示中标明对应窗口。不同服务的百分比不能换算成相同 token 数量，不做跨 Provider 求和。

某些模型字段只是父额度的已用份额，不是独立额度，因此始终显示为“已用份额”，不会错误计算 `100 - 已用份额`。未知值、来源不可信的窗口和已过重置时间的旧数据，不会显示成满额或 0%。余额没有分母时只显示真实余额。

历史是额度快照，不是账单；不同账户和窗口分别记录。每机器每服务最多 120 条，超过 30 天的数据在再次访问/轮询该机器时清理。关闭历史记录不删除旧数据；可在历史界面清除当前弹窗机器的历史。

## 远程机器与账号

本机查询直接在 Mod 进程内通过 `mods/quota-manager/vendor/quota-axi/index.js` 完成（通过 `home()` 读取凭据位置、通过 `appHome()/quota-manager-collector/` 写入缓存），不启动 `node` 也不查找全局 `quota-axi`。远程机器需要独立安装 Node、quota-axi，并在当地登录 Provider CLI。主查询与所有启动回退都携带同一 `{ on: machine }` 机器标识，绝不向远程传递本机路径，也绝不回退到本机凭据。

弹窗固定其打开时的机器；切换空间或机器偏好后，重新打开弹窗才会切换目标。采集环境来自 Herdr 在对应机器上的执行环境，不会读取终端文本去猜测某个会话的 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 或容器凭据。

多账户结果来自 quota-axi 自身发现的账户，不提供自行登录、切换账号或手动指定任意 profile 的界面。

## 安全边界

Mod 不执行登录、推理、浏览器 Cookie 导入、自动凭据刷新或采集器返回的修复命令，不在共享状态中保存令牌、原始错误输出或账户邮箱。但 quota-axi 必须读取有权限的认证来源并访问服务商接口，所以不是离线工具。

系统凭据库授权需要你在终端明确执行。Muse 有独立警告：其服务端额度接口可能创建 API Key，只有确认该副作用后才能启用。详细信息见 [SECURITY.md](SECURITY.md)。

## 更新、卸载和验证

```powershell
git pull --ff-only
node scripts/install.mjs

# 可逆卸载：移动到备份目录，保留偏好和历史
node scripts/install.mjs --uninstall

# 不需要 npm install，即可运行本项目的离线测试
npm run validate
npm run test:coverage

# 需要本机已安装 Herdr
npm run check:herdr
```

安装器不改写整个布局、快捷键或 `shared.json`。旧版本保留在 `<Herdr目录>/.quota-manager-backups/`。安装和卸载都会把带有本项目 `.quota-manager-collector.json` 标记的旧版 `collectors/` 目录移至备份目录；卸载会同时移走带有本项目标记的 Mod。个人布局中若还保留对应块，请手动移除。没有本项目标记的目录会原样保留。

键盘：聚焦 Mod 后，U / S / H / R 分别进入额度、设置、历史、刷新；Esc 关闭。设置中 ↑↓ 选服务，Space 切查询，Shift+Space 切显示，Ctrl+↑↓ 调整顺序。

当前没有实现拖拽排序、账单趋势图、账号登录/切换和 Agent 路由控制。已实现按钮/键盘排序、历史快照和多账户结果展示。CI 的界面测试采用严格 API 形状的模拟器，不代替 GPUI 原生渲染检查和真实账号验收。本仓库未声称已发布到 Gallery，也未附上伪造的原生运行截图。

MIT License。参考项目及授权说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
