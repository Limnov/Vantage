import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, InputNumber,
  Switch, message, Popconfirm, Card, Typography, Tooltip, Empty, Row, Col
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, EyeOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { watchlistApi } from '../api';

const { Title, Text } = Typography;

const typeMeta: Record<string, { color: string; label: string }> = {
  product: { color: 'default', label: '商品' },
  keyword: { color: 'default', label: '关键词' },
  brand: { color: 'default', label: '品牌' },
  topic: { color: 'default', label: '话题' },
  url: { color: 'default', label: 'URL' }
};

// 2026-06-04: 搜索模式 - 控制 Tavily 采集策略
const searchModeMeta: Record<string, { color: string; label: string; desc: string }> = {
  news:    { color: 'default', label: '时事新闻', desc: '限定 14 天新闻，适合政策/动态' },
  product: { color: 'default', label: '产品查询', desc: '不限时间，适合产品/型号/评测/价格' },
  general: { color: 'default', label: '通用查询', desc: '不限时间，适合品牌口碑/宽泛话题' }
};

const statusMeta: Record<string, { color: string; text: string; icon: any }> = {
  success: { color: 'default', text: '成功', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', text: '失败', icon: <CloseCircleOutlined /> },
  pending: { color: 'default', text: '待运行', icon: <ClockCircleOutlined /> }
};

export default function Watchlist() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<any>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await watchlistApi.list({ page, pageSize, ...filters });
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, filters]);

  const onCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'keyword', search_mode: 'product', priority: 5, region: 'global', language: 'zh', schedule: '0 7 * * *', enabled: true });
    setModalOpen(true);
  };

  const onEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      search_mode: record.search_mode || 'product',
      alert_keywords: record.alert_threshold?.keywords?.join(', ') || ''
    });
    setModalOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const data = {
      ...values,
      alert_threshold: values.alert_keywords
        ? { keywords: values.alert_keywords.split(',').map((s: string) => s.trim()).filter(Boolean) }
        : null
    };
    delete data.alert_keywords;

    try {
      if (editing) {
        await watchlistApi.update(editing.id, data);
        message.success('已更新');
      } else {
        await watchlistApi.create(data);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const onDelete = async (id: number) => {
    await watchlistApi.remove(id);
    message.success('已删除');
    load();
  };

  const [runningId, setRunningId] = useState<number | null>(null);

  const onRun = async (id: number) => {
    setRunningId(id);
    message.loading({ content: '正在执行监控，请稍候...', key: `run-${id}`, duration: 0 });
    try {
      const r = await watchlistApi.run(id);
      if (r.ok) {
        if (r.queued) {
          message.success({content: '已加入后台队列，完成后可在报告中查看结果', key: `run-${id}`, duration: 5});
        } else if (r.deduplicated) {
          message.success({
            content: `「${r.watchlistName || ''}」24小时内已有报告，复用报告 #${r.reportId || '-'}`,
            key: `run-${id}`,
            duration: 5
          });
        } else {
          message.success({
            content: `「${r.watchlistName || ''}」执行完成 -> 报告 #${r.reportId || '-'}, 采集 ${r.results || 0} 条, 告警 ${r.alerts || 0} 条 (${r.durationMs || 0}ms)`,
            key: `run-${id}`,
            duration: 6
          });
        }
        load();
      } else {
        message.error({
          content: `执行失败: ${r.error || '未知错误'}`,
          key: `run-${id}`,
          duration: 6
        });
      }
    } catch (e: any) {
      message.error({
        content: `执行异常: ${e.response?.data?.error || e.message}`,
        key: `run-${id}`,
        duration: 6
      });
    } finally {
      setRunningId(null);
    }
  };

  const onRunAll = async () => {
    const r = await watchlistApi.runAll();
    message.success(`已执行 ${r.count} 个监控项`);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <EyeOutlined />
            监控目标
          </h1>
          <div className="page-subtitle">
            共 <Text strong>{total}</Text> 个监控 · 配置你的跨境关注点
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Popconfirm title="确定执行所有启用的监控项？" onConfirm={onRunAll}>
            <Button icon={<ThunderboltOutlined />}>全部执行</Button>
          </Popconfirm>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新建监控</Button>
        </Space>
      </div>

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 12 } }}>
        <Space wrap size={6}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>筛选：</Text>
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 120 }}
            value={filters.type}
            onChange={(v) => { setPage(1); setFilters({ ...filters, type: v }); }}
            options={Object.entries(typeMeta).map(([k, v]) => ({ value: k, label: v.label }))}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={filters.enabled}
            onChange={(v) => { setPage(1); setFilters({ ...filters, enabled: v === undefined ? undefined : String(v) }); }}
            options={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]}
          />
          {filters.q && (
            <Tag closable onClose={() => { setFilters({ ...filters, q: undefined }); setPage(1); }}>
              搜索：{filters.q}
            </Tag>
          )}
        </Space>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          loading={loading}
          dataSource={items}
          rowKey="id"
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); }
          }}
          locale={{ emptyText: <Empty description="还没有监控目标" style={{ padding: 40 }} /> }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 60 },
            {
              title: '名称',
              dataIndex: 'name',
              render: (v, r: any) => (
                <Space size="small">
                  <Tag color={typeMeta[r.type]?.color}>{typeMeta[r.type]?.label}</Tag>
                  {r.search_mode && (
                    <Tooltip title={searchModeMeta[r.search_mode]?.desc}>
                      <Tag color={searchModeMeta[r.search_mode]?.color} style={{ marginLeft: 0 }}>
                        {searchModeMeta[r.search_mode]?.label}
                      </Tag>
                    </Tooltip>
                  )}
                  <Text strong>{v}</Text>
                  {r.priority >= 8 && <Tag style={{ marginLeft: 0 }}>高优</Tag>}
                </Space>
              )
            },
            { title: '分类', dataIndex: 'category', width: 80, render: (v) => v ? <Tag>{v}</Tag> : <Text type="secondary">-</Text> },
            { title: '查询', dataIndex: 'query', ellipsis: true, render: (v) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
            { title: '优先级', dataIndex: 'priority', width: 80, render: (v) => <Tag>{v}</Tag> },
            { title: '启用', dataIndex: 'enabled', width: 70, render: (v) => v ? <Tag>是</Tag> : <Tag>否</Tag> },
            {
              title: '最近状态',
              dataIndex: 'last_status',
              width: 140,
              render: (v, r: any) => {
                const meta = statusMeta[v] || statusMeta.pending;
                return (
                  <Space direction="vertical" size={0}>
                    <Tag color={meta.color} icon={meta.icon}>{meta.text}</Tag>
                    {r.last_run_at && <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(r.last_run_at).format('MM-DD HH:mm')}</Text>}
                  </Space>
                );
              }
            },
            {
              title: '操作',
              width: 200,
              render: (_, r: any) => (
                <Space size={4}>
                  <Tooltip title="立即执行">
                    <Button
                      size="small"
                      type="text"
                      loading={runningId === r.id}
                      icon={runningId === r.id ? undefined : <PlayCircleOutlined style={{ color: 'var(--v-text)' }} />}
                      onClick={() => onRun(r.id)}
                    />
                  </Tooltip>
                  <Tooltip title="编辑">
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => onEdit(r)} />
                  </Tooltip>
                  <Popconfirm title="确定删除？" onConfirm={() => onDelete(r.id)}>
                    <Tooltip title="删除">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title={
          <Space>
            {editing ? <EditOutlined /> : <PlusOutlined />}
            <span>{editing ? '编辑监控目标' : '新建监控目标'}</span>
          </Space>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSubmit}
        width={640}
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例：RTX 4090 全球价格" size="large" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select options={Object.entries(typeMeta).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="分类">
                <Input placeholder="gpu / phone / toy..." />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="search_mode" label="搜索模式" extra="决定 Tavily 采集策略">
                <Select options={Object.entries(searchModeMeta).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label=" " extra="&nbsp;">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {(() => {
                    const m = form.getFieldValue('search_mode') || 'product';
                    return searchModeMeta[m]?.desc;
                  })()}
                </Text>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="query" label="查询关键词" rules={[{ required: true }]} extra="用于搜索的关键词 / URL / SKU">
            <Input placeholder="例：RTX 4090 price" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="region" label="区域">
                <Select options={[{ value: 'global' }, { value: 'us' }, { value: 'cn' }, { value: 'eu' }, { value: 'jp' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="priority" label="优先级" extra="1-10，越高越重要">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="schedule" label="调度 (cron 表达式)" extra="例如：0 7 * * * = 每天早上 7 点">
            <Input placeholder="0 7 * * *" />
          </Form.Item>
          <Form.Item name="alert_keywords" label="告警关键词" extra="逗号分隔，命中时触发严重告警">
            <Input placeholder="例：涨价, 缺货, 限购" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
