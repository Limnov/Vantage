import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, Typography, Space, Alert, Row, Col, Divider, Tag, Empty, Badge, Collapse, Spin, Select, InputNumber, Switch } from 'antd';
import {
  SaveOutlined, SettingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  BulbOutlined, ApiOutlined, BellOutlined, ThunderboltOutlined, DatabaseOutlined,
  SendOutlined, ReloadOutlined, ExperimentOutlined, CloudServerOutlined,
  GlobalOutlined, ClockCircleOutlined, CloudSyncOutlined, EditOutlined,
  LinkOutlined, SyncOutlined
} from '@ant-design/icons';
import { settingsApi, dashboardApi, aiApi, tavilyApi, runtimeConfigApi } from '../api';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';

const { Title, Text, Paragraph } = Typography;

interface Setting {
  key: string;
  value: any;
  description?: string;
}

const settingGroups: Record<string, { label: string; icon: any; keys: string[] }> = {
  ai_model: {
    label: 'AI 模型管理',
    icon: <ThunderboltOutlined />,
    keys: []
  },
  tavily: {
    label: 'Tavily 采集',
    icon: <GlobalOutlined />,
    keys: []
  },
  scheduler: {
    label: '调度配置',
    icon: <ClockCircleOutlined />,
    keys: []
  },
  feishu: {
    label: '飞书推送',
    icon: <BellOutlined />,
    keys: []
  },
  system: {
    label: '系统配置',
    icon: <ApiOutlined />,
    keys: ['rate_limit']
  }
};

const settingLabels: Record<string, { label: string; type: 'json' | 'string'; tip?: string }> = {
  feishu_webhook: { label: 'Webhook URL', type: 'string', tip: '群机器人 Webhook，用于推送消息' },
  feishu_default_chat: { label: '默认群 Chat ID', type: 'string' },
  rate_limit: { label: '限流配置', type: 'json' }
};

const configSourceMap: Record<string, { color: string; label: string }> = {
  webui: { color: 'default', label: '本地配置' },
  env: { color: 'default', label: '进程环境' },
  'local-env': { color: 'default', label: '本地配置' },
  none: { color: 'default', label: '未配置' }
};

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Setting[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  // AI config states
  const [aiData, setAiData] = useState<any>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [fetchingModels, setFetchingModels] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<Record<string, any[]>>({});
  const [selectedTestModel, setSelectedTestModel] = useState<Record<string, string>>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, any>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  // Tavily states
  const [tavilyConfig, setTavilyConfig] = useState<any>(null);
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [savingTavily, setSavingTavily] = useState(false);
  const [testingTavily, setTestingTavily] = useState(false);
  const [tavilyTestResult, setTavilyTestResult] = useState<any>(null);

  // Global Feishu fallback config (stored in local server/.env)
  const [feishuConfig, setFeishuConfig] = useState<any>(null);
  const [feishuWebhook, setFeishuWebhook] = useState('');
  const [feishuSecret, setFeishuSecret] = useState('');
  const [feishuDefaultChat, setFeishuDefaultChat] = useState('');
  const [savingFeishu, setSavingFeishu] = useState(false);

  // Scheduler states
  const [dedupHours, setDedupHours] = useState<number>(24);
  const [pushDaily, setPushDaily] = useState<boolean>(true);
  const [pushRealtimeAlert, setPushRealtimeAlert] = useState<boolean>(true);
  const [savingDedup, setSavingDedup] = useState(false);
  const [savingPush, setSavingPush] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await settingsApi.list();
      setItems(r.items);
      const initial: any = {};
      for (const it of r.items) {
        const meta = settingLabels[it.key];
        if (meta?.type === 'json') {
          initial[it.key] = JSON.stringify(it.value, null, 2);
        } else {
          initial[it.key] = it.value || '';
        }
      }
      form.setFieldsValue(initial);

      const h = await dashboardApi.health();
      setHealth(h);
    } finally {
      setLoading(false);
    }
  };

  const loadAiData = async () => {
    try {
      const r = await aiApi.getModels();
      setAiData(r);
      setAiDrafts(prev => {
        const next = { ...prev };
        for (const provider of r.providers || []) {
          next[provider.name] = {
            ...(prev[provider.name] || {}),
            name: prev[provider.name]?.name || (provider.name === 'custom' ? provider.providerName : undefined),
            baseUrl: provider.baseUrl || '',
            model: provider.model || '',
            timeout: provider.timeout || 60000,
            thinking: provider.thinking || 'disabled',
            models: { ...(provider.models || {}), ...(prev[provider.name]?.models || {}) }
          };
        }
        return next;
      });
    } catch (e: any) {
      setAiData({ error: e.response?.data?.error || e.message });
    }
  };

  const loadTavilyConfig = async () => {
    try {
      const r = await tavilyApi.getConfig();
      setTavilyConfig(r);
    } catch (e: any) {
      setTavilyConfig({ error: e.response?.data?.error || e.message });
    }
  };

  const loadFeishuConfig = async () => {
    try {
      const r = await runtimeConfigApi.get();
      const values = r.values || {};
      setFeishuConfig(r);
      setFeishuDefaultChat(values.FEISHU_DEFAULT_CHAT?.value || '');
    } catch (e: any) {
      setFeishuConfig({ error: e.response?.data?.error || e.message });
    }
  };

  const onFetchModels = async (provider: string) => {
    setFetchingModels(provider);
    try {
      const r = await aiApi.fetchModels(provider);
      if (r.status === 'ok') {
        setFetchedModels(prev => ({ ...prev, [provider]: r.models }));
        // Auto-select first model if none selected
        if (r.models.length > 0 && !selectedTestModel[provider]) {
          setSelectedTestModel(prev => ({ ...prev, [provider]: r.models[0].id }));
        }
        message.success(`${provider}: 获取到 ${r.total} 个模型 (${r.latency}ms)`);
      } else if (r.status === 'unconfigured') {
        message.warning(`${provider}: ${r.message}`);
      } else {
        message.error(`${provider}: ${r.error}`);
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setFetchingModels(null);
    }
  };

  const onTestProvider = async (provider: string) => {
    const model = selectedTestModel[provider];
    setTestingProvider(provider);
    try {
      const r = await aiApi.test(provider, model);
      setTestResults(prev => ({ ...prev, [provider]: r }));
      if (r.status === 'ok') {
        message.success(`${provider} 连接成功 (${r.latency}ms, 模型: ${r.model})`);
      } else if (r.status === 'unconfigured') {
        message.warning(`${provider}: ${r.message}`);
      } else {
        message.error(`${provider} 连接失败: ${r.error}`);
      }
    } catch (e: any) {
      setTestResults(prev => ({
        ...prev,
        [provider]: { provider, status: 'error', error: e.response?.data?.error || e.message }
      }));
      message.error(e.response?.data?.error || e.message);
    } finally {
      setTestingProvider(null);
    }
  };

  const onSaveTavily = async () => {
    if (!tavilyApiKey) {
      message.warning('请输入 API Key');
      return;
    }
    if (tavilyApiKey.includes('****')) {
      message.warning('请输入完整的 API Key，不能使用掩码值');
      return;
    }
    setSavingTavily(true);
    try {
      await tavilyApi.saveConfig(tavilyApiKey);
      message.success('Tavily API Key 已保存，下次采集将自动使用新配置');
      setTavilyApiKey('');
      await loadTavilyConfig();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSavingTavily(false);
    }
  };

  const onSaveProvider = async (provider: any) => {
    const draft = aiDrafts[provider.name] || {};
    if (draft.apiKey && String(draft.apiKey).includes('****')) {
      message.warning('请输入完整的 API Key，不能使用脱敏值');
      return;
    }
    if (draft.baseUrl && !/^https?:\/\//i.test(draft.baseUrl)) {
      message.warning('Base URL 需要以 http:// 或 https:// 开头');
      return;
    }

    setSavingProvider(provider.name);
    try {
      await aiApi.saveConfig(provider.name, {
        name: provider.name === 'custom' ? draft.name : undefined,
        apiKey: draft.apiKey || undefined,
        baseUrl: draft.baseUrl,
        model: draft.model,
        timeout: draft.timeout,
        thinking: provider.name === 'deepseek' ? draft.thinking : undefined,
        models: provider.name === 'bailian' ? draft.models : undefined
      });
      message.success(`${provider.label || provider.name} 配置已保存并热重载`);
      setAiDrafts(prev => ({ ...prev, [provider.name]: { ...prev[provider.name], apiKey: '' } }));
      setFetchedModels(prev => ({ ...prev, [provider.name]: [] }));
      setTestResults(prev => ({ ...prev, [provider.name]: undefined }));
      await loadAiData();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSavingProvider(null);
    }
  };

  const onSaveFeishu = async () => {
    if (feishuWebhook && feishuWebhook.includes('****')) {
      message.warning('请输入完整的 Webhook，不能使用脱敏值');
      return;
    }
    if (feishuWebhook && !/^https?:\/\//i.test(feishuWebhook)) {
      message.warning('Webhook URL 需要以 http:// 或 https:// 开头');
      return;
    }

    const values: Record<string, string> = { FEISHU_DEFAULT_CHAT: feishuDefaultChat };
    if (feishuWebhook) values.FEISHU_WEBHOOK_URL = feishuWebhook;
    if (feishuSecret) values.FEISHU_SECRET = feishuSecret;

    setSavingFeishu(true);
    try {
      await runtimeConfigApi.update(values);
      message.success('飞书全局配置已保存并热重载');
      setFeishuWebhook('');
      setFeishuSecret('');
      await loadFeishuConfig();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSavingFeishu(false);
    }
  };

  const onTestTavily = async () => {
    setTestingTavily(true);
    setTavilyTestResult(null);
    try {
      const r = await tavilyApi.test();
      setTavilyTestResult(r);
      if (r.status === 'ok') {
        message.success(`Tavily 连接成功 (${r.latency}ms)`);
      } else if (r.status === 'unconfigured') {
        message.warning(r.message);
      } else {
        message.error(`Tavily 连接失败: ${r.error}`);
      }
    } catch (e: any) {
      setTavilyTestResult({
        status: 'error',
        error: e.response?.data?.error || e.message
      });
      message.error(e.response?.data?.error || e.message);
    } finally {
      setTestingTavily(false);
    }
  };

  const onSaveDedup = async () => {
    setSavingDedup(true);
    try {
      await settingsApi.update('report_dedup_hours', { hours: dedupHours });
      message.success('报告去重时间已保存');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSavingDedup(false);
    }
  };

  const onSavePush = async () => {
    setSavingPush(true);
    try {
      await settingsApi.update('push_enabled', { daily: pushDaily, realtime_alert: pushRealtimeAlert });
      message.success('推送开关已保存');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setSavingPush(false);
    }
  };

  useEffect(() => {
    if (!user?.is_system_admin) return;
    load();
    loadAiData();
    loadTavilyConfig();
    loadFeishuConfig();
  }, [user?.is_system_admin]);

  // Sync scheduler state from loaded settings items
  useEffect(() => {
    const dedupItem = items.find(it => it.key === 'report_dedup_hours');
    if (dedupItem?.value) {
      const v = typeof dedupItem.value === 'string' ? (() => { try { return JSON.parse(dedupItem.value); } catch { return null; } })() : dedupItem.value;
      if (v && v.hours != null) setDedupHours(Number(v.hours));
    }
    const pushItem = items.find(it => it.key === 'push_enabled');
    if (pushItem?.value) {
      const v = typeof pushItem.value === 'string' ? (() => { try { return JSON.parse(pushItem.value); } catch { return null; } })() : pushItem.value;
      if (v) {
        if (v.daily != null) setPushDaily(v.daily !== false);
        if (v.realtime_alert != null) setPushRealtimeAlert(v.realtime_alert !== false);
      }
    }
  }, [items]);

  const onSave = async (key: string) => {
    const meta = settingLabels[key];
    if (!meta) return;
    const raw = form.getFieldValue(key);
    let value: any = raw;
    if (meta.type === 'json') {
      try { value = JSON.parse(raw); }
      catch { message.error(`${key} 不是合法 JSON`); return; }
    }
    try {
      await settingsApi.update(key, value);
      message.success(`已保存: ${key}`);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const itemsByKey: Record<string, Setting> = {};
  items.forEach(it => itemsByKey[it.key] = it);

  if (!user?.is_system_admin) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">
              <SettingOutlined />
              系统设置
            </h1>
            <div className="page-subtitle">主机级凭据、模型、采集与推送配置</div>
          </div>
        </div>
        <Alert
          type="warning"
          showIcon
          message="仅系统管理员可访问"
          description="这些配置由整个 Vantage 实例共享，可能包含 API Key、Provider 地址和全局推送凭据。组织管理员可在组织、成员、Bot 和告警路由页面管理本组织资源。"
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <SettingOutlined />
            系统设置
          </h1>
          <div className="page-subtitle">配置 AI 模型、采集、推送、系统行为</div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { load(); loadAiData(); loadTavilyConfig(); loadFeishuConfig(); }} loading={loading}>刷新状态</Button>
          <Button type="primary" icon={<ApiOutlined />} onClick={() => navigate('/bots')}>
            管理飞书 Bot
          </Button>
        </Space>
      </div>

      {health && (
        <Alert
          type={health.status === 'ok' ? 'success' : 'warning'}
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message={
            <Space wrap>
              <Text strong>系统健康：</Text>
              {Object.entries(health.checks || health).filter(([k]) => k !== 'status').map(([k, v]) => (
                <Tag key={k} bordered={false}>
                  <Space size={4}>
                    {v === 'ok' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    <span>{k}</span>
                  </Space>
                </Tag>
              ))}
            </Space>
          }
          action={
            <Button size="small" onClick={() => navigate('/about')}>详情</Button>
          }
        />
      )}

      <Form form={form} layout="vertical">
        {Object.entries(settingGroups).map(([groupKey, group]) => {
          if (feishuConfig?.editable === false && ['ai_model','tavily','feishu'].includes(groupKey)) {
            return <Card key={groupKey} title={group.label} style={{marginBottom: 24}}>
              <Alert type="info" showIcon message="由部署管理员管理" description="云端模型、搜索和全局通知凭据通过 Cloudflare Secrets 配置。组织 Bot 和告警规则仍可在产品内管理。" />
              {groupKey === 'ai_model' && <p style={{marginTop:16}}>当前模型服务：{aiData?.activeProviderLabel || aiData?.activeProvider || '未配置'}</p>}
              <a href="https://github.com/Limnov/Vantage/blob/cloudflare/docs/cloudflare-deployment.md" target="_blank" rel="noreferrer">查看云端配置说明 ↗</a>
            </Card>;
          }
          // AI model group: editable local runtime config
          if (groupKey === 'ai_model') {
            return (
              <div key={groupKey} className="settings-group">
                <div className="settings-group-title">
                  <Space>
                    {group.icon}
                    <span>{group.label}</span>
                  </Space>
                </div>
                <Card styles={{ body: { padding: 24 } }}>
                  {aiData === null ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin tip="加载 AI 模型配置中...">
                        <div style={{ minHeight: 60 }} />
                      </Spin>
                    </div>
                  ) : aiData?.error ? (
                    <Alert
                      type="error"
                      showIcon
                      message="加载失败"
                      description={aiData.error}
                      action={<Button size="small" onClick={loadAiData}>重试</Button>}
                    />
                  ) : !aiData ? (
                    <Empty description="暂无 AI 模型配置" />
                  ) : (
                    <>
                      {/* Active provider + fallback chain */}
                      <div style={{ marginBottom: 16 }}>
                        <Space wrap align="center">
                          <Tag icon={<CheckCircleOutlined />} style={{ fontSize: 13, padding: '2px 10px' }}>
                            当前激活：{aiData.activeProviderLabel || aiData.activeProvider || '无'}
                          </Tag>
                          <Divider type="vertical" />
                          <Text type="secondary">回退链：</Text>
                          {(aiData.fallbackChain || []).length > 0 ? (
                            (aiData.fallbackChain as string[]).map((p, i) => (
                              <Tag key={p} bordered={false}>
                                {i + 1}. {p}
                              </Tag>
                            ))
                          ) : (
                            <Text type="secondary">无</Text>
                          )}
                          <Divider type="vertical" />
                          <Text type="secondary">
                            已配置 {aiData.totalConfigured}/{aiData.totalProviders} 个 Provider
                          </Text>
                        </Space>
                      </div>

                      <Divider style={{ margin: '8px 0 16px' }} />

                      {/* Provider cards */}
                      {(aiData.providers || []).map((provider: any) => {
                        const result = testResults[provider.name];
                        const testing = testingProvider === provider.name;
                        const fetching = fetchingModels === provider.name;
                        const models = fetchedModels[provider.name] || [];
                        const srcInfo = configSourceMap[provider.configSource] || configSourceMap.none;

                        return (
                          <div
                            key={provider.name}
                            style={{
                              marginBottom: 16,
                              padding: 16,
                              border: '1px solid var(--ant-color-border)',
                              borderRadius: 8,
                              background: provider.configured ? 'transparent' : 'var(--ant-color-fill-tertiary)'
                            }}
                          >
                            {/* Header row */}
                            <Row align="middle" gutter={[12, 8]} style={{ marginBottom: 12 }}>
                              <Col flex="auto">
                                <Space wrap>
                                  <CloudServerOutlined style={{ color: 'var(--v-text-2)', fontSize: 18 }} />
                                  <Text strong style={{ fontSize: 15 }}>{provider.label || provider.name}</Text>
                                  {provider.priority > 0 && <Badge count={`P${provider.priority}`} style={{ backgroundColor: 'var(--v-text)' }} />}
                                  <Tag>
                                    {provider.configured ? '已配置' : '未配置'}
                                  </Tag>
                                  <Tag color={srcInfo.color} icon={<EditOutlined />}>
                                    来源: {srcInfo.label}
                                  </Tag>
                                  {provider.apiKeyMasked && (
                                    <Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                                      Key: {provider.apiKeyMasked}
                                    </Text>
                                  )}
                                </Space>
                              </Col>
                            </Row>

                            {/* Editable local runtime config */}
                            {(() => {
                              const draft = aiDrafts[provider.name] || {};
                              const updateDraft = (patch: any) => setAiDrafts(prev => ({
                                ...prev,
                                [provider.name]: { ...(prev[provider.name] || {}), ...patch }
                              }));
                              return (
                                <Row gutter={[12, 8]}>
                                  {provider.name === 'custom' && (
                                    <Col xs={24} md={12}>
                                      <Text type="secondary" style={{ fontSize: 12 }}>显示名称</Text>
                                      <Input
                                        value={draft.name || ''}
                                        onChange={e => updateDraft({ name: e.target.value })}
                                        placeholder="例如：本地 Ollama"
                                        style={{ marginTop: 4 }}
                                      />
                                    </Col>
                                  )}
                                  <Col xs={24} md={provider.name === 'custom' ? 12 : 24}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>API Key</Text>
                                    <Input.Password
                                      value={draft.apiKey || ''}
                                      onChange={e => updateDraft({ apiKey: e.target.value })}
                                      placeholder={provider.apiKeyMasked ? `已配置 ${provider.apiKeyMasked}，留空保持不变` : '请输入 API Key'}
                                      style={{ marginTop: 4 }}
                                    />
                                  </Col>
                                  <Col xs={24} md={16}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Base URL</Text>
                                    <Input
                                      value={draft.baseUrl || ''}
                                      onChange={e => updateDraft({ baseUrl: e.target.value })}
                                      placeholder={provider.baseUrl}
                                      style={{ marginTop: 4 }}
                                    />
                                  </Col>
                                  <Col xs={24} md={8}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>请求超时（毫秒）</Text>
                                    <InputNumber
                                      min={1000}
                                      max={300000}
                                      value={draft.timeout}
                                      onChange={value => updateDraft({ timeout: Number(value) || 60000 })}
                                      style={{ width: '100%', marginTop: 4 }}
                                    />
                                  </Col>
                                  <Col xs={24} md={16}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>主模型</Text>
                                    <Input
                                      value={draft.model || ''}
                                      onChange={e => updateDraft({ model: e.target.value })}
                                      placeholder={provider.model}
                                      style={{ marginTop: 4 }}
                                    />
                                  </Col>
                                  {provider.name === 'deepseek' && (
                                    <Col xs={24} md={8}>
                                      <Text type="secondary" style={{ fontSize: 12 }}>思考模式</Text>
                                      <Select
                                        value={draft.thinking || 'disabled'}
                                        onChange={value => updateDraft({ thinking: value })}
                                        options={[{ label: '关闭', value: 'disabled' }, { label: '开启', value: 'enabled' }]}
                                        style={{ width: '100%', marginTop: 4 }}
                                      />
                                    </Col>
                                  )}
                                  {provider.name === 'bailian' && (
                                    <Col span={24}>
                                      <Collapse
                                        ghost
                                        items={[{
                                          key: 'models',
                                          label: <Text type="secondary" style={{ fontSize: 12 }}>高级：百炼多模型用途配置</Text>,
                                          children: (
                                            <Row gutter={[12, 8]}>
                                              {[
                                                ['fast', '快速模型'], ['reason', '推理模型'], ['long', '长上下文模型'],
                                                ['vision', '视觉模型'], ['embed', '向量模型'], ['rerank', '重排模型'], ['tts', '语音模型']
                                              ].map(([key, label]) => (
                                                <Col xs={24} md={12} key={key}>
                                                  <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
                                                  <Input
                                                    value={draft.models?.[key] || ''}
                                                    onChange={e => updateDraft({ models: { ...(draft.models || {}), [key]: e.target.value } })}
                                                    style={{ marginTop: 2 }}
                                                  />
                                                </Col>
                                              ))}
                                            </Row>
                                          )
                                        }]}
                                      />
                                    </Col>
                                  )}
                                </Row>
                              );
                            })()}
                            {provider.envVars?.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>保存项：</Text>
                                <Text code>{provider.envVars.join(' / ')}</Text>
                              </div>
                            )}

                            {/* Action buttons */}
                            <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
                              <Col>
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<SaveOutlined />}
                                  loading={savingProvider === provider.name}
                                  onClick={() => onSaveProvider(provider)}
                                >
                                  保存配置
                                </Button>
                              </Col>
                              <Col>
                                <Button
                                  size="small"
                                  icon={<CloudSyncOutlined />}
                                  loading={fetching}
                                  disabled={!provider.configured}
                                  onClick={() => onFetchModels(provider.name)}
                                >
                                  获取模型列表
                                </Button>
                              </Col>
                              <Col>
                                <Button
                                  size="small"
                                  icon={<ExperimentOutlined />}
                                  loading={testing}
                                  disabled={!provider.configured}
                                  onClick={() => onTestProvider(provider.name)}
                                >
                                  测试连接
                                </Button>
                              </Col>
                            </Row>

                            {/* Model selector (after fetching) */}
                            {models.length > 0 && (
                              <div style={{ marginTop: 12 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  选择测试模型 ({models.length} 个可用):
                                </Text>
                                <Select
                                  style={{ width: '100%', marginTop: 4 }}
                                  value={selectedTestModel[provider.name]}
                                  onChange={val => setSelectedTestModel(prev => ({ ...prev, [provider.name]: val }))}
                                  showSearch
                                  optionFilterProp="label"
                                  options={models.map(m => ({
                                    label: `${m.id}${m.ownedBy ? ' (' + m.ownedBy + ')' : ''}`,
                                    value: m.id
                                  }))}
                                />
                              </div>
                            )}

                            {/* baseUrl display */}
                            {provider.baseUrl && models.length === 0 && (
                              <div style={{ marginTop: 8 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  <GlobalOutlined /> {provider.baseUrl}
                                </Text>
                              </div>
                            )}

                            {/* Test result */}
                            {result && (
                              <Alert
                                style={{ marginTop: 10, borderRadius: 6 }}
                                type={
                                  result.status === 'ok'
                                    ? 'success'
                                    : result.status === 'unconfigured'
                                    ? 'info'
                                    : 'error'
                                }
                                showIcon
                                icon={
                                  result.status === 'ok' ? (
                                    <CheckCircleOutlined />
                                  ) : (
                                    <CloseCircleOutlined />
                                  )
                                }
                                message={
                                  <Space wrap>
                                    <Text strong>
                                      {result.status === 'ok'
                                        ? '连接成功'
                                        : result.status === 'unconfigured'
                                        ? '未配置'
                                        : '连接失败'}
                                    </Text>
                                    {result.latency != null && (
                                      <Tag icon={<ClockCircleOutlined />}>
                                        延迟 {result.latency}ms
                                      </Tag>
                                    )}
                                    {result.model && <Tag>模型：{result.model}</Tag>}
                                  </Space>
                                }
                                description={
                                  result.reply ? (
                                    <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                                      回复：{result.reply}
                                    </Text>
                                  ) : result.error ? (
                                    <Text type="danger" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                                      错误：{result.error}
                                    </Text>
                                  ) : result.message ? (
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      {result.message}
                                    </Text>
                                  ) : null
                                }
                              />
                            )}

                            {/* Fetched models list (collapsible) */}
                            {models.length > 0 && (
                              <Collapse
                                ghost
                                style={{ marginTop: 8 }}
                                items={[
                                  {
                                    key: provider.name,
                                    label: (
                                      <Text type="secondary" style={{ fontSize: 12 }}>
                                        已获取模型列表 ({models.length})
                                      </Text>
                                    ),
                                    children: (
                                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {models.map((model: any, idx: number) => (
                                          <div
                                            key={idx}
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              alignItems: 'center',
                                              padding: '4px 0',
                                              borderBottom: idx < models.length - 1 ? '1px dashed var(--ant-color-border)' : 'none'
                                            }}
                                          >
                                            <Space size="small">
                                              <Text style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                                                {model.id}
                                              </Text>
                                            </Space>
                                            {model.ownedBy && (
                                              <Text type="secondary" style={{ fontSize: 11 }}>
                                                {model.ownedBy}
                                              </Text>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  }
                                ]}
                              />
                            )}
                          </div>
                        );
                      })}

                      {/* Config hint */}
                      <Alert
                        type="info"
                        showIcon
                        icon={<BulbOutlined />}
                        style={{ marginTop: 8, borderRadius: 6 }}
                        message="配置中心已启用（不写入数据库）"
                        description={
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              1. 直接在本页面编辑并保存，后端会把配置写入被 Git 忽略的 <Text code>server/.env</Text>。
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              2. 通用 OpenAI-compatible 使用 <Text code>AI_API_KEY</Text>、<Text code>AI_BASE_URL</Text>、<Text code>AI_MODEL</Text>，并可用 <Text code>AI_PROVIDER_NAME</Text> 命名。
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              3. 保存后立即热重载，不需要重启后端；API Key 只在服务端本地保存，页面只显示脱敏值。
                            </Text>
                          </div>
                        }
                      />
                    </>
                  )}
                </Card>
              </div>
            );
          }

          // Tavily group: custom render
          if (groupKey === 'tavily') {
            const srcInfo = configSourceMap[tavilyConfig?.configSource] || configSourceMap.none;
            return (
              <div key={groupKey} className="settings-group">
                <div className="settings-group-title">
                  <Space>
                    {group.icon}
                    <span>{group.label}</span>
                  </Space>
                </div>
                <Card styles={{ body: { padding: 24 } }}>
                  {tavilyConfig === null ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin tip="加载 Tavily 配置中...">
                        <div style={{ minHeight: 60 }} />
                      </Spin>
                    </div>
                  ) : tavilyConfig?.error ? (
                    <Alert
                      type="error"
                      showIcon
                      message="加载失败"
                      description={tavilyConfig.error}
                      action={<Button size="small" onClick={loadTavilyConfig}>重试</Button>}
                    />
                  ) : (
                    <>
                      {/* Current status */}
                      <div style={{ marginBottom: 16 }}>
                        <Row align="middle" gutter={[12, 8]}>
                          <Col flex="auto">
                            <Space wrap align="center">
                              <Text strong>当前状态：</Text>
                              <Tag>
                                {tavilyConfig.apiKeySet ? '已配置' : '未配置'}
                              </Tag>
                              <Tag color={srcInfo.color} icon={<EditOutlined />}>
                                来源: {srcInfo.label}
                              </Tag>
                              {tavilyConfig.apiKey && (
                                <Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                                  Key: {tavilyConfig.apiKey}
                                </Text>
                              )}
                              {tavilyConfig.apiKeySet && !tavilyConfig.apiKeyReal && (
                                <Tag>占位符（无效）</Tag>
                              )}
                              {tavilyConfig.baseUrl && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  <GlobalOutlined /> {tavilyConfig.baseUrl}
                                </Text>
                              )}
                            </Space>
                          </Col>
                          <Col>
                            <Button
                              size="small"
                              icon={<SyncOutlined />}
                              onClick={loadTavilyConfig}
                            >
                              重新加载
                            </Button>
                          </Col>
                        </Row>
                      </div>

                      <Divider style={{ margin: '8px 0 16px' }} />

                      {/* API Key input + save */}
                      <div style={{ marginBottom: 16 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>API Key</Text>
                        <Row gutter={[8, 8]} style={{ marginTop: 4 }}>
                          <Col flex="auto">
                            <Input.Password
                              value={tavilyApiKey}
                              onChange={e => setTavilyApiKey(e.target.value)}
                              placeholder="tvly-..."
                            />
                          </Col>
                          <Col>
                            <Button
                              type="primary"
                              icon={<SaveOutlined />}
                              loading={savingTavily}
                              onClick={onSaveTavily}
                            >
                              保存
                            </Button>
                          </Col>
                        </Row>
                        <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                          保存后写入服务端本地 server/.env，热生效，不会写入 SQLite；留空表示不修改现有 Key。
                        </Text>
                      </div>

                      {/* Action buttons */}
                      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
                        <Col>
                          <Button
                            icon={<ExperimentOutlined />}
                            loading={testingTavily}
                            onClick={onTestTavily}
                          >
                            测试连接
                          </Button>
                        </Col>
                        <Col>
                          <Button
                            icon={<LinkOutlined />}
                            href="https://tavily.com"
                            target="_blank"
                          >
                            获取 API Key
                          </Button>
                        </Col>
                      </Row>

                      {/* Test result */}
                      {tavilyTestResult && (
                        <Alert
                          style={{ borderRadius: 6 }}
                          type={
                            tavilyTestResult.status === 'ok'
                              ? 'success'
                              : tavilyTestResult.status === 'unconfigured'
                              ? 'info'
                              : 'error'
                          }
                          showIcon
                          icon={
                            tavilyTestResult.status === 'ok' ? (
                              <CheckCircleOutlined />
                            ) : (
                              <CloseCircleOutlined />
                            )
                          }
                          message={
                            <Space wrap>
                              <Text strong>
                                {tavilyTestResult.status === 'ok'
                                  ? '连接成功'
                                  : tavilyTestResult.status === 'unconfigured'
                                  ? '未配置'
                                  : '连接失败'}
                              </Text>
                              {tavilyTestResult.latency != null && (
                                <Tag icon={<ClockCircleOutlined />}>
                                  延迟 {tavilyTestResult.latency}ms
                                </Tag>
                              )}
                              {tavilyTestResult.resultCount != null && (
                                <Tag>返回 {tavilyTestResult.resultCount} 条结果</Tag>
                              )}
                            </Space>
                          }
                          description={
                            tavilyTestResult.message ? (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {tavilyTestResult.message}
                              </Text>
                            ) : tavilyTestResult.error ? (
                              <Text type="danger" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                                错误：{tavilyTestResult.error}
                              </Text>
                            ) : null
                          }
                        />
                      )}
                    </>
                  )}
                </Card>
              </div>
            );
          }

          // Feishu group: global fallback configuration in local server/.env
          if (groupKey === 'feishu') {
            const values = feishuConfig?.values || {};
            const webhookValue = values.FEISHU_WEBHOOK_URL || {};
            const secretValue = values.FEISHU_SECRET || {};
            const webhookSource = configSourceMap[webhookValue.source] || configSourceMap.none;
            return (
              <div key={groupKey} className="settings-group">
                <div className="settings-group-title">
                  <Space>
                    {group.icon}
                    <span>{group.label}</span>
                  </Space>
                </div>
                <Card styles={{ body: { padding: 24 } }}>
                  {feishuConfig === null ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin tip="加载飞书配置中..."><div style={{ minHeight: 60 }} /></Spin>
                    </div>
                  ) : feishuConfig.error ? (
                    <Alert
                      type="error"
                      showIcon
                      message="加载失败"
                      description={feishuConfig.error}
                      action={<Button size="small" onClick={loadFeishuConfig}>重试</Button>}
                    />
                  ) : (
                    <>
                      <Space wrap style={{ marginBottom: 16 }}>
                        <Text strong>全局兜底状态：</Text>
                        <Tag>
                          {webhookValue.set ? 'Webhook 已配置' : 'Webhook 未配置'}
                        </Tag>
                        <Tag color={webhookSource.color} icon={<EditOutlined />}>
                          来源：{webhookSource.label}
                        </Tag>
                        {webhookValue.masked && (
                          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                            {webhookValue.masked}
                          </Text>
                        )}
                        <Tag>
                          签名密钥{secretValue.set ? '已配置' : '未配置'}
                        </Tag>
                      </Space>

                      <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                          <Text type="secondary" style={{ fontSize: 12 }}>全局 Webhook URL</Text>
                          <Input.Password
                            value={feishuWebhook}
                            onChange={e => setFeishuWebhook(e.target.value)}
                            placeholder={webhookValue.masked ? `已配置 ${webhookValue.masked}，留空保持不变` : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'}
                            style={{ marginTop: 4 }}
                          />
                        </Col>
                        <Col xs={24} md={12}>
                          <Text type="secondary" style={{ fontSize: 12 }}>全局签名密钥（可选）</Text>
                          <Input.Password
                            value={feishuSecret}
                            onChange={e => setFeishuSecret(e.target.value)}
                            placeholder={secretValue.masked ? `已配置 ${secretValue.masked}，留空保持不变` : '如未启用签名可留空'}
                            style={{ marginTop: 4 }}
                          />
                        </Col>
                        <Col xs={24} md={16}>
                          <Text type="secondary" style={{ fontSize: 12 }}>默认群 Chat ID</Text>
                          <Input
                            value={feishuDefaultChat}
                            onChange={e => setFeishuDefaultChat(e.target.value)}
                            placeholder="oc_..."
                            style={{ marginTop: 4 }}
                          />
                        </Col>
                        <Col xs={24} md={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
                          <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            loading={savingFeishu}
                            onClick={onSaveFeishu}
                            block
                          >
                            保存飞书配置
                          </Button>
                        </Col>
                      </Row>
                      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 11 }}>
                        这是没有匹配到组织 Bot 时的全局兜底配置；组织级 Bot 和告警路由请在「飞书 Bot」页面管理。保存后立即热重载，不写入 SQLite。
                      </Text>
                    </>
                  )}
                </Card>
              </div>
            );
          }

          // Scheduler group: custom render
          if (groupKey === 'scheduler') {
            return (
              <div key={groupKey} className="settings-group">
                <div className="settings-group-title">
                  <Space>
                    {group.icon}
                    <span>{group.label}</span>
                  </Space>
                </div>
                <Card styles={{ body: { padding: 24 } }}>
                  {/* Report dedup hours */}
                  <div style={{ marginBottom: 24 }}>
                    <Row align="middle" gutter={[12, 8]}>
                      <Col flex="auto">
                        <Space direction="vertical" size={2}>
                          <Space>
                            <Text strong>报告去重时间（小时）</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>report_dedup_hours</Text>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            同一 Watchlist 在该时间窗口内已有报告时，跳过重复采集并复用旧报告。默认 24 小时。
                          </Text>
                        </Space>
                      </Col>
                      <Col>
                        <Space>
                          <InputNumber
                            min={1}
                            max={168}
                            value={dedupHours}
                            onChange={v => setDedupHours(Number(v) || 24)}
                            style={{ width: 110 }}
                            addonAfter="小时"
                          />
                          <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            loading={savingDedup}
                            onClick={onSaveDedup}
                          >
                            保存
                          </Button>
                        </Space>
                      </Col>
                    </Row>
                  </div>

                  <Divider style={{ margin: '8px 0 16px' }} />

                  {/* Push switches */}
                  <div>
                    <Space direction="vertical" size={2} style={{ marginBottom: 12 }}>
                      <Space>
                        <Text strong>推送开关</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>push_enabled</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        控制每日报告推送与实时告警推送的启用状态。修改后点击「保存」生效。
                      </Text>
                    </Space>
                    <Row gutter={[24, 12]} align="middle">
                      <Col>
                        <Space>
                          <Switch checked={pushDaily} onChange={setPushDaily} />
                          <Text>每日推送</Text>
                        </Space>
                      </Col>
                      <Col>
                        <Space>
                          <Switch checked={pushRealtimeAlert} onChange={setPushRealtimeAlert} />
                          <Text>实时告警</Text>
                        </Space>
                      </Col>
                      <Col>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={savingPush}
                          onClick={onSavePush}
                        >
                          保存
                        </Button>
                      </Col>
                    </Row>
                  </div>
                </Card>
              </div>
            );
          }

          // Standard setting groups
          return (
            <div key={groupKey} className="settings-group">
              <div className="settings-group-title">
                <Space>
                  {group.icon}
                  <span>{group.label}</span>
                </Space>
              </div>
              <Card styles={{ body: { padding: 24 } }}>
                {group.keys.map(key => {
                  const item = itemsByKey[key];
                  if (!item) return null;
                  const meta = settingLabels[key] || { label: key, type: 'string' as const };
                  return (
                    <div key={key} style={{ marginBottom: 20 }}>
                      <Form.Item
                        name={key}
                        label={
                          <Space>
                            <Text strong>{meta.label}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>{key}</Text>
                          </Space>
                        }
                        extra={meta.tip}
                        style={{ marginBottom: 8 }}
                        rules={meta.type === 'json' ? [{
                          validator: (_, v) => {
                            if (!v) return Promise.resolve();
                            try { JSON.parse(v); return Promise.resolve(); }
                            catch { return Promise.reject(new Error('不是合法 JSON')); }
                          }
                        }] : []}
                      >
                        <Input.TextArea
                          rows={meta.type === 'json' ? 5 : 1}
                          placeholder={meta.type === 'json' ? '{"key": "value"}' : ''}
                          style={{ fontFamily: meta.type === 'json' ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit' }}
                        />
                      </Form.Item>
                      <Button type="primary" icon={<SaveOutlined />} onClick={() => onSave(key)}>
                        保存
                      </Button>
                    </div>
                  );
                })}
                {group.keys.every(k => !itemsByKey[k]) && (
                  <Empty description="该分组暂无设置项" />
                )}
              </Card>
            </div>
          );
        })}
      </Form>

      <Divider />

      <Card size="small" style={{ background: 'var(--ant-color-fill-tertiary)' }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Space>
              <BulbOutlined style={{ color: 'var(--v-text-2)', fontSize: 18 }} />
              <div>
                <Text strong>提示</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {feishuConfig?.editable === false ? '云端凭据保存在 Cloudflare Secrets，业务设置保存在 D1。' : 'AI、Tavily 和全局飞书凭据保存在 server/.env；业务设置保存在 SQLite。'}
                  </Text>
                </div>
              </div>
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Space>
              <SendOutlined style={{ color: 'var(--v-text-2)', fontSize: 18 }} />
              <div>
                <Text strong>推送调试</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    需要测试推送时，可去 <a onClick={() => navigate('/bots')}>飞书 Bot 页面</a> 点 "测试" 按钮。
                  </Text>
                </div>
              </div>
            </Space>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
