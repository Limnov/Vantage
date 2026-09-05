/**
 * Vantage Agent tool registry
 *
 * Tool Calling 和 MCP 都从这里执行，保证权限、参数校验和审计边界一致。
 */

const crypto = require('crypto');
const { TOOL_SPECS, getToolSpec } = require('./toolSchemas');
const {
  assertSafeSourceUrl,
  resolveSafeSourceUrl
} = require('../security/outbound');

class ToolExecutionError extends Error {
  constructor(message, code = 'tool_failed') {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
  }
}

function shortText(value, maxChars = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().substring(0, maxChars);
}

function evidenceId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').substring(0, 16)}`;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeReport(row) {
  return {
    id: row.id,
    watchlist_id: row.watchlist_id,
    watchlist_name: row.watchlist_name || null,
    title: row.title || '',
    query: row.query || '',
    summary: shortText(row.summary, 1200),
    key_points: parseJson(row.key_points, []),
    signal_type: row.signal_type || 'neutral',
    sentiment: row.sentiment || 'neutral',
    sources: parseJson(row.sources, []),
    report_date: row.report_date || null,
    agent_run_id: row.agent_run_id || null,
    created_at: row.created_at || null
  };
}

function createDefaultDependencies() {
  return {
    async searchMarket(input) {
      const { collect } = require('../services');
      return collect({
        query: input.query,
        search_mode: input.search_mode
      }, {
        maxResults: input.max_results,
        days: input.days,
        region: input.region
      });
    },

    async extractSource(input) {
      const { extractPage } = require('../searnov/lib/extract');
      return extractPage(input.url, {
        usePlaywright: input.use_playwright,
        timeout: 12000,
        safeMode: true
      });
    },

    async getReport(reportId, context) {
      const { queryOne } = require('../db');
      if (!context.orgId) throw new ToolExecutionError('organization context is required', 'org_context_required');
      const row = await queryOne(
        `SELECT r.*, w.name AS watchlist_name
         FROM reports r
         LEFT JOIN watchlist w ON w.id = r.watchlist_id
         WHERE r.id = ? AND r.org_id = ?`,
        [reportId, context.orgId]
      );
      if (!row) throw new ToolExecutionError('report not found in current organization', 'not_found');
      return normalizeReport(row);
    },

    async getReportHistory(input, context) {
      const { query } = require('../db');
      if (!context.orgId) throw new ToolExecutionError('organization context is required', 'org_context_required');
      const rows = await query(
        `SELECT r.*, w.name AS watchlist_name
         FROM reports r
         JOIN watchlist w ON w.id = r.watchlist_id
         WHERE r.watchlist_id = ?
           AND w.org_id = ? AND r.org_id = w.org_id
           AND r.created_at >= datetime('now', '-' || ? || ' days')
         ORDER BY r.created_at DESC
         LIMIT ${input.limit}`,
        [input.watchlist_id, context.orgId, input.days]
      );
      return rows.map(normalizeReport);
    }
  };
}

function createToolRegistry(overrides = {}) {
  const dependencies = { ...createDefaultDependencies(), ...overrides };

  const handlers = {
    async search_market(input) {
      const raw = await dependencies.searchMarket(input);
      const items = Array.isArray(raw) ? raw : (Array.isArray(raw?.results) ? raw.results : []);
      const results = items.slice(0, input.max_results).map((item, index) => {
        const title = shortText(item.title, 300);
        const url = shortText(item.url, 2048);
        const excerpt = shortText(item.content || item.snippet, 1200);
        const id = evidenceId('search', `${url}|${title}|${index}`);
        return {
          evidence_id: id,
          rank: index + 1,
          title,
          url,
          published_date: item.publishedDate || item.published_date || null,
          excerpt,
          untrusted_content: true
        };
      });
      return {
        query: input.query,
        search_mode: input.search_mode,
        count: results.length,
        results,
        evidence: results.map(({ evidence_id, title, url, published_date, excerpt, untrusted_content }) => ({
          evidence_id, title, url, published_date, excerpt, untrusted_content
        }))
      };
    },

    async extract_source(input) {
      const url = await resolveSafeSourceUrl(input.url);
      const page = await dependencies.extractSource({ ...input, url: url.href });
      const content = shortText(page?.content, input.max_chars);
      const id = evidenceId('page', url.href);
      return {
        url: url.href,
        title: shortText(page?.title || page?.ogTitle, 300),
        published_date: page?.publishedDate || null,
        content_length: page?.contentLength || content.length,
        evidence: [{
          evidence_id: id,
          title: shortText(page?.title || page?.ogTitle, 300),
          url: url.href,
          excerpt: content,
          untrusted_content: true
        }],
        warnings: content
          ? []
          : [page?.error || 'source content is empty or could not be extracted']
      };
    },

    async get_report(input, context) {
      return dependencies.getReport(input.report_id, context);
    },

    async get_report_history(input, context) {
      return {
        watchlist_id: input.watchlist_id,
        days: input.days,
        reports: await dependencies.getReportHistory(input, context)
      };
    },

    async compare_reports(input, context) {
      const reports = await dependencies.getReportHistory(input, context);
      return {
        watchlist_id: input.watchlist_id,
        days: input.days,
        report_count: reports.length,
        latest: reports[0] || null,
        previous: reports[1] || null,
        history: reports.slice(0, input.limit)
      };
    },

    async propose_notification(input, context) {
      if (!input.report_id && !context.runId) throw new ToolExecutionError('MCP 通知建议需要明确的 report_id', 'invalid_arguments');
      const report = input.report_id ? await dependencies.getReport(input.report_id, context) : { id: null, title: '本次情报报告', summary: '完成分析后生成，批准前请阅读报告内容' };
      return {
        requires_approval: true,
        action: {
          type: 'send_feishu_notification',
          requires_approval: true,
          report_id: report.id,
          level: input.level,
          channel: input.channel,
          reason: input.reason
        },
        report: {
          id: report.id,
          title: report.title,
          summary: report.summary
        }
      };
    }
  };

  for (const spec of require('./businessTools').BUSINESS_SPECS) {
    handlers[spec.name] = (input, context) => require('./businessTools').executeBusiness(spec.name, input, context);
  }

  return {
    list() { return TOOL_SPECS.map((spec) => spec.name); },
    definitions() { return TOOL_SPECS.map((spec) => spec.openAI); },
    spec(name) { return getToolSpec(name); },

    async execute(name, rawInput, context = {}) {
      const spec = getToolSpec(name);
      if (!spec || !handlers[name]) {
        return { ok: false, error: { code: 'unknown_tool', message: `tool ${name} is not available` } };
      }

      const parsed = spec.schema.safeParse(rawInput || {});
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'invalid_arguments',
            message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
          }
        };
      }

      try {
        const data = await handlers[name](parsed.data, context);
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error.code || 'tool_failed',
            message: shortText(error.message || 'tool execution failed', 500)
          }
        };
      }
    }
  };
}

module.exports = {
  ToolExecutionError,
  createToolRegistry,
  assertSafeSourceUrl,
  resolveSafeSourceUrl,
  normalizeReport
};
