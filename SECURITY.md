# 安全策略

## 支持范围

安全修复以 `main` 分支的最新版本为准。部署方需要自行维护 HTTPS、反向代理、主机访问控制、SQLite 文件权限和外部供应商配额。

## 报告漏洞

请优先通过 GitHub 仓库的 **Security → Report a vulnerability** 私下提交报告；维护者应在公开仓库前启用 Private vulnerability reporting。如果入口尚未显示，请先通过仓库所有者的 GitHub 主页索取私密报告渠道。报告中请包含：

- 受影响的提交与文件；
- 可复现的最小步骤；
- 实际影响与所需前置条件；
- 已验证的修复建议（如有）。

请勿在公开 Issue 中提交有效凭据、个人数据或可直接利用的攻击细节。维护者会先确认收到，再根据影响范围安排复现、修复和披露。

## 部署基线

- 保持 `REGISTRATION_MODE=disabled`，除非已部署邀请、验证码和成本配额控制。
- 为 `JWT_SECRET` 与 `JWT_REFRESH_SECRET` 使用不同的强随机值。
- 只在明确的可信代理拓扑下设置 `TRUST_PROXY`；示例单层 Nginx 使用 `TRUST_PROXY=1`。
- 限制 `CORS_ORIGINS`、数据库与 `.env` 文件访问权限。
- 定期运行 `npm audit --omit=dev`，并在发布前扫描当前树和全部可达 Git 历史中的秘密。
- 泄露过的凭据必须轮换；从当前文件删除明文不能使历史提交中的值失效。
