/**
 * Vantage MCP adapter.
 *
 * MCP 只负责对外暴露同一套领域工具；实际执行仍然经过 Agent tool
 * registry，避免 MCP 和内部 Agent 各自维护一套权限逻辑。
 */

const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { TOOL_SPECS } = require('../agent/toolSchemas');
const { createToolRegistry } = require('../agent/toolRegistry');

function variableValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function createVantageMcpServer(context = {}) {
  const registry = createToolRegistry(context.dependencies || {});
  const server = new McpServer({
    name: 'vantage-market-intelligence',
    version: '0.1.0'
  });

  for (const spec of TOOL_SPECS) {
    server.registerTool(spec.name, {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema.shape,
      annotations: {
        readOnlyHint: spec.readOnly,
        destructiveHint: spec.name.startsWith('delete_'),
        idempotentHint: spec.readOnly,
        openWorldHint: spec.name === 'search_market' || spec.name === 'extract_source'
      }
    }, async (args) => {
      const result = await registry.execute(spec.name, args, { ...context, source: 'mcp' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.ok === false
      };
    });
  }

  server.registerResource(
    'report',
    new ResourceTemplate('vantage://reports/{reportId}', { list: undefined }),
    {
      title: 'Vantage 情报报告',
      description: '读取当前组织内的一份完整情报报告。',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const reportId = Number(variableValue(variables.reportId));
      const result = await registry.execute('get_report', { report_id: reportId }, { ...context, source: 'mcp-resource' });
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );

  return server;
}

module.exports = { createVantageMcpServer };
