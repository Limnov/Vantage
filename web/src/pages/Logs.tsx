import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Button, Space, Tag, Typography, Tooltip, Empty, Segmented, Row, Col, Statistic, message } from 'antd';
import {
  FileTextOutlined, ClearOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, InfoCircleOutlined,
  DatabaseOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { logsApi } from '../api';

const { Text, Paragraph, Title } = Typography;

interface LogEntry {
  id: number;
  ts: string;
  level: string;
  category: string;
  message: string;
  meta: any;
}

const levelMeta: Record<string, { color: string; icon: any; tag: string }> = {
  info: { color: 'var(--v-info)', icon: <InfoCircleOutlined />, tag: 'default' },
  warn: { color: 'var(--v-warn)', icon: <WarningOutlined />, tag: 'default' },
  error: { color: 'var(--v-risk)', icon: <CloseCircleOutlined />, tag: 'error' },
  debug: { color: 'var(--v-text-3)', icon: <InfoCircleOutlined />, tag: 'default' }
};

const categoryMeta: Record<string, { color: string; label: string }> = {
  system: { color: 'default', label: '系统' },
  watchlist: { color: 'default', label: '监控' },
  push: { color: 'default', label: '推送' },
  ai: { color: 'default', label: 'AI' },
  bot: { color: 'default', label: 'Bot' },
  api: { color: 'default', label: 'API' }
};

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [latestId, setLatestId] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async (initial = false) => {
    try {
      const params: any = { limit: initial ? 100 : 200 };
      if (!initial && latestId > 0) {
        params.sinceId = latestId;
      }
      const r = await logsApi.list(params);
      if (r.items && r.items.length > 0) {
        setLogs(prev => {
          const combined = [...prev, ...r.items];
          return combined.slice(-500);
        });
        setLatestId(r.latestId || latestId);
      } else if (initial) {
        setLatestId(r.latestId || 0);
      }
    } catch {
      // silent
    }
  }, [latestId]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await logsApi.stats();
      setStats(s);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLogs(true);
    fetchStats();
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchLogs(false);
      fetchStats();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLogs, fetchStats]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClear = async () => {
    try {
      await logsApi.clear();
      setLogs([]);
      setLatestId(0);
      fetchStats();
      message.success('日志已清空');
    } catch {
      message.error('清空失败');
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setLogs([]);
    setLatestId(0);
    await fetchLogs(true);
    await fetchStats();
    setLoading(false);
  };

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.category === filter);

  const renderLog = (log: LogEntry) => {
    const meta = levelMeta[log.level] || levelMeta.info;
    const cat = categoryMeta[log.category] || { color: 'default', label: log.category };
    const metaStr = log.meta && Object.keys(log.meta).length > 0
      ? JSON.stringify(log.meta)
      : '';

    return (
      <div
        key={log.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          lineHeight: 1.6,
          background: log.level === 'error' ? 'var(--v-surface-3)' :
                      log.level === 'warn' ? 'var(--v-surface-2)' : 'transparent',
          transition: 'background 0.2s'
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 64 }}>
          {dayjs(log.ts).format('HH:mm:ss')}
        </Text>
        <span style={{ color: meta.color, flexShrink: 0, marginTop: 1 }}>
          {meta.icon}
        </span>
        <Tag color={cat.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0, flexShrink: 0, minWidth: 40, textAlign: 'center' }}>
          {cat.label}
        </Tag>
        <Text style={{ flex: 1, wordBreak: 'break-word', color: log.level === 'error' ? 'var(--v-risk)' : 'inherit' }}>
          {log.message}
          {metaStr && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              {metaStr}
            </Text>
          )}
        </Text>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <FileTextOutlined />
            系统日志
          </h1>
          <div className="page-subtitle">
            实时查看系统运行状态 · 自动刷新 (3s)
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={handleRefresh} loading={loading}>
            刷新
          </Button>
          <Button icon={<ClearOutlined />} onClick={handleClear} danger>
            清空
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 20, alignItems: 'stretch' }}>
          <Col xs={12} sm={6} style={{ display: 'flex' }}>
            <Card style={{ width: '100%' }} styles={{ body: { padding: 16 } }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>总日志</Text>}
                value={stats.total}
                prefix={<DatabaseOutlined style={{ color: 'var(--v-text-3)' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6} style={{ display: 'flex' }}>
            <Card style={{ width: '100%' }} styles={{ body: { padding: 16 } }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>错误</Text>}
                value={stats.byLevel?.error || 0}
                valueStyle={{ color: (stats.byLevel?.error || 0) > 0 ? 'var(--v-risk)' : undefined }}
                prefix={<CloseCircleOutlined style={{ color: 'var(--v-risk)' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6} style={{ display: 'flex' }}>
            <Card style={{ width: '100%' }} styles={{ body: { padding: 16 } }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>警告</Text>}
                value={stats.byLevel?.warn || 0}
                valueStyle={{ color: (stats.byLevel?.warn || 0) > 0 ? 'var(--v-warn)' : undefined }}
                prefix={<WarningOutlined style={{ color: 'var(--v-warn)' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6} style={{ display: 'flex' }}>
            <Card style={{ width: '100%' }} styles={{ body: { padding: 16 } }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 12 }}>最新更新</Text>}
                value={stats.latestTs ? dayjs(stats.latestTs).format('HH:mm:ss') : '-'}
                prefix={<ClockCircleOutlined style={{ color: 'var(--v-ok)' }} />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 日志列表 */}
      <Card
        title={
          <Space>
            <Segmented
              size="small"
              value={filter}
              onChange={(v) => setFilter(v as string)}
              options={[
                { label: '全部', value: 'all' },
                { label: '监控', value: 'watchlist' },
                { label: '推送', value: 'push' },
                { label: 'AI', value: 'ai' },
                { label: '系统', value: 'system' }
              ]}
            />
            <Tag>{filteredLogs.length} 条</Tag>
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <div
          ref={scrollRef}
          style={{
            maxHeight: 'calc(100vh - 380px)',
            minHeight: 400,
            overflowY: 'auto',
            overflowX: 'hidden'
          }}
        >
          {filteredLogs.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无日志记录"
              />
            </div>
          ) : (
            [...filteredLogs].reverse().map(renderLog)
          )}
        </div>
      </Card>
    </div>
  );
}
