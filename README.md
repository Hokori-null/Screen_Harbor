# Screen Harbor

## 自动构建与发布

推送 `v1.0.5` 或 `1.0.5` 格式的 tag 会触发 GitHub Actions，在 Windows x64 上执行类型检查、测试、打包及打包产物启动检查，然后上传安装器、nupkg 和 RELEASES 到同名 GitHub Release。版本号以 tag 为准，CI 同步修改 package.json 和锁文件，不回写源码分支。当前仅支持三段数字正式版本。

```powershell
git tag v1.0.5
git push origin v1.0.5
```

工作流使用仓库自带的 GITHUB_TOKEN，无需配置个人 token；需要仓库允许 Actions 和 contents:write 权限。安装包暂未配置代码签名。同一 tag 重跑会覆盖该 Release 的同名构建附件。不要移动已发布的 tag。

Windows 上的远程 GNU Screen 桌面管理工具。通过 SSH 连接 Linux 服务器，支持多服务器、多终端标签、密码 / 私钥认证、新建、重命名、接管及结束会话。

## 本地开发

需要 Node.js 22.13+（推荐 Node.js 24 或 26）和 npm。

```powershell
npm install
npm start
```

```powershell
npm run typecheck
npm test
npm run package
npm run smoke
npm run test:terminal
npm run make
```

`package` 生成 Windows 应用目录，`make` 生成 Squirrel 安装包，均位于 `out/`。发行签名证书未配置，发布前需按组织要求配置代码签名。依赖通过 package-lock.json 锁定。

若安装后提示 Electron 运行时缺失，可运行 `node node_modules/electron/install.js` 完成下载。最新验证结果见 [VALIDATION.md](VALIDATION.md)。

## 使用

1. 添加服务器，填写地址、端口、用户名和认证方式。私钥选择本地 OpenSSH/PEM 文件，不上传或复制到配置目录。
2. 点击连接，输入密码或私钥口令。首次连接必须核验 SHA256 主机指纹；指纹变化会再次阻止连接并要求显式核验更新。
3. 连接后读取 Screen 列表。远端需要已安装 GNU Screen，且登录用户有权限运行 `screen`；应用不会安装依赖或修改远端配置。
4. 新建会话会启动远程默认 shell 并打开终端。名称使用字母、数字、下划线和连字符。
5. 已接入会话需要确认接管，原客户端会被分离。关闭标签、断开 SSH 或退出应用均保留会话；结束会话会终止其中的程序，需单独确认。
6. 断线后历史输出保留。点击重新连接服务器，再点击重新接入打开新标签；不会自动重放命令。终端内执行 `exit` 可能结束远程 shell 和会话。

终端支持缩放同步、Unicode、滚动和 Ctrl+Shift+C / Ctrl+Shift+V。点击“最大化”可让终端铺满应用窗口，点击“还原”恢复布局，连接和历史输出保持不变。会话列表每页最多显示 3 个，超过后通过上一页、下一页切换。列表在连接、操作后和手动刷新时更新。

## 配置与安全边界

- 配置位于 Electron 的 `userData` 目录（Windows 通常为 `%APPDATA%/Screen Harbor` 或 `%APPDATA%/screen-harbor`）的 `servers.json`，带版本号并通过临时文件替换保存。损坏或未知版本不会自动覆盖。
- 默认不保存密码。勾选保存后，密码 / 私钥口令由 Electron safeStorage 使用 Windows DPAPI 加密；该机制不能抵御同一 Windows 用户下的恶意程序。无法安全加密时拒绝保存。
- 更换服务器身份或认证配置会清除旧凭据；取消保存会删除加密凭据。删除服务器不会删除按地址保存的主机指纹，避免重新添加时失去已有信任记录。
- 主进程持有 SSH 和文件权限；渲染进程仅有受验证的 IPC 接口，开启沙箱和上下文隔离。连接事件、输出和输入均按服务器 / 终端标识隔离。
- 不记录密码、口令或终端内容。私钥和临时登录凭据仅用于当前连接。
- 不支持跳板机、SSH config 导入、SSH agent、键盘交互式 MFA、文件传输或共享会话。

## 验证范围

单元测试覆盖 Screen 输出解析、shell 引用、输入校验、凭据保存规则、配置版本和主机指纹持久化。测试加密适配器仅验证存储逻辑，真实 DPAPI 需在 Electron 中验证。

真实服务器验收清单：密码 / 私钥 / 加密私钥登录；错误密码和网络超时；首次主机密钥确认与密钥变化；缺少 screen；新建后执行持续任务、关闭标签再接入；接管、重命名和结束；多服务器隔离；断网恢复与终端尺寸。没有可用 SSH 测试服务器时，不能把单元测试等同于这些集成验收。

参考：[ssh2](https://github.com/mscdex/ssh2)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[Electron Forge Vite](https://www.electronforge.io/config/plugins/vite)。
