const { current } = require("./context.cjs");
const normalize = (sql) =>
  String(sql)
    .replace(/\bNOW\(\)/gi, "datetime('now')")
    .replace(/\bCURDATE\(\)/gi, "date('now')")
    .replace(/\bTRUE\b/gi, "1")
    .replace(/\bFALSE\b/gi, "0");
const params = (values) =>
  (Array.isArray(values) ? values : [values]).map((v) =>
    typeof v === "boolean"
      ? Number(v)
      : typeof v === "bigint"
        ? Number(v)
        : v === undefined
          ? null
          : v,
  );
const read = (sql) =>
  /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
const prepared = (sql, values = []) =>
  current()
    .env.DB.prepare(normalize(sql))
    .bind(...params(values));
async function reportId() {
  const result = await current()
    .env.DB.prepare(
      "UPDATE cloud_sequences SET value=value+1 WHERE name='reports' RETURNING value",
    )
    .first();
  if (!result) throw new Error("Report sequence missing; apply D1 migrations");
  return result.value;
}
function withReportId(sql) {
  return sql
    .replace(/(INSERT INTO reports\s*\()/i, "$1id, ")
    .replace(/VALUES\s*\(/i, "VALUES (?, ");
}
async function query(sql, values = []) {
  if (/^\s*INSERT INTO reports\s*\(/i.test(sql)) {
    values = [await reportId(), ...values];
    sql = withReportId(sql);
  }
  const result = await prepared(sql, values).all();
  return read(sql)
    ? result.results
    : {
        insertId: result.meta.last_row_id || 0,
        affectedRows: result.meta.changes || 0,
      };
}
async function queryOne(sql, values = []) {
  return (await query(sql, values))[0] || null;
}
// saveAgentReport is the only pool client. Stage its writes and commit atomically
// in D1.batch; reserve a monotonic report ID to reference it in the batch.
const pool = {
  async getConnection() {
    const writes = [];
    const stagedReports = new Map();
    let active = false;
    return {
      async beginTransaction() {
        if (active) throw new Error("transaction already started");
        active = true;
      },
      async execute(sql, values = []) {
        if (!active) throw new Error("transaction not started");
        if (
          /^\s*SELECT id FROM reports WHERE id = \? AND org_id = \?\s*$/i.test(
            sql,
          ) &&
          stagedReports.has(Number(values[0]))
        ) {
          const row = stagedReports.get(Number(values[0]));
          return [
            [row.org_id === Number(values[1]) ? { id: row.id } : null].filter(
              Boolean,
            ),
          ];
        }
        if (read(sql)) return [await query(sql, values)];
        let id = 0;
        if (/^\s*INSERT INTO reports\s*\(/i.test(sql)) {
          id = await reportId();
          sql = withReportId(sql);
          stagedReports.set(id, { id, org_id: Number(values[0]) });
          values = [id, ...values];
        }
        writes.push(prepared(sql, values));
        return [{ insertId: id, affectedRows: 1 }];
      },
      async commit() {
        if (writes.length) await current().env.DB.batch(writes);
        active = false;
        writes.length = 0;
      },
      async rollback() {
        active = false;
        writes.length = 0;
        stagedReports.clear();
      },
      release() {},
    };
  },
  async end() {},
};
module.exports = {
  query,
  queryOne,
  pool,
  testConnection: async () => Boolean(await queryOne("SELECT 1 AS ok")),
  closeAll: async () => {},
  databasePath: "Cloudflare D1",
};
