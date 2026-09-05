/**
 * 飞书推送
 * - Webhook 方式
 * - 支持卡片 + 文本
 * - 仅返回结构化错误码，避免向前端透传第三方响应体或签名请求体
 */

const axios = require('axios');
const crypto = require('crypto');
const { getRuntimeValue } = require('../runtimeConfig');
const logger = require('../utils/logger');
const { assertFeishuWebhookUrl } = require('../security/outbound');

/**
 * 生成飞书 Webhook 签名
 * @param {string} secret - 签名密钥
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string} base64 编码的签名
 */
function genSign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}

/**
 * 发送文本消息
 */
async function sendText(text, options = {}) {
  return send({
    msg_type: 'text',
    content: { text }
  }, options);
}

/**
 * 发送卡片消息（推荐）
 */
async function sendCard(card, options = {}) {
  return send({
    msg_type: 'interactive',
    card
  }, options);
}

/**
 * 通用发送
 * 返回结构:
 *   { ok: true, latency, statusCode }
 *   { ok: false, error, reason, latency, statusCode, providerCode }
 */
async function send(payload, options = {}) {
  const url = options.webhook || getRuntimeValue('FEISHU_WEBHOOK_URL');
  if (!url) {
    logger.warn('feishu webhook not configured, skipping send');
    return { ok: false, reason: 'no_webhook', error: 'Webhook URL 未配置' };
  }
  try {
    assertFeishuWebhookUrl(url);
  } catch (error) {
    logger.warn('blocked unsafe feishu webhook', { error: error.message });
    return { ok: false, reason: 'invalid_webhook_url', error: error.message };
  }

  // 签名校验：如果提供了 secret，则添加 timestamp + sign
  const secret = options.secret || getRuntimeValue('FEISHU_SECRET');
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = genSign(secret, timestamp);
  }

  const start = Date.now();
  try {
    const resp = await axios.post(url, payload, {
      timeout: 8000,
      maxRedirects: 0,
      maxContentLength: 64 * 1024
    });
    const latency = Date.now() - start;
    const statusCode = resp.status;
    const data = resp.data;

    // 飞书 Webhook 成功响应格式:
    //   旧版: { StatusCode: 0, StatusMessage: "success" }
    //   新版: { code: 0, msg: "success", data: {} }
    const isSuccess =
      data?.StatusCode === 0 ||
      data?.code === 0 ||
      (typeof data?.code === 'string' && data.code === '0');

    if (isSuccess) {
      logger.debug('feishu sent', { msgType: payload.msg_type, latency });
      return { ok: true, latency, statusCode };
    }

    const errCode = data?.code ?? data?.StatusCode ?? 'unknown';

    logger.warn('feishu response error', { code: errCode });

    return {
      ok: false,
      error: `[${errCode}] 飞书 Webhook 返回失败`,
      reason: 'feishu_api_error',
      latency,
      statusCode,
      providerCode: errCode
    };
  } catch (err) {
    const latency = Date.now() - start;

    // 网络错误、超时、HTTP 状态码非 2xx
    let errMsg = err.message || 'Unknown error';
    let statusCode = 'N/A';
    let respData = null;

    if (err.response) {
      // HTTP 错误响应 (4xx, 5xx)
      statusCode = err.response.status;
      respData = err.response.data;

      errMsg = `[HTTP ${statusCode}] 飞书 Webhook 请求失败`;
    } else if (err.code === 'ECONNABORTED') {
      errMsg = '请求超时 (8s)，请检查网络或飞书服务是否可用';
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      errMsg = `网络连接失败: ${err.message}`;
    }

    logger.warn('feishu send failed', { error: errMsg, latency });

    return {
      ok: false,
      error: errMsg,
      reason: 'network_error',
      latency,
      statusCode,
      providerCode: typeof err.response?.data === 'object'
        ? (err.response.data?.code ?? err.response.data?.StatusCode ?? null)
        : null
    };
  }
}

/**
 * 构建报告卡片
 */
function buildReportCard(report) {
  const signalTemplate = {
    opportunity: 'green',
    neutral: 'blue',
    risk: 'red'
  }[report.signalType] || 'blue';

  const signalLabel = {
    opportunity: '[机会]',
    neutral: '[中性]',
    risk: '[风险]'
  }[report.signalType] || '[中性]';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: signalTemplate,
      title: {
        tag: 'plain_text',
        content: `${signalLabel} ${report.title || 'Vantage 报告'}`
      }
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: report.summary || ''
        }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**关键洞察**\n' + (report.keyPoints || []).map(p => `• ${p}`).join('\n')
        }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '**信息来源**\n' + (report.sources || []).slice(0, 5).map(s => `[${s.title || s.url}](${s.url})`).join('\n')
        }
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `Vantage · 跨境瞭望台 | ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
          }
        ]
      }
    ]
  };
}

/**
 * 构建告警卡片
 */
function buildAlertCard(alert) {
  const template = {
    info: 'blue',
    warning: 'orange',
    critical: 'red'
  }[alert.level] || 'blue';

  const label = {
    info: '[信息]',
    warning: '[警告]',
    critical: '[严重]'
  }[alert.level] || '[信息]';

  return {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: 'plain_text', content: `${label} ${alert.title}` }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: alert.message || '' } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: 'Vantage · 跨境瞭望台' }] }
    ]
  };
}

module.exports = {
  send,
  sendText,
  sendCard,
  buildReportCard,
  buildAlertCard
};
