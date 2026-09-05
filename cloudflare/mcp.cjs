const express = require("../server/node_modules/express");
const {
  StreamableHTTPServerTransport,
} = require("../server/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js");
const { createVantageMcpServer } = require("../server/src/mcp/server");
const router = express.Router();
router.all("/", async (req, res) => {
  if (req.method !== "POST")
    return res
      .status(405)
      .json({ error: "Cloudflare MCP uses stateless POST requests" });
  const server = createVantageMcpServer({
    orgId: req.currentOrgId,
    userId: req.user.id,
    role: req.currentOrgRole,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close();
    await server.close();
  }
});
module.exports = router;
module.exports.closeMcpSessions = async () => {};
