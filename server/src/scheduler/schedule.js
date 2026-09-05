const parser = require("cron-parser");
function sqliteDate(value) {
  if (!value) return null;
  const d = new Date(
    /[TZ+]/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
function isWatchlistDue(item, now = new Date()) {
  if (!item.enabled || !item.schedule) return false;
  try {
    // SQLite timestamps are UTC; cron expressions follow the server's timezone.
    const last =
      sqliteDate(item.last_run_at) || sqliteDate(item.created_at) || now;
    const next = parser
      .parseExpression(item.schedule, { currentDate: last })
      .next()
      .toDate();
    return next <= now;
  } catch {
    return false;
  }
}
module.exports = { isWatchlistDue };
