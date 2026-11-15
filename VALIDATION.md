# 验证记录

## 1.0.4 鼠标滚轮

通过 xterm 自定义滚轮处理器将滚轮固定用于本地历史滚动，支持像素、行、页单位及触控板小幅累计。禁止备用屏幕中的方向键转换和远程鼠标报告。实际打包界面测试验证：200 行输出可被滚轮向上滚动；备用屏幕、鼠标报告模式下滚轮均不产生 SSH 输入；英文、中文及标签切换测试通过。类型检查通过。

滚轮只操作本地 xterm 缓冲，不能读取远程 GNU Screen 内部历史；备用屏幕没有本地历史时滚轮不执行操作。

安装包：`out/make/squirrel.windows/x64/Screen Harbor-1.0.4 Setup.exe`。

## 1.0.3 终端滚动条

终端视口增加独立的 14px 纵向滚动条样式，常显轨道，提高滑块对比度，提供悬停和拖动反馈。复用 xterm 原生滚动机制和已有 6000 行本地历史缓冲。类型检查及打包后的键盘、中文和多标签输入回归检查通过。

安装包：`out/make/squirrel.windows/x64/Screen Harbor-1.0.3 Setup.exe`。

## 1.0.2 终端输入修复

应用容器使用的 `.terminal` 类名与 xterm.js 内部类名冲突，导致输入框继承 `visibility:hidden`，无法获得焦点。已将应用容器类名改为 `.terminal-viewport`。

新增 `npm run test:terminal`：启动实际 app.asar 界面并连接隔离的本地 SSH 夹具，通过 Electron 键盘事件验证英文、回车、中文输入，以及双终端切换和输入隔离。旧版复现为 `visibility:hidden, focused:false`，修复后全链路通过。类型检查、12 项既有测试、归档启动与 DPAPI 检查均通过。该测试不连接用户服务器，仍不能替代真实 GNU Screen 验收。

新版安装包：`out/make/squirrel.windows/x64/Screen Harbor-1.0.2 Setup.exe`。

## 1.0.1 打包修复

修复 Forge Vite 默认忽略 node_modules 导致外置依赖 ssh2 未进入 app.asar 的问题。现显式包含运行依赖并由 Packager 清理开发依赖。冒烟测试改为加载实际 app.asar，并断言 ssh2 及其必需传递依赖均解析到归档内部，避免开发目录掩盖漏包。已通过归档启动、IPC、DPAPI 和打包 EXE 安装钩子正常退出测试。

新版安装包：`out/make/squirrel.windows/x64/Screen Harbor-1.0.1 Setup.exe`。以下 1.0.0 记录仅为历史结果，旧版安装包存在漏依赖问题，请使用 1.0.1。

2026-11-13 19:31（Asia/Shanghai）：已实际运行 1.0.1 安装包，退出码为 0。Squirrel 日志确认安装至 `app-1.0.1` 并正常完成，未再出现安装钩子超时。

日期：2026-11-13，Windows x64，Node.js 26.13.0。

- `npm run typecheck`：通过。
- `npm test`：12 项通过，包含 10 项核心单元测试与 2 项本地 SSH 协议测试。回环网络测试在沙箱外执行。
- 依赖升级后的 npm 安全审计：0 个已知漏洞。
- `npm run make`：通过，生成 Windows x64 Squirrel 安装包。
- `npm run smoke`：通过。验证编译后的 Electron 应用启动、React 界面、preload IPC、配置保存及删除、凭据返回值脱敏、Windows DPAPI 加解密与界面截图。
- 已人工检查 `out/smoke.png` 的添加服务器弹窗，未见遮挡或溢出。当前测试环境 GPU 截图失败，因此 smoke 脚本使用软件渲染；正式应用未强制关闭 GPU。

安装包：`out/make/squirrel.windows/x64/Screen Harbor-1.0.0 Setup.exe`。

本地网络无法稳定访问 Electron 的 GitHub 下载地址，构建时使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，运行时下载由 Electron 安装器使用 npm 包自带的 SHA256 清单校验。未将镜像设置写入全局配置或项目默认配置。

尚未验证：真实 Linux/GNU Screen 的新建、重命名、接管、结束及网络中断后恢复；真实私钥及加密私钥登录；远程多服务器端到端验收。当前 SSH 测试使用本地协议夹具，不是真实 GNU Screen 服务。安装包已生成但未在本机执行安装，也未配置发行代码签名。
