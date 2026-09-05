const test = require('node:test');
const assert = require('node:assert/strict');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createVantageMcpServer } = require('../src/mcp/server');

test('MCP exposes the same read/proposal tools and executes through the registry', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createVantageMcpServer({
    orgId: 1,
    userId: 2,
    dependencies: {
      searchMarket: async () => [{
        title: 'MCP source',
        url: 'https://example.com/mcp',
        content: 'Untrusted public content'
      }]
    }
  });
  const client = new Client({ name: 'vantage-test-client', version: '1.0.0' }, { capabilities: {} });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'search_market',
      'extract_source',
      'get_report',
      'get_report_history',
      'compare_reports',
      'propose_notification',
        ...require('../src/agent/businessTools').BUSINESS_SPECS.map(s => s.name)
    ]);

    const templates = await client.listResourceTemplates();
    assert.equal(templates.resourceTemplates[0].uriTemplate, 'vantage://reports/{reportId}');

    const response = await client.callTool({
      name: 'search_market',
      arguments: { query: 'MCP' }
    });
    assert.equal(response.isError, false);
    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.evidence[0].untrusted_content, true);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
