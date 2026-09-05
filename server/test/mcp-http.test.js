const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const mcpRouter = require('../src/routes/mcp');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('MCP Streamable HTTP keeps a session across initialize and tools/list', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 7, is_system_admin: false };
    req.currentOrgId = 1;
    req.currentOrgRole = 'member';
    next();
  });
  app.use('/mcp', mcpRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}/mcp`;
  let sessionId;

  try {
    const initialize = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vantage-http-test', version: '1.0.0' }
        }
      })
    });
    assert.equal(initialize.status, 200);
    sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const initializePayload = await initialize.json();
    assert.equal(initializePayload.result.serverInfo.name, 'vantage-market-intelligence');

    const listed = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    });
    assert.equal(listed.status, 200);
    const listedPayload = await listed.json();
    assert.deepEqual(
      listedPayload.result.tools.map((tool) => tool.name),
      [
        'search_market',
        'extract_source',
        'get_report',
        'get_report_history',
        'compare_reports',
        'propose_notification',
        ...require('../src/agent/businessTools').BUSINESS_SPECS.map(s => s.name)
      ]
    );

    const closed = await fetch(baseUrl, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId }
    });
    assert.ok([200, 202].includes(closed.status));
  } finally {
    await mcpRouter.closeMcpSessions().catch(() => {});
    await close(server);
  }
});
