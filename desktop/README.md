# Vantage 桌面端

Electron 桌面端承载现有正式工作台。账号、组织、Agent、搜索和监控都在既有 Vantage 服务端运行，桌面安装包不内置密钥、数据库或后台 Worker。使用时需要网络连接；网页版功能更新会直接出现在桌面端。

## 开发和构建

在仓库根目录执行：

```bash
npm run desktop:setup
npm run desktop:start
npm --prefix desktop test
npm run desktop:pack
npm run desktop:dist
```

macOS DMG 位于 `desktop/release/`。默认构建当前机器架构，未配置 Apple 签名证书时产物未签名、未公证。公开提供下载前，应配置 Apple Developer ID 签名和公证，并在实际目标系统上验证安装。

本机前端开发时可指定：

```bash
VANTAGE_DESKTOP_URL=http://127.0.0.1:5177/app npm run desktop:start
```

该地址仅在开发版生效，仅允许本机回环地址或正式域名。打包后的应用始终连接 `https://vantage.limnov.com/app`，不会接受运行时覆盖。

桌面端使用独立的 Electron 持久会话，首次使用需要重新登录。外部网页交给系统浏览器，网页无 Node.js 权限，不提供任何原生 IPC 接口。若服务暂时不可达，应用显示可重试的离线页；它不提供离线 Agent 功能。
