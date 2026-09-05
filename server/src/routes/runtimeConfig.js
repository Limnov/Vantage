/**
 * WebUI 可编辑的本地运行时配置
 * - GET  /api/runtime-config
 * - PUT  /api/runtime-config { values: { ENV_KEY: value } }
 *
 * 仅允许 runtimeConfig.js 中的白名单，不写入 SQLite，返回值中的敏感字段始终脱敏。
 */

const express = require('express');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const {
  getRuntimeConfigSnapshot,
  updateRuntimeConfig
} = require('../runtimeConfig');

const router = express.Router();

router.get('/', requireAuth, requireSystemAdmin, (req, res) => {
  res.json(getRuntimeConfigSnapshot());
});

router.put('/', requireAuth, requireSystemAdmin, (req, res) => {
  try {
    const snapshot = updateRuntimeConfig(req.body?.values);
    res.json({
      success: true,
      message: '本地运行时配置已保存，并已热重载',
      ...snapshot
    });
  } catch (error) {
    if (error.code === 'UNSUPPORTED_CONFIG_KEYS') {
      return res.status(400).json({ error: 'unsupported_config_keys', keys: error.keys });
    }
    res.status(400).json({ error: error.message || 'Failed to save runtime config' });
  }
});

module.exports = router;
