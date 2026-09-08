/**
 * Vantage Agent runner.
 *
 * 每一轮由模型选择下一步工具；工具执行、证据收集、状态更新和最终输出
 * 校验都由运行时负责。
 */

const { chatWithTools } = require('./llm');
const { createToolRegistry } = require('./toolRegistry');
const { buildInitialMessages, createWorkflowState, PHASES, phaseForTool } = require('./workflow');
const defaultStore = require('./store');

const DEFAULT_MAX_TOOL_CALLS_PER_STEP = 4;
const DEFAULT_TOOL_CONTEXT_MAX_CHARS = 20000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compactForModel(value, options = {}, depth = 0) {
  const maxDepth = options.maxDepth ?? 5;
  const maxArray = options.maxArray ?? 20;
  const maxKeys = options.maxKeys ?? 40;
  const maxString = options.maxString ?? 1600;
  if (typeof value === 'string') {
    return value.length > maxString
      ? `${value.substring(0, maxString)}… [truncated ${value.length - maxString} chars]`
      : value;
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth >= maxDepth) return '[nested value omitted]';
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map((item) => compactForModel(item, options, depth + 1));
    if (value.length > maxArray) items.push({ _omitted_items: value.length - maxArray });
    return items;
  }
  const entries = Object.entries(value);
  const compacted = Object.fromEntries(
    entries.slice(0, maxKeys).map(([key, item]) => [key, compactForModel(item, options, depth + 1)])
  );
  if (entries.length > maxKeys) compacted._omitted_fields = entries.length - maxKeys;
  return compacted;
}

function serializeToolResultForModel(result, maxChars = DEFAULT_TOOL_CONTEXT_MAX_CHARS) {
  const limit = boundedInteger(maxChars, DEFAULT_TOOL_CONTEXT_MAX_CHARS, 4000, 48000);
  const first = JSON.stringify(compactForModel(result));
  if (first.length <= limit) return first;
  const compact = JSON.stringify(compactForModel(result, {
    maxDepth: 4,
    maxArray: 10,
    maxKeys: 25,
    maxString: 500
  }));
  if (compact.length <= limit) return compact;
  return JSON.stringify({
    ok: result?.ok === true,
    truncated: true,
    message: '工具结果过大，模型仅收到压缩预览；完整结果已保存在执行轨迹中。',
    preview: compact.substring(0, Math.max(1000, limit - 300))
  });
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n');
  }
  return '';
}

function parseJsonObject(text) {
  const value = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(value.substring(start, end + 1)); } catch {}
  }
  return null;
}

function addUsage(total, usage = {}) {
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  total.prompt_tokens += prompt;
  total.completion_tokens += completion;
  total.total_tokens += Number(usage.total_tokens ?? (prompt + completion)) || 0;
}

function collectEvidence(result, evidenceMap, sourceTool = null) {
  const evidence = result?.data?.evidence;
  if (!Array.isArray(evidence)) return;
  for (const item of evidence) {
    if (!item?.evidence_id) continue;
    evidenceMap.set(item.evidence_id, {
      evidence_id: item.evidence_id,
      title: item.title || '',
      url: item.url || '',
      published_date: item.published_date || null,
      excerpt: String(item.excerpt || '').substring(0, 1200),
      untrusted_content: item.untrusted_content === true,
      source_tool: sourceTool || item.source_tool || null,
      evidence_level: sourceTool === 'extract_source' || String(item.evidence_id).startsWith('page_')
        ? 'fulltext'
        : 'snippet'
    });
  }
}

function sourceDomain(rawUrl) {
  try { return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function evaluateEvidenceQuality(evidenceIds, evidenceMap) {
  const selected = evidenceIds.map((id) => evidenceMap.get(id)).filter(Boolean);
  const domains = new Set(selected.map((item) => sourceDomain(item.url)).filter(Boolean));
  const fulltextCount = selected.filter((item) => (
    item.evidence_level === 'fulltext' ||
    item.source_tool === 'extract_source' ||
    String(item.evidence_id || '').startsWith('page_')
  )).length;
  return {
    cited_count: selected.length,
    fulltext_count: fulltextCount,
    snippet_count: Math.max(0, selected.length - fulltextCount),
    distinct_domains: domains.size,
    domains: Array.from(domains).slice(0, 10),
    high_confidence_eligible: selected.length >= 2 && fulltextCount >= 1 && domains.size >= 2
  };
}

function normalizeFinal(text, evidenceMap) {
  const parsed = parseJsonObject(text);
  const raw = parsed && typeof parsed === 'object' ? parsed : {};
  const knownIds = new Set(evidenceMap.keys());
  const requestedIds = Array.isArray(raw.evidence_ids)
    ? raw.evidence_ids.filter((id) => typeof id === 'string')
    : [];
  const evidenceIds = requestedIds.filter((id) => knownIds.has(id));
  const evidenceQuality = evaluateEvidenceQuality(evidenceIds, evidenceMap);
  const warnings = [];
  if (!parsed) warnings.push('model final response was not valid JSON');
  if (requestedIds.some((id) => !knownIds.has(id))) warnings.push('some evidence_ids were not returned by tools');
  if (evidenceIds.length === 0) warnings.push('final answer has no verified evidence reference');
  if (evidenceIds.length > 0 && evidenceQuality.fulltext_count === 0) {
    warnings.push('结论仅基于搜索摘要，尚未通过 extract_source 核验来源原文');
  }
  if (evidenceIds.length === 1) warnings.push('结论只引用了一个来源，缺少交叉验证');
  if (evidenceIds.length > 1 && evidenceQuality.distinct_domains < 2) {
    warnings.push('引用证据来自同一域名，缺少跨来源交叉验证');
  }

  const keyPoints = Array.isArray(raw.key_points)
    ? raw.key_points.filter((item) => typeof item === 'string').slice(0, 5)
    : [];
  const title = String(raw.title || '').trim().substring(0, 255);
  const signalType = ['opportunity', 'neutral', 'risk'].includes(raw.signal_type)
    ? raw.signal_type
    : 'neutral';
  const sentiment = ['positive', 'neutral', 'negative'].includes(raw.sentiment)
    ? raw.sentiment
    : 'neutral';
  const proposedActions = Array.isArray(raw.proposed_actions)
    ? raw.proposed_actions
      .filter((item) => item && typeof item === 'object' && item.type === 'send_feishu_notification')
      .slice(0, 1)
      .map((item) => ({
        type: item.type,
        report_id: Number.isInteger(item.report_id) ? item.report_id : null,
        level: ['info', 'warning', 'critical'].includes(item.level) ? item.level : 'info',
        reason: String(item.reason || '').substring(0, 500),
        requires_approval: true
      }))
    : [];
  let confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low';
  if (evidenceIds.length === 0) {
    confidence = 'low';
  } else if (confidence === 'high' && !evidenceQuality.high_confidence_eligible) {
    confidence = evidenceIds.length >= 2 ? 'medium' : 'low';
    warnings.push('运行时已下调置信度：高置信度至少需要两个独立域名，并核验一份来源原文');
  }

  return {
    title,
    summary: String(raw.summary || text || '未生成有效结论').substring(0, 1200),
    answer: String(raw.answer || raw.summary || text || '').substring(0, 2000),
    key_points: keyPoints,
    signal_type: signalType,
    sentiment,
    confidence,
    evidence_ids: evidenceIds,
    evidence_quality: evidenceQuality,
    proposed_actions: proposedActions,
    warnings
  };
}

function modelStepOutput(response) {
  const message = response?.message || {};
  return {
    provider: response?.provider || null,
    provider_key: response?.providerKey || null,
    model: response?.model || null,
    finish_reason: response?.finishReason || null,
    content: messageText(message.content).substring(0, 2000),
    tool_calls: Array.isArray(message.tool_calls)
      ? message.tool_calls.slice(0, 20).map((call) => ({
        id: call.id || null,
        name: call.function?.name || null,
        arguments: String(call.function?.arguments || '').substring(0, 2000)
      }))
      : [],
    usage: response?.usage || {}
  };
}

function modelStepError(error) {
  return {
    provider: error?.providerLabel || error?.provider || null,
    provider_key: error?.provider || null,
    model: error?.model || null,
    status: error?.status || null,
    code: error?.code || 'agent_model_failed',
    retryable: Boolean(error?.retryable),
    attempt: error?.attempt || null,
    max_attempts: error?.maxAttempts || null,
    error: String(error?.userMessage || error?.message || 'model request failed').substring(0, 1000)
  };
}

function agentErrorMessage(error) {
  return String(error?.userMessage || error?.message || error || 'agent run failed').substring(0, 1000);
}

function buildFinalRepairPrompt(evidenceMap) {
  const evidenceIds = Array.from(evidenceMap.keys()).slice(0, 20);
  return [
    '你上一个最终回答不是合法 JSON。请只修复格式，不增加新事实，也不要调用工具。',
    '只输出一个合法 JSON 对象，不要解释、不要 Markdown 代码围栏；字符串内部的引号必须正确转义。',
    `evidence_ids 只能从以下值中选择：${JSON.stringify(evidenceIds)}`,
    '必须保留字段：title、summary、answer、key_points、signal_type、sentiment、confidence、evidence_ids、proposed_actions。'
  ].join('\n');
}

async function runAgent({
  runId,
  goal,
  context = {},
  complete = chatWithTools,
  registry = createToolRegistry(),
  store = defaultStore,
  maxSteps = 12
}) {
  const workflow = createWorkflowState({
    runId,
    goal,
    orgId: context.orgId,
    userId: context.userId
  });
  const messages = buildInitialMessages(goal, context);
  const evidenceMap = new Map();
  const runStartedAt = Date.now();
  const operations = [];
  const notificationProposals = [];
  const successfulCalls = new Map();
  let mutationEpoch = 0;
  const maxToolCallsPerStep = boundedInteger(
    process.env.AGENT_MAX_TOOL_CALLS_PER_STEP,
    DEFAULT_MAX_TOOL_CALLS_PER_STEP,
    1,
    8
  );
  const toolContextMaxChars = boundedInteger(
    process.env.AGENT_TOOL_CONTEXT_MAX_CHARS,
    DEFAULT_TOOL_CONTEXT_MAX_CHARS,
    4000,
    48000
  );
  let formatRepairPending = false;
  let formatRepairAttempts = 0;

  if (typeof store.isCancelled === 'function' && await store.isCancelled(runId)) {
    const error = new Error('run cancelled by user');
    error.code = 'run_cancelled';
    throw error;
  }
  await store.updateRun(runId, { status: 'running', phase: PHASES.PLANNING, stepCount: 0, error: null });

  try {
    for (let stepNo = 1; stepNo <= maxSteps; stepNo += 1) {
      if (typeof store.isCancelled === 'function' && await store.isCancelled(runId)) {
        const error = new Error('run cancelled by user');
        error.code = 'run_cancelled';
        throw error;
      }
      const startedAt = Date.now();
      const availableToolDefinitions = formatRepairPending ? [] : registry.definitions();
      const availableToolNames = formatRepairPending ? [] : registry.list();
      let response;
      try {
        response = await complete({
          messages,
          tools: availableToolDefinitions,
          maxTokens: 1400,
          temperature: 0.2
        });
      } catch (error) {
        workflow.stepCount = stepNo;
        try {
          await store.appendStep({
            runId,
            stepNo,
            kind: 'model',
            name: 'chat_completion',
            input: { message_count: messages.length, available_tools: availableToolNames, format_repair: formatRepairPending },
            output: modelStepError(error),
            status: 'failed',
            latencyMs: Date.now() - startedAt
          });
        } catch {}
        throw error;
      }
      if (typeof store.isCancelled === 'function' && await store.isCancelled(runId)) {
        const error = new Error('run cancelled by user');
        error.code = 'run_cancelled';
        throw error;
      }
      addUsage(workflow.usage, response.usage);
      await store.appendStep({
        runId,
        stepNo,
        kind: 'model',
        name: 'chat_completion',
        input: { message_count: messages.length, available_tools: availableToolNames, format_repair: formatRepairPending },
        output: modelStepOutput(response),
        latencyMs: Date.now() - startedAt
      });

      const message = response.message || {};
      const requestedToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const toolCalls = requestedToolCalls.slice(0, maxToolCallsPerStep);
      if (!toolCalls.length) {
        const finalText = messageText(message.content);
        const parsedFinal = parseJsonObject(finalText);
        if (!parsedFinal && formatRepairAttempts < 1 && stepNo < maxSteps) {
          formatRepairAttempts += 1;
          formatRepairPending = true;
          workflow.phase = PHASES.REPORTING;
          workflow.stepCount = stepNo;
          messages.push({ role: 'assistant', content: finalText || 'invalid final response' });
          messages.push({ role: 'user', content: buildFinalRepairPrompt(evidenceMap) });
          await store.updateRun(runId, {
            phase: PHASES.REPORTING,
            stepCount: stepNo,
            metadata: {
              evidence_count: evidenceMap.size,
              usage: workflow.usage,
              format_repair_attempts: formatRepairAttempts
            }
          });
          continue;
        }
        formatRepairPending = false;
        const final = normalizeFinal(finalText, evidenceMap);
        const researchTools = new Set(['search_market', 'extract_source', 'compare_reports']);
        const isOperation = !operations.some(op => researchTools.has(op.tool));
        final.kind = isOperation ? 'operation' : 'research';
        final.operations = operations;
        final.proposed_actions = notificationProposals;
        if (isOperation) {
          final.warnings = final.warnings.filter(w => !/evidence|来源|证据/.test(w));
          final.confidence = null;
        }
        if (typeof store.isCancelled === 'function' && await store.isCancelled(runId)) {
          throw Object.assign(new Error('run cancelled by user'), { code: 'run_cancelled' });
        }
        workflow.phase = PHASES.REPORTING;
        const persisted = (!isOperation || notificationProposals.length > 0) && typeof store.saveAgentReport === 'function'
          ? await store.saveAgentReport({
            runId,
            orgId: context.orgId,
            userId: context.userId,
            goal,
            watchlistId: context.watchlistId || null,
            result: {
              ...final,
              evidence: Array.from(evidenceMap.values()).slice(0, 20)
            },
            durationMs: Date.now() - runStartedAt
          })
          : { reportId: null, actions: [] };
        const reportId = persisted?.reportId || operations.find(op => op.ok && op.tool === 'run_watchlist')?.data?.reportId || null;
        const savedActions = Array.isArray(persisted?.actions) ? persisted.actions : [];
        const proposedActions = final.proposed_actions.map((action, index) => ({
          ...action,
          report_id: action.report_id || reportId,
          action_id: savedActions[index]?.id || savedActions[0]?.id || null
        }));
        const result = {
          ...final,
          report_id: reportId,
          proposed_actions: proposedActions,
          actions: savedActions,
          evidence: Array.from(evidenceMap.values()).slice(0, 20),
          meta: {
            steps: stepNo,
            duration_ms: Date.now() - runStartedAt,
            provider: response.provider || null,
            model: response.model || null,
            format_repair_attempts: formatRepairAttempts,
            usage: workflow.usage
          }
        };
        await store.updateRun(runId, {
          status: 'completed',
          phase: PHASES.COMPLETED,
          stepCount: stepNo,
          reportId,
          result,
          metadata: {
            provider: response.provider || null,
            model: response.model || null,
            format_repair_attempts: formatRepairAttempts,
            usage: workflow.usage
          },
          completed: true
        });
        return result;
      }

      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls
      });

      for (let index = 0; index < toolCalls.length; index += 1) {
        if (typeof store.isCancelled === 'function' && await store.isCancelled(runId)) {
          throw Object.assign(new Error('run cancelled by user'), { code: 'run_cancelled' });
        }
        const call = toolCalls[index];
        const toolName = call.function?.name || '';
        const callId = call.id || `call_${stepNo}_${index}`;
        const toolStartedAt = Date.now();
        let args = {};
        let result;
        let replayed = false;
        try {
          args = JSON.parse(call.function?.arguments || '{}');
          const fingerprint = `${toolName}:${stableJson(args)}`;
          const cached = successfulCalls.get(fingerprint);
          const previous = toolName === 'propose_notification' || cached?.mutationEpoch !== mutationEpoch
            ? null
            : cached;
          if (previous) {
            replayed = true;
            result = {
              ...previous.result,
              meta: { ...(previous.result.meta || {}), replayed: true, original_step: previous.stepNo }
            };
          } else {
            result = toolName === 'propose_notification' && notificationProposals.length > 0
              ? { ok: false, error: { code: 'proposal_limit', message: '每轮任务最多一个通知建议；请在下一轮提出另一个建议' } }
              : await registry.execute(toolName, args, { ...context, runId, stepNo, goal });
            if (result.ok) {
              const toolSpec = typeof registry.spec === 'function' ? registry.spec(toolName) : null;
              const readOnly = toolSpec?.readOnly !== false;
              if (!readOnly) mutationEpoch += 1;
              successfulCalls.set(fingerprint, { result, readOnly, stepNo, mutationEpoch });
            }
          }
        } catch (error) {
          result = { ok: false, error: { code: 'invalid_tool_call', message: String(error.message || error).substring(0, 500) } };
        }
        if (result.ok && toolName === 'propose_notification') notificationProposals.push(result.data.action);
        operations.push({ tool: toolName, ok: result.ok, replayed, data: result.data || null, error: result.error || null });
        collectEvidence(result, evidenceMap, toolName);
        const nextPhase = phaseForTool(toolName);
        workflow.phase = nextPhase;
        workflow.stepCount = stepNo;
        workflow.evidenceIds = Array.from(evidenceMap.keys());
        await store.appendStep({
          runId,
          stepNo,
          kind: 'tool',
          name: toolName || 'unknown_tool',
          input: args,
          output: result,
          status: result.ok ? 'success' : 'failed',
          latencyMs: Date.now() - toolStartedAt
        });
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: serializeToolResultForModel(result, toolContextMaxChars)
        });
        await store.updateRun(runId, {
          phase: nextPhase,
          stepCount: stepNo,
          metadata: { evidence_count: evidenceMap.size, usage: workflow.usage }
        });
      }
      if (requestedToolCalls.length > toolCalls.length) {
        messages.push({
          role: 'user',
          content: `运行时为控制副作用与上下文大小，每轮最多执行 ${maxToolCallsPerStep} 个工具；其余 ${requestedToolCalls.length - toolCalls.length} 个未执行。请根据已返回结果决定下一步。`
        });
      }
    }

    const error = new Error(`agent step budget exceeded (${maxSteps})`);
    error.code = 'step_budget_exceeded';
    throw error;
  } catch (error) {
    try {
      await store.updateRun(runId, {
        status: error.code === 'run_cancelled' ? 'cancelled' : 'failed',
        phase: PHASES.FAILED,
        stepCount: workflow.stepCount,
        error: agentErrorMessage(error),
        metadata: {
          usage: workflow.usage,
          evidence_count: evidenceMap.size,
          ...(error.code === 'run_cancelled' ? {} : { failure: modelStepError(error) })
        },
        completed: true
      });
    } catch {}
    throw error;
  }
}

module.exports = {
  runAgent,
  parseJsonObject,
  normalizeFinal,
  evaluateEvidenceQuality,
  messageText,
  stableJson,
  serializeToolResultForModel
};
