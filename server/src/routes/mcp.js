/**
 * Streamable HTTP MCP endpoint.
 *
 * 调用方需要同时携带 Vantage JWT 和 X-Org-ID。默认只提供读工具与待确认
 * 通知建议，不允许 MCP 客户端直接发送飞书消息。
 */

const express = require('express');
const { randomUUID } = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { createVantageMcpServer } = require('../mcp/server');
const logger = require('../utils/logger');

const router = express.Router();
const SESSION_TTL_MS = Math.max(60_000, Number(process.env.MCP_SESSION_TTL_MS || 30 * 60_000));
const sessions = new Map();

function rpcError(message, code = -32000) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requestIdentity(req) {
  return {
    userId: Number(req.user?.id || 0),
    orgId: Number(req.currentOrgId || 0)
  };
}

function sameIdentity(entry, identity) {
  return entry.userId === identity.userId && entry.orgId === identity.orgId;
}

async function closeSession(sessionId, entry) {
  if (!entry || entry.closed) return;
  entry.closed = true;
  sessions.delete(sessionId);
  try { await entry.transport.close(); } catch {}
  try { await entry.server.close(); } catch {}
}

// MCP sessions are intentionally in-memory, but must not live forever if a
// client disappears without sending DELETE.
const sessionReaper = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, entry] of sessions) {
    if (entry.lastUsedAt < cutoff) void closeSession(sessionId, entry);
  }
}, Math.min(SESSION_TTL_MS, 60_000));
sessionReaper.unref();

router.all('/', async (req, res) => {
  const identity = requestIdentity(req);
  if (!identity.orgId || !identity.userId) {
    return res.status(400).json({ error: 'organization context required (send X-Org-ID)' });
  }

  const sessionId = headerValue(req.headers['mcp-session-id']);
  let entry = sessionId ? sessions.get(sessionId) : null;

  if (sessionId && !entry) {
    return res.status(404).json(rpcError('MCP session not found'));
  }
  if (entry && !sameIdentity(entry, identity)) {
    return res.status(403).json(rpcError('MCP session identity mismatch'));
  }

  if (!entry) {
    const isInit = req.method === 'POST' && req.body && isInitializeRequest(req.body);
    if (!isInit) {
      return res.status(400).json(rpcError('MCP session is required; send an initialize request first'));
    }

    entry = {
      transport: null,
      server: null,
      userId: identity.userId,
      orgId: identity.orgId,
      lastUsedAt: Date.now(),
      closed: false
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, entry);
      }
    });
    const server = createVantageMcpServer({
      orgId: identity.orgId,
      userId: identity.userId,
      role: req.currentOrgRole || (req.user.is_system_admin ? 'owner' : null)
    });
    entry.transport = transport;
    entry.server = server;
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
      entry.closed = true;
      void server.close().catch(() => {});
    };

    try {
      await server.connect(transport);
    } catch (error) {
      logger.error('MCP HTTP session setup failed', { error: error.message });
      await closeSession(sessionId, entry);
      if (!res.headersSent) res.status(500).json(rpcError('MCP session setup failed', -32603));
      return;
    }
  }

  entry.lastUsedAt = Date.now();

  try {
    await entry.transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('MCP HTTP request failed', { error: error.message });
    if (!res.headersSent) {
      res.status(500).json(rpcError('MCP request failed', -32603));
    }
  }
});

async function closeMcpSessions() {
  const active = [...sessions.entries()];
  await Promise.all(active.map(([sessionId, entry]) => closeSession(sessionId, entry)));
}

module.exports = router;
module.exports.closeMcpSessions = closeMcpSessions;
