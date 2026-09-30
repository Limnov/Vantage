# 树莓派正式环境运行说明

当前 `vantage.limnov.com` 正式产品运行在树莓派。此文件只记录非秘密的部署边界和检查步骤；不要提交 `.runtime/service.env`、数据库、API Key 或会话数据。

| 部分 | 当前路径或入口 |
| --- | --- |
| 代码 | `/home/freak/Projects/Vantage` |
| 后端工作目录 | `/home/freak/Projects/Vantage/server` |
| systemd 服务 | `vantage-pi.service`，以 `freak` 用户运行，失败后 5 秒重启 |
| 私有运行数据 | `/home/freak/Projects/Vantage/.runtime/`，其中 `service.env` 指定数据库等配置 |
| SQLite | `/home/freak/Projects/Vantage/.runtime/vantage.sqlite` |
| 静态站点 | `/var/www/vantage`，由 Caddy 读取 |
| 公网入口 | `https://vantage.limnov.com/`、`/app`、`/demo`、`/evidence` |

一次发布先记录当前 Git SHA，并对 SQLite 做在线备份。SQLite 使用 WAL；备份时使用 `sqlite3 .backup`，不要直接复制单个 `.sqlite` 文件当成一致性备份。前端执行 `npm run build --prefix web` 和 `node scripts/prerender.mjs`，先上传带哈希的资源文件，再替换应用入口 `app.html` 与首页 `index.html`；后端只合入已测试的提交，不覆盖 `.runtime`。代码、数据库与静态资源是三种独立资产，切换版本时分别检查。

```bash
cd /home/freak/Projects/Vantage
git rev-parse --short HEAD
git status --short
backup_path="/home/freak/Projects/Vantage/.runtime/vantage-backup-$(date +%Y%m%d-%H%M%S).sqlite"
sqlite3 .runtime/vantage.sqlite ".backup '$backup_path'"

sudo systemctl restart vantage-pi.service
systemctl is-active vantage-pi.service
curl -fsS http://127.0.0.1:3004/health
curl -fsS https://vantage.limnov.com/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://vantage.limnov.com/app
```

备份文件含真实业务数据，需留在受限目录并按实际备份策略轮换，不要上传到公开仓库。发布后的检查还应包含：新浏览器登录、Agent 只读任务、报告保存与重开、组织隔离、失败时的可读提示。真实 Provider/Tavily 测试按预先指定的次数执行，离线 Golden Set 不能替代它。

出现故障时先看 `systemctl status vantage-pi.service`、`journalctl -u vantage-pi.service --since '30 minutes ago'` 和公网健康检查。保留出错版本的日志与数据库备份；回退代码或静态资源时使用已记录的上一版提交和构建产物，不清理 `.runtime`。需要回退数据库时先停服务并单独评估新版本以来的真实写入，避免覆盖用户数据。
