const { queryOne } = require("./db.cjs");
const { current } = require("./context.cjs");
module.exports = async function archiveDownload(req, res) {
  const report = await queryOne(
    "SELECT id,org_id FROM reports WHERE id=? AND org_id=?",
    [req.params.id, req.currentOrgId || 0],
  );
  if (!report)
    return res
      .status(404)
      .json({ error: "report not found in current organization" });
  const object = await current().env.REPORTS.get(
    `org/${report.org_id}/reports/${report.id}.json`,
  );
  if (!object)
    return res
      .status(409)
      .json({
        error: "archive_pending",
        message: "报告归档处理中，请稍后重试",
      });
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="vantage-report-${report.id}.json"`,
  );
  return res.send(await object.text());
};
