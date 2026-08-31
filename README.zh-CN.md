<div align="center">

# iCloud Hide My Email 多账户管理器

**本地优先的 macOS / Windows 桌面应用：集中管理 Apple ID、隐藏邮箱和验证码邮件。**

[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](#平台支持)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![CI](https://github.com/LYH105/iCloudEmail-Lite/actions/workflows/ci.yml/badge.svg)](https://github.com/LYH105/iCloudEmail-Lite/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/LYH105/iCloudEmail-Lite?label=下载&color=5b5bd6)](https://github.com/LYH105/iCloudEmail-Lite/releases/latest)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

中文 · [English](README.md)

</div>

应用只在本机运行，默认仅监听回环地址；数据库、浏览器配置和加密主密钥都留在当前设备。它把账户健康状态、隐藏邮箱、自动标记和跨别名收件整合到一个界面中。

> 本项目使用 Apple 私有 Web API，与 Apple 没有关联，也未获得 Apple 背书。截图全部来自 v0.3 生产构建和隔离的虚构演示数据。

![新版概览](docs/screenshot-overview.png)

<details>
<summary>更多真实界面截图</summary>

![账户管理](docs/screenshot-accounts.png)

![隐藏邮箱库](docs/screenshot-library.png)

![最近邮件](docs/screenshot-mail.png)

![移动端布局](docs/screenshot-mobile.png)

</details>

## 核心功能

- **概览与首次使用引导**：无需逐页检查，即可看到 Apple 账户、收件连接和隐藏邮箱是否就绪。
- **多 Apple ID 管理**：SRP-6a 直接登录，短信验证只会由用户显式登录触发；后台恢复绝不会自行发送短信。
- **隐藏邮箱全生命周期**：一次创建 1–25 个别名，自定义标签，同步、停用、恢复、删除和更新转发信息。
- **跨账户邮箱库**：按地址、账户、标签、备注和标记搜索；按账户或阶段筛选；记录“已用”；将当前结果安全导出为 CSV。
- **统一最近邮件**：集中查看发往所有别名的邮件，自动识别可能的验证码和登录链接，可选择仅在页面可见时自动刷新。
- **自动标记规则**：按发件人、主题或正文匹配；支持导入、导出、重命名和清理孤立标记。
- **本地安全**：敏感字段采用 AES-256-GCM 加密；浏览器模式使用分作用域 API Key；桌面模式使用每次启动独立会话；邮件 HTML 在沙箱中显示，远程图片默认禁用。
- **可恢复的本地镜像**：Apple 返回不完整列表时，别名可以暂时隐藏，但本地“已用”和标记不会被级联删除。

## 项目特点

- 桌面模式接近零配置：自动选择空闲本机端口、生成加密主密钥、启动服务并打开界面。
- 浏览器 API Key 失效后会自动返回连接页，不再陷入重复 401 的不可用状态。
- 邮件缓存按后端和 API Key 隔离，最多保留 7 天、8 个时间窗口；退出或鉴权失败时自动清理。
- Apple HTTP、Playwright 校验、IMAP 连接、单封邮件和一次拉取都有超时或内存上限。
- CI 在 macOS Apple Silicon、macOS Intel 和 Windows x64 上验证 Node.js 24；锁文件包含所有发布目标的原生依赖。

## 平台支持

| | macOS | Windows |
| --- | --- | --- |
| 支持目标 | macOS 11+，Apple Silicon / Intel | Windows 10 1809+，x64 |
| 源码启动器 | `启动iCloud邮箱.command` | `启动iCloud邮箱.bat` |
| 浏览器辅助 | Google Chrome | Microsoft Edge |
| 发布产物 | `.dmg`、`.zip` | NSIS `.exe` |

由于打包内含与平台相关的 Node 运行时和 SQLite 原生模块，安装包必须在目标操作系统上构建。

## 安装方式

### 下载正式版

普通用户建议直接从 [GitHub Releases](https://github.com/LYH105/iCloudEmail-Lite/releases/latest) 下载对应系统的安装包。发布流程覆盖 macOS Apple Silicon、macOS Intel 和 Windows x64。

### 从源码运行

需要：

- Node.js **24 或更高版本**
- npm 10 或更高版本
- macOS 安装 Google Chrome，Windows 使用 Microsoft Edge；仅用于会话辅助刷新和打开 Apple 页面

```bash
git clone https://github.com/LYH105/iCloudEmail-Lite.git
cd iCloudEmail-Lite
npm install
npm run doctor
npm run desktop
```

也可双击项目根目录的中文启动器。中国大陆下载 Electron 较慢时：

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
```

## 快速开始

1. 打开桌面应用，点击“添加账户”。
2. 填写 Apple ID、密码、地区，并选择是否允许将登录密码加密保存在本机。
3. 输入 Apple 发送的短信验证码。后台任务不会代替你发起短信验证。
4. 在账户编辑页填写 Apple **App 专用密码**，用于 IMAP 收件；它不是 Apple ID 登录密码。
5. 进入“隐藏邮箱”同步已有别名，或回到账户页按数量和标签批量创建。
6. 进入“最近邮件”，集中查找所有别名收到的邮件、验证码和登录链接。

App 专用密码可在 [account.apple.com](https://account.apple.com/) 的“登录与安全 → App 专用密码”中创建。

## 配置说明

桌面模式会自动提供安全默认值。浏览器/服务端开发时，将 [`.env.example`](.env.example) 复制为 `.env`。

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；免鉴权模式只允许回环地址。 |
| `PORT` | `8787` | 浏览器模式端口；桌面应用自动选择空闲端口。 |
| `SECRET_MASTER_KEY` | 开发回退值 | 生产环境必填，用于加密 SQLite 敏感字段。 |
| `DATABASE_PATH` | `./data/icloud-hme.sqlite` | SQLite 文件位置。 |
| `PROFILES_DIR` | `./data/profiles` | 各账户浏览器配置目录。 |
| `CORS_ORIGINS` | `http://localhost:5173` | 允许访问 API 的浏览器来源，逗号分隔。 |
| `DISABLE_AUTH` | `false` | 仅用于本机开发；Electron 还会校验每次启动独立的 HttpOnly 会话。 |
| `SESSION_REFRESH_MINUTES` | `180` | 会话刷新间隔；`0` 表示关闭。 |
| `MARK_SCAN_MINUTES` | `30` | 自动扫描标记间隔；`0` 表示关闭。 |
| `PLAYWRIGHT_CHANNEL` | 平台默认 | 可设为 `chrome`、`msedge` 或已安装的 `chromium`。 |
| `WEB_DIST` | 未设置 | 后端托管生产界面时的前端构建目录。 |

不要将免鉴权模式暴露到局域网或互联网。程序会拒绝 `DISABLE_AUTH=true` 与非回环 `HOST` 的组合。

## 使用示例

### 浏览器开发模式

```bash
npm run dev
```

打开 `http://localhost:5173`。首次访问会引导创建 API Key；明文只显示一次，请立即复制。

### 生产 Web 构建

```bash
npm run build
SECRET_MASTER_KEY="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")" \
WEB_DIST=../iCloudEmail-FrontEnd/dist NODE_ENV=production npm start
```

### 创建浏览器模式的第一个 API Key

```bash
curl -X POST http://127.0.0.1:8787/api/apikeys \
  -H 'Content-Type: application/json' \
  -d '{"name":"本机浏览器","scopes":["read","write"]}'
```

首次创建后，请在 API 请求中发送 `Authorization: Bearer <key>`。系统不允许撤销或删除最后一个仍有效的 write Key。

## 数据与备份

| 内容 | macOS | Windows |
| --- | --- | --- |
| 应用数据 | `~/Library/Application Support/@icloud-hme/desktop/` | `%APPDATA%\@icloud-hme\desktop\` |
| 数据库 | `…/data/icloud-hme.sqlite` | `…\data\icloud-hme.sqlite` |
| 浏览器配置 | `…/data/profiles/` | `…\data\profiles\` |
| 加密主密钥 | `…/master.key` | `…\master.key` |
| 后端日志 | `…/logs/` | `…\logs\` |

备份时必须复制整个应用数据目录，不能只复制 SQLite。如果已有数据库但 `master.key` 缺失或无效，桌面应用会拒绝启动，避免静默生成新密钥并造成混合密钥数据。

## 项目目录结构

```text
iCloudEmail-Lite/
├── iCloudEmail-Desktop/          Electron 生命周期、安全窗口、子服务和打包
├── iCloudEmail-BackEnd/
│   ├── src/api/                  Fastify 路由、鉴权、校验、统一错误响应
│   ├── src/services/             账户、别名、标记、IMAP、概览和调度逻辑
│   ├── src/icloud/               SRP、Apple 鉴权、HME、浏览器会话刷新
│   ├── src/imap/                 有界 IMAP 拉取、验证码和链接提取
│   ├── src/db/                   SQLite 结构与迁移
│   └── test/                     API、迁移、安全、同步和策略测试
├── iCloudEmail-FrontEnd/
│   ├── src/components/           通用图标与错误边界
│   ├── src/features/             账户、别名、邮件功能模块
│   ├── src/pages/                概览和页面入口
│   └── test/                     前端纯业务逻辑测试
├── scripts/                      开发编排、环境诊断、元数据检查
├── .github/workflows/            跨平台 CI 与标签发布
└── docs/                         当前生产构建的真实截图
```

## 开发与构建

```bash
npm run doctor              # 环境与原生模块诊断
npm run dev                 # 后端 + Vite 前端
npm run check               # 元数据、格式、lint、类型、测试、生产构建
npm run audit:dependencies  # 高危依赖审计
npm run package:mac         # macOS 免安装目录，仅在 macOS 执行
npm run package:win         # Windows 免安装目录，仅在 Windows 执行
npm run dist:mac            # macOS dmg/zip
npm run dist:win            # Windows NSIS 安装包
```

推送 `v*` 标签会触发发布工作流并上传带校验和的产物。公开发布建议配置对应平台的签名凭据。

## 常见问题与注意事项

**为什么登录需要短信验证码？**

Apple 不信任新的客户端时需要显式验证。会话保活和自动恢复不会自行发送短信。

**Apple ID 密码和 App 专用密码有什么区别？**

Apple ID 密码用于建立 HME Web 会话；App 专用密码用于 IMAP 收件，两者分开配置。

**为什么提示没有保存登录密码？**

你可能在登录时关闭了保存、稍后清除了密码，或恢复的数据中没有有效密文。请显式重新输入密码登录。

**为什么最近邮件为空？**

确认该账户已填写 App 专用密码，IMAP 用户名是实际接收转发邮件的 Apple ID，然后点击“刷新”。为保护内存，包含超大附件的邮件会被跳过。

**为什么同步后某个别名消失，稍后又出现？**

Apple 偶尔会返回不完整列表。程序只隐藏远端暂时缺失的别名，不删除其本地标记和“已用”状态；再次出现时会自动恢复。

**`better-sqlite3` 无法加载原生模块怎么办？**

使用 Node.js 24+，并在当前操作系统上重新执行 `npm install`。若仓库连同其他系统的 `node_modules` 一起复制，请先移除依赖目录再安装。

**macOS 拦截未签名的本地构建怎么办？**

右键应用选择“打开”，或使用自己的 Developer ID 证书构建。不要关闭整台系统的 Gatekeeper。

**可以部署到公网服务器吗？**

不建议。浏览器模式虽然支持分作用域 API Key，但 Apple 凭据、邮件和本地浏览器配置决定了本项目的安全模型是单用户、本机回环运行。

## 安全与隐私

- 敏感字段加密保存；API Key 只保存哈希，不保存明文。
- 邮件 HTML 在禁用脚本的沙箱中渲染；远程图片必须手动允许，且只接受 HTTPS。
- API/健康检查响应禁止缓存；生产界面带 CSP、Referrer、Permissions 和 MIME 嗅探防护。
- 每封邮件最多解析 2 MiB，每次拉取最多处理 24 MiB 原始邮件数据。
- 删除账户时只允许清理由配置的 profiles 根目录内的账户目录。

## 许可证与免责声明

[MIT](LICENSE)。Apple、iCloud、Hide My Email、macOS 等商标归 Apple Inc. 所有。私有 API 可能随时变化，请只管理你有权访问的账户与数据。
