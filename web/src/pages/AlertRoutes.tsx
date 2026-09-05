/**
 * 告警路由规则管理
 */

import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, Typography, Popconfirm, Switch, App as AntdApp } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, AimOutlined } from '@ant-design/icons';
import { alertRoutesApi, botsApi } from '../api';
import { useAuth } from '../lib/auth';

const { Title, Text } = Typography;

export default function AlertRoutes() {
  const { currentOrgId, currentOrg } = useAuth();
  const { message } = AntdApp.useApp();
  const [routes, setRoutes] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      const [r, b] = await Promise.all([
        alertRoutesApi.list(currentOrgId),
        botsApi.list(currentOrgId)
      ]);
      setRoutes(r.items || []);
      setBots(b.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentOrgId]);

  const onSubmit = async (values: any) => {
    try {
      const data = {
        ...values,
        orgId: currentOrgId,
        match_level: values.match_level || null,
        match_categories: Array.isArray(values.match_categories) ? values.match_categories.join(',') : (values.match_categories || null),
        match_tags: Array.isArray(values.match_tags) ? values.match_tags.join(',') : (values.match_tags || null),
        match_signal_types: Array.isArray(values.match_signal_types) ? values.match_signal_types.join(',') : (values.match_signal_types || null)
      };
      if (editing) {
        await alertRoutesApi.update(editing.id, data);
        message.success('已更新');
      } else {
        await alertRoutesApi.create(data);
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
      await alertRoutesApi.remove(id);
      message.success('已删除');
      load();
    } catch {}
  };

  const onToggle = async (id: number, enabled: boolean) => {
    await alertRoutesApi.update(id, { enabled: enabled ? 1 : 0 });
    load();
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      match_categories: r.match_categories ? r.match_categories.split(',') : [],
      match_tags: r.match_tags ? r.match_tags.split(',') : [],
      match_signal_types: r.match_signal_types ? r.match_signal_types.split(',') : []
    });
    setModalOpen(true);
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>告警路由</Title>
          <Text type="secondary">
            当前组织：<Text strong>{currentOrg?.name || '-'}</Text> · 优先级数字越大越先匹配
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增规则
        </Button>
      </div>

      <Card>
        <Table
          dataSource={routes}
          rowKey="id"
          loading={loading}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name', render: (v) => <Text strong><AimOutlined /> {v}</Text> },
            { title: '目标 Bot', dataIndex: 'bot_name', render: (v) => <Tag>{v}</Tag> },
            { title: '告警等级', dataIndex: 'match_level', render: (v) => v ? <Tag>{v}</Tag> : <Text type="secondary">任意</Text> },
            { title: '类目', dataIndex: 'match_categories', render: (v) => v ? v.split(',').map((c: string) => <Tag key={c}>{c}</Tag>) : <Text type="secondary">任意</Text> },
            { title: '标签', dataIndex: 'match_tags', render: (v) => v ? v.split(',').map((t: string) => <Tag key={t}>{t}</Tag>) : <Text type="secondary">任意</Text> },
            { title: '信号', dataIndex: 'match_signal_types', render: (v) => v ? v.split(',').map((s: string) => <Tag key={s}>{s}</Tag>) : <Text type="secondary">任意</Text> },
            { title: '优先级', dataIndex: 'priority', width: 80, sorter: (a, b) => a.priority - b.priority, defaultSortOrder: 'descend' },
            {
              title: '启用',
              dataIndex: 'enabled',
              render: (v, r) => <Switch checked={!!v} onChange={(c) => onToggle(r.id, c)} size="small" />
            },
            {
              title: '操作',
              render: (_, r) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
                  <Popconfirm title="删除这条规则？" onConfirm={() => onDelete(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑路由规则' : '新增路由规则'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={() => form.submit()}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={{ priority: 5, enabled: 1 }}>
          <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
            <Input placeholder="如：critical 全部走核心群" />
          </Form.Item>
          <Form.Item name="bot_id" label="目标 Bot" rules={[{ required: true, message: '请选择 bot' }]}>
            <Select placeholder="选择飞书机器人">
              {bots.map(b => (
                <Select.Option key={b.id} value={b.id}>
                  {b.name}{b.is_default === 1 ? ' (默认)' : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="match_level" label="匹配告警等级" extra="不选则匹配全部">
            <Select allowClear placeholder="任意等级">
              <Select.Option value="info">info (信息)</Select.Option>
              <Select.Option value="warning">warning (警告)</Select.Option>
              <Select.Option value="critical">critical (严重)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="match_categories" label="匹配 watchlist 类目" extra="逗号分隔，留空匹配全部">
            <Select mode="tags" placeholder="如：gpu, phone, ar" tokenSeparators={[',']} />
          </Form.Item>

          <Form.Item name="match_tags" label="匹配 watchlist 标签" extra="逗号分隔，留空匹配全部">
            <Select mode="tags" placeholder="如：价格异动, 政策风险" tokenSeparators={[',']} />
          </Form.Item>

          <Form.Item name="match_signal_types" label="匹配信号类型" extra="逗号分隔，留空匹配全部">
            <Select mode="multiple" placeholder="选择信号">
              <Select.Option value="opportunity">opportunity (机会)</Select.Option>
              <Select.Option value="neutral">neutral (中性)</Select.Option>
              <Select.Option value="risk">risk (风险)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="priority" label="优先级" extra="数字越大越先匹配 (1-10)">
            <Input type="number" min={1} max={10} />
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
