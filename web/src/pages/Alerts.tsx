import { useAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { Card, Tag, Space, Typography, Button, Popconfirm, message, Empty, Segmented, Row, Col, Checkbox } from 'antd';
import {
  CheckOutlined, CloseOutlined, SendOutlined, WarningOutlined,
  InfoCircleOutlined, FireOutlined, ClockCircleOutlined, CheckSquareOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { alertsApi } from '../api';

const { Title, Text } = Typography;

const levelMeta: Record<string, { color: string; text: string; icon: any; bgClass: string }> = {
  info: { color: 'var(--v-info)', text: '信息', icon: <InfoCircleOutlined />, bgClass: 'info' },
  warning: { color: 'var(--v-warn)', text: '警告', icon: <WarningOutlined />, bgClass: 'warning' },
  critical: { color: 'var(--v-risk)', text: '严重', icon: <FireOutlined />, bgClass: 'critical' }
};

const statusMeta: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  sent: { color: 'default', text: '已发送' },
  acked: { color: 'default', text: '已确认' },
  dismissed: { color: 'default', text: '已忽略' }
};

export default function Alerts() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (filterStatus) params.status = filterStatus;
      const r = await alertsApi.list(params);
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, filterStatus]);

  const onAck = async (id: number) => {
    await alertsApi.ack(id);
    message.success('已确认');
    load();
  };

  const onDismiss = async (id: number) => {
    await alertsApi.dismiss(id);
    message.success('已忽略');
    load();
  };

  const onResend = async (id: number) => {
    const r = await alertsApi.resend(id);
    if (r.ok) message.success('已重新发送');
    else message.error(r.error || '发送失败');
  };

  // 批量操作
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };
  const selectAll = () => {
    if (selectedIds.length === items.length) setSelectedIds([]);
    else setSelectedIds(items.map(i => i.id));
  };
  const batchAction = async (action: 'ack' | 'dismiss') => {
    if (selectedIds.length === 0) return;
    setBatchLoading(true);
    try {
      const promises = selectedIds.map(id => action === 'ack' ? alertsApi.ack(id) : alertsApi.dismiss(id));
      const results = await Promise.allSettled(promises);
      const ok = results.filter(r => r.status === 'fulfilled').length;
      message.success(`已处理 ${ok}/${selectedIds.length} 条`);
      setSelectedIds([]);
      load();
    } finally {
      setBatchLoading(false);
    }
  };

  // 按时间分组（用于时间线视图）
  const grouped = items.reduce((acc: any, item: any) => {
    const day = dayjs(item.created_at).format('YYYY-MM-DD');
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <WarningOutlined />
            告警中心
          </h1>
          <div className="page-subtitle">共 {total} 条告警 · 实时监控跨境信号变化</div>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 12 } }}>
        <Row justify="space-between" align="middle" gutter={16}>
          <Col flex="auto">
            <Space wrap>
              <Text type="secondary">状态：</Text>
              <Tag.CheckableTag checked={!filterStatus} onChange={() => setFilterStatus(undefined)}>全部</Tag.CheckableTag>
              {Object.entries(statusMeta).map(([k, v]) => (
                <Tag.CheckableTag key={k} checked={filterStatus === k} onChange={(c) => setFilterStatus(c ? k : undefined)}>
                  {v.text}
                </Tag.CheckableTag>
              ))}
            </Space>
          </Col>
          <Col>
            <Space>
              {selectedIds.length > 0 && (
                <Space>
                  <Text type="secondary">已选 {selectedIds.length} 条</Text>
                  <Button size="small" disabled={user?.is_demo} icon={<CheckOutlined />} loading={batchLoading} onClick={() => batchAction('ack')}>批量确认</Button>
                  <Button size="small" disabled={user?.is_demo} icon={<CloseOutlined />} loading={batchLoading} onClick={() => batchAction('dismiss')}>批量忽略</Button>
                </Space>
              )}
              {items.length > 0 && (
                <Button size="small" type="text" onClick={selectAll}>
                  <CheckSquareOutlined /> {selectedIds.length === items.length ? '取消全选' : '全选'}
                </Button>
              )}
              <Segmented
                value={view}
                onChange={(v) => setView(v as any)}
                options={[{ label: '列表', value: 'list' }, { label: '时间线', value: 'timeline' }]}
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {items.length === 0 && !loading ? (
        <Card>
          <Empty description="暂无告警" style={{ padding: 60 }} />
        </Card>
      ) : view === 'list' ? (
        <Row gutter={[16, 12]}>
          {items.map(a => {
            const meta = levelMeta[a.level] || levelMeta.info;
            return (
              <Col span={24} key={a.id}>
                <div className={`alert-card ${meta.bgClass}`} style={{ position: 'relative' }}>
                  <Checkbox
                    checked={selectedIds.includes(a.id)}
                    onChange={() => toggleSelect(a.id)}
                    style={{ marginRight: 12, marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <Space size="small" style={{ marginBottom: 6 }}>
                      <span className={`signal-tag ${meta.bgClass}`}>{meta.icon}{meta.text}</span>
                      <Tag>{a.type}</Tag>
                      <Tag color={statusMeta[a.status]?.color}>{statusMeta[a.status]?.text || a.status}</Tag>
                    </Space>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                    <Text type="secondary" style={{ fontSize: 13 }}>{a.message}</Text>
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        <ClockCircleOutlined /> {dayjs(a.created_at).format('YYYY-MM-DD HH:mm:ss')}
                      </Text>
                    </div>
                  </div>
                  <Space size={4} style={{ marginLeft: 16 }}>
                    {a.status !== 'acked' && (
                      <Button size="small" disabled={user?.is_demo} icon={<CheckOutlined />} onClick={() => onAck(a.id)}>确认</Button>
                    )}
                    {a.status !== 'dismissed' && (
                      <Popconfirm title="确定忽略？" onConfirm={() => onDismiss(a.id)}>
                        <Button size="small" disabled={user?.is_demo} icon={<CloseOutlined />}>忽略</Button>
                      </Popconfirm>
                    )}
                    <Button size="small" disabled={user?.is_demo} icon={<SendOutlined />} onClick={() => onResend(a.id)}>重发</Button>
                  </Space>
                </div>
              </Col>
            );
          })}
        </Row>
      ) : (
        <div>
          {Object.entries(grouped).map(([day, dayItems]: [string, any]) => (
            <div key={day} style={{ marginBottom: 24 }}>
              <div style={{
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--ant-color-bg-layout)',
                padding: '8px 0', marginBottom: 8
              }}>
                <Text strong style={{ fontSize: 13 }}>
                  {dayjs(day).format('YYYY 年 M 月 D 日')} · {dayItems.length} 条
                </Text>
              </div>
              {dayItems.map((a: any) => {
                const meta = levelMeta[a.level] || levelMeta.info;
                return (
                  <div key={a.id} className={`alert-card ${meta.bgClass}`} style={{ marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Space size="small" style={{ marginBottom: 4 }}>
                        <span className={`signal-tag ${meta.bgClass}`}>{meta.icon}{meta.text}</span>
                        <Text strong style={{ fontSize: 13 }}>{a.title}</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{a.message}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(a.created_at).format('HH:mm:ss')}
                      </Text>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
