/**
 * 飞书机器人管理页
 * - 机器人 CRUD
 * - 测试发送 + 脱敏诊断日志面板
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Modal, Form, Input, Switch, Tag, Space, Typography, Popconfirm, Tooltip, App as AntdApp, Alert, Divider, Row, Col, Spin } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined, StarOutlined, StarFilled,
  ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  CodeOutlined, ClearOutlined, WarningOutlined
} from '@ant-design/icons';
import { botsApi } from '../api';
import { useAuth } from '../lib/auth';

const { Title, Text, Paragraph } = Typography;

interface TestLog {
  timestamp: string;
  botId: number;
  botName: string;
  ok: boolean;
  error?: string | null;
  reason?: string | null;
  latency?: number;
  statusCode?: number | null;
  message?: string;
  webhookUrlMasked?: string;
}

export default function Bots() {
  const { currentOrgId, currentOrg } = useAuth();
  const { message } = AntdApp.useApp();
  const [bots, setBots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();

  // Test logs
  const [logs, setLogs] = useState<TestLog[]>([]);
  const [testing, setTesting] = useState<number | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [showCustomMsg, setShowCustomMsg] = useState(false);

  const load = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      const r = await botsApi.list(currentOrgId);
      setBots(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentOrgId]);

  const onSubmit = async (values: any) => {
    try {
      if (editing) {
        await botsApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await botsApi.create({ ...values, orgId: currentOrgId });
        message.success('已创建');
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const onDelete = async (id: number) => {
    try {
      await botsApi.remove(id);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const onTest = async (id: number) => {
    setTesting(id);
    try {
      const msg = customMessage || undefined;
      const r = await botsApi.test(id, msg);
      // Add to logs
      const logEntry: TestLog = {
        timestamp: r.timestamp || new Date().toISOString(),
        botId: r.botId || id,
        botName: r.botName || `Bot #${id}`,
        ok: r.ok,
        error: r.error,
        reason: r.reason,
        latency: r.latency,
        statusCode: r.statusCode,
        message: r.message,
        webhookUrlMasked: r.webhookUrlMasked
      };
      setLogs(prev => [logEntry, ...prev].slice(0, 20));

      if (r.ok) {
        message.success(`测试消息已发送 (${r.latency || 0}ms)`);
      } else {
        message.error(`发送失败: ${r.error || '未知错误'}`);
      }
    } catch (err: any) {
      // HTTP error from API
      const errorLog: TestLog = {
        timestamp: new Date().toISOString(),
        botId: id,
        botName: `Bot #${id}`,
        ok: false,
        error: err.response?.data?.error || err.message || '请求失败',
        reason: 'http_error',
        statusCode: err.response?.status || null
      };
      setLogs(prev => [errorLog, ...prev].slice(0, 20));
      message.error(err.response?.data?.error || '请求失败');
    } finally {
      setTesting(null);
    }
  };

  const onSetDefault = async (id: number) => {
    try {
      await botsApi.update(id, { is_default: 1 });
      message.success('已设为默认');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '失败');
    }
  };

  const onToggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await botsApi.update(id, { enabled: enabled ? 1 : 0 });
      message.success(enabled ? '已启用' : '已停用');
      load();
    } catch {}
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = async (bot: any) => {
    const full = await botsApi.get(bot.id);
    setEditing(full);
    form.setFieldsValue(full);
    setModalOpen(true);
  };

  const clearLogs = () => setLogs([]);

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    } catch {
      return ts;
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>飞书机器人</Title>
          <Text type="secondary">当前组织：<Text strong>{currentOrg?.name || '-'}</Text></Text>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} onClick={openCreate}>
            新增 Bot
          </Button>
        </Space>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Table
          dataSource={bots}
          rowKey="id"
          loading={loading}
          pagination={false}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (v, r) => (
                <Space>
                  <ApiOutlined style={{ color: 'var(--v-text-2)' }} />
                  <Text strong>{v}</Text>
                  {r.is_default === 1 && (
                    <Tooltip title="组织默认 bot">
                      <Tag icon={<StarFilled />}>默认</Tag>
                    </Tooltip>
                  )}
                </Space>
              )
            },
            { title: 'Webhook', dataIndex: 'webhook_url_masked', render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
            { title: '描述', dataIndex: 'description', render: (v) => v || '-' },
            {
              title: '启用',
              dataIndex: 'enabled',
              render: (v, r) => (
                <Switch checked={!!v} onChange={(c) => onToggleEnabled(r.id, c)} size="small" />
              )
            },
            {
              title: '操作',
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    icon={<SendOutlined />}
                    loading={testing === r.id}
                    onClick={() => onTest(r.id)}
                  >
                    测试
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
                  {r.is_default !== 1 && (
                    <Button size="small" icon={<StarOutlined />} onClick={() => onSetDefault(r.id)}>设为默认</Button>
                  )}
                  {r.is_default !== 1 && (
                    <Popconfirm title="删除这个 bot？" onConfirm={() => onDelete(r.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              )
            }
          ]}
        />
      </Card>

      {/* Custom message input */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Button
              size="small"
              icon={<CodeOutlined />}
              onClick={() => setShowCustomMsg(!showCustomMsg)}
            >
              {showCustomMsg ? '收起自定义消息' : '自定义测试消息'}
            </Button>
          </Space>
          {showCustomMsg && (
            <Row gutter={[8, 8]}>
              <Col flex="auto">
                <Input.TextArea
                  rows={2}
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  placeholder="留空则发送默认测试消息"
                />
              </Col>
            </Row>
          )}
        </Space>
      </Card>

      {/* Log Panel */}
      <Card
        title={
          <Space>
            <CodeOutlined />
            <span>测试日志</span>
            {logs.length > 0 && (
              <Tag>{logs.length} 条记录</Tag>
            )}
          </Space>
        }
        extra={
          logs.length > 0 ? (
            <Button size="small" icon={<ClearOutlined />} onClick={clearLogs}>清空</Button>
          ) : null
        }
        styles={{ body: { padding: logs.length > 0 ? 16 : 24 } }}
      >
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Text type="secondary">点击表格中的「测试」按钮，测试结果将显示在这里</Text>
          </div>
        ) : (
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {logs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: 12,
                  padding: 12,
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: 8,
                  background: 'var(--v-surface-2)',
                  borderLeft: `4px solid ${log.ok ? 'var(--v-ok)' : 'var(--v-risk)'}`
                }}
              >
                {/* Header */}
                <Row align="middle" gutter={[8, 4]} style={{ marginBottom: 8 }}>
                  <Col>
                    {log.ok ? (
                      <CheckCircleOutlined style={{ color: 'var(--v-ok)', fontSize: 16 }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: 'var(--v-risk)', fontSize: 16 }} />
                    )}
                  </Col>
                  <Col>
                    <Text strong>{log.ok ? '发送成功' : '发送失败'}</Text>
                  </Col>
                  <Col>
                    <Tag>{log.botName}</Tag>
                  </Col>
                  {log.latency != null && (
                    <Col>
                      <Tag icon={<ClockCircleOutlined />}>{log.latency}ms</Tag>
                    </Col>
                  )}
                  {log.statusCode != null && (
                    <Col>
                      <Tag>
                        HTTP {log.statusCode}
                      </Tag>
                    </Col>
                  )}
                  {log.reason && log.reason !== 'http_error' && (
                    <Col>
                      <Tag>{log.reason}</Tag>
                    </Col>
                  )}
                  <Col flex="auto" style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatTime(log.timestamp)}
                    </Text>
                  </Col>
                </Row>

                {/* Error message */}
                {log.error && (
                  <Alert
                    type="error"
                    showIcon
                    icon={<WarningOutlined />}
                    style={{ marginBottom: 8, borderRadius: 6, fontSize: 12 }}
                    message={
                      <Text type="danger" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                        {log.error}
                      </Text>
                    }
                  />
                )}

                {/* Webhook URL */}
                {log.webhookUrlMasked && (
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Webhook: <Text code style={{ fontSize: 11 }}>{log.webhookUrlMasked}</Text>
                    </Text>
                  </div>
                )}

                {/* Sent message */}
                {log.message && (
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>发送内容：</Text>
                    <div
                      style={{
                        padding: '4px 8px',
                        background: 'var(--ant-color-fill-quaternary)',
                        borderRadius: 4,
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                      }}
                    >
                      {log.message}
                    </div>
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Help tips */}
      {logs.some(l => !l.ok) && (
        <Alert
          type="info"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginTop: 16, borderRadius: 8 }}
          message="常见错误排查"
          description={
            <div style={{ fontSize: 12 }}>
              <Text strong>签名校验失败 [9499]</Text>
              <Text type="secondary">：Webhook 启用了签名校验，需在 Bot 编辑页填写签名密钥 (secret)</Text>
              <br />
              <Text strong>URL 不合法 [19021]</Text>
              <Text type="secondary">：Webhook URL 格式错误或已失效，请重新获取群机器人 Webhook 地址</Text>
              <br />
              <Text strong>IP 白名单</Text>
              <Text type="secondary">：飞书群机器人设置了 IP 白名单，需将服务器 IP 加入白名单</Text>
              <br />
              <Text strong>请求超时</Text>
              <Text type="secondary">：网络不通或飞书服务暂时不可用，请检查服务器网络出口</Text>
            </div>
          }
        />
      )}

      <Modal
        title={editing ? '编辑 Bot' : '新增 Bot'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText="保存"
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={{ enabled: 1 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：核心告警群、价格组、政策组" />
          </Form.Item>
          <Form.Item name="webhook_url" label="Webhook URL" rules={[
            { required: true, message: '请输入 webhook URL' },
            { type: 'url', message: 'URL 格式不正确' }
          ]}>
            <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
          </Form.Item>
          <Form.Item name="secret" label="签名密钥（可选）">
            <Input.Password placeholder="如启用签名校验，需填写" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="这个 bot 用来发什么消息？" />
          </Form.Item>
          <Form.Item name="is_default" label="设为默认" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
