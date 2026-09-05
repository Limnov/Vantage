/**
 * Local stdio MCP entrypoint.
 *
 * Example:
 *   MCP_ORG_ID=1 node src/mcp/stdio.js
 */

require('dotenv').config();

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createVantageMcpServer } = require('./server');

async function main() {
  const server = createVantageMcpServer({
    orgId: parseInt(process.env.MCP_ORG_ID || '0', 10) || 0,
    userId: parseInt(process.env.MCP_USER_ID || '0', 10) || 0,
    role: 'member',
    source: 'stdio'
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`Vantage MCP failed: ${error.message}`);
  process.exitCode = 1;
});
