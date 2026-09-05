import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, List, Tag, Typography, Space, Alert, Skeleton, Button, Tooltip } from 'antd';
import {
  EyeOutlined, FileTextOutlined, WarningOutlined,
  RiseOutlined, FallOutlined, CompassOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ArrowRightOutlined,
  PlusOutlined, ReloadOutlined, ApiOutlined, FireOutlined,
  ClockCircleOutlined, RobotOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardApi, reportsApi } from '../api';
import { useAuth } from '../lib/auth';
import { CountUp } from '../components/CountUp';
import { EmptyState } from '../components/EmptyState';

const { Title, Text, Paragraph } = Typography;

const signalMeta: Record<string, { color: string; text: string; icon: any }> = {
  opportunity: { color: 'var(--v-ok)', text: '机会', icon: <RiseOutlined /> },
  neutral: { color: 'var(--v-info)', text: '中性', icon: null },
  risk: { color: 'var(--v-risk)', text: '风险', icon: <FallOutlined /> }
};

const levelMeta: Record<string, { color: string; text: string }> = {
  info: { color: 'var(--v-info)', text: '信息' },
  warning: { color: 'var(--v-warn)', text: '警告' },
  critical: { color: 'var(--v-risk)', text: '严重' }
};

const chartColors: Record<string, string> = {
  opportunity: 'var(--v-text)', neutral: 'var(--v-text-2)', risk: 'var(--v-text-3)'
};

function SignalTrend({ data }: { data: any[] }) {
  const dates = [...new Set(data.map((item) => item.date))];
  const types = [...new Set(data.map((item) => item.type))];
  const max = Math.max(1, ...data.map((item) => Number(item.count) || 0));
  const x = (index: number) => 42 + index * (636 / Math.max(1, dates.length - 1));
  const y = (value: number) => 205 - (value / max) * 165;
  return (
    <div className="native-chart" aria-label="7 天信号趋势图">
      <svg viewBox="0 0 720 240" role="img">
        {[0, .5, 1].map((ratio) => <line key={ratio} x1="42" x2="678" y1={y(max * ratio)} y2={y(max * ratio)} className="chart-grid" />)}
        {dates.map((date, index) => <text key={date} x={x(index)} y="228" textAnchor="middle" className="chart-label">{date}</text>)}
        {types.map((type) => {
          const points = dates.map((date, index) => {
            const item = data.find((row) => row.date === date && row.type === type);
            return `${x(index)},${y(Number(item?.count || 0))}`;
          }).join(' ');
          return <polyline key={type} points={points} fill="none" stroke={chartColors[type] || 'var(--v-text)'} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />;
        })}
      </svg>
      <div className="chart-legend">{types.map((type) => <span key={type}><i style={{ background: chartColors[type] }} />{signalMeta[type]?.text || type}</span>)}</div>
    </div>
  );
}

function SignalDonut({ data }: { data: Array<{ type: string; count: number }> }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const segments = data.map((item) => {
    const start = cursor;
    cursor += total ? (item.count / total) * 100 : 0;
    const key = Object.keys(signalMeta).find((type) => signalMeta[type].text === item.type) || 'neutral';
    return `${chartColors[key]} ${start}% ${cursor}%`;
  });
  return <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${segments.join(',')})` }}><strong>{total}</strong><span>信号</span></div><div className="chart-legend vertical">{data.map((item) => <span key={item.type}>{item.type} · {item.count}</span>)}</div></div>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
  const [data, setData] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any>(null);
  const [recentReports, setRecentReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<dayjs.Dayjs | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setRefreshing(!showLoading);
    try {
      const [d, h, ts, r] = await Promise.all([
        dashboardApi.get(),
        dashboardApi.health(),
        dashboardApi.timeseries(),
        reportsApi.list({ pageSize: 5 })
      ]);
      setData(d);
      setHealth(h);
      setTimeseries(ts);
      setRecentReports(r.items || []);
      setLastSyncAt(dayjs());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(false), 30000);
    return () => clearInterval(t);
  }, [load]);

  if (loading || !data) {
    return (
      <div>
        <Skeleton active paragraph={{ rows: 1 }} style={{ marginBottom: 24 }} />
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {[1, 2, 3, 4].map(i => (
            <Col xs={24} sm={12} md={6} key={i} style={{ marginBottom: 12 }}><Card><Skeleton active /></Card></Col>
          ))}
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={16} style={{ marginBottom: 12 }}><Card><Skeleton active paragraph={{ rows: 6 }} /></Card></Col>
          <Col xs={24} md={8}><Card><Skeleton active paragraph={{ rows: 6 }} /></Card></Col>
        </Row>
      </div>
    );
  }

  const counts = data.counts || {};

  // 准备图表数据
  const lineData: any[] = [];
  const signalByDay: Record<string, Record<string, number>> = {};
  (timeseries?.data || []).forEach((row: any) => {
    const date = dayjs(row.date).format('MM-DD');
    if (!signalByDay[date]) signalByDay[date] = {};
    signalByDay[date][row.signal_type] = row.count;
  });
  Object.entries(signalByDay).forEach(([date, signals]) => {
    Object.entries(signals).forEach(([type, count]) => {
      lineData.push({ date, type, count });
    });
  });

  const pieData = (timeseries?.data || []).reduce((acc: any[], row: any) => {
    const existing = acc.find((a: any) => a.type === row.signal_type);
    if (existing) existing.count += row.count;
    else acc.push({ type: row.signal_type, count: row.count });
    return acc;
  }, []);

  const pieChartData = pieData.map((d: any) => ({
    type: signalMeta[d.type]?.text || d.type,
    count: d.count
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <CompassOutlined />
            仪表盘
          </h1>
          <div className="page-subtitle">
            {currentOrg ? `组织：${currentOrg.name} · ` : ''}全球市场动态一览
            {lastSyncAt && (
              <span style={{ marginLeft: 8 }}>
                · 上次同步 <ClockCircleOutlined /> {lastSyncAt.format('HH:mm:ss')}
              </span>
            )}
          </div>
        </div>
        <Space>
          <Tooltip title="运行所有监控项">
            <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/watchlist')}>
              运行全部
            </Button>
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/watchlist')}>
            新建监控
          </Button>
          <Button icon={<ReloadOutlined spin={refreshing} />} onClick={() => load(false)} loading={refreshing}>
            刷新
          </Button>
        </Space>
      </div>

      {health && health.status !== 'ok' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Space>
              <span>部分服务异常：</span>
              {Object.entries(health.checks).map(([k, v]) => (
                <Tag key={k} bordered={false}>
                  <Space size={4}>
                    {v ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    <span>{k}</span>
                  </Space>
                </Tag>
              ))}
            </Space>
          }
        />
      )}

      {/* KPI 卡片（带数字动画） */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
          <Card className="kpi-card" style={{ width: '100%' }}>
            <div className="kpi-label"><ThunderboltOutlined /> 监控目标</div>
            <div className="kpi-value"><CountUp value={counts.watchlist} /></div>
            <div className="kpi-caption">已启用的活跃监控</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
          <Card className="kpi-card" style={{ width: '100%' }}>
            <div className="kpi-label"><FileTextOutlined /> 情报报告</div>
            <div className="kpi-value"><CountUp value={counts.reports} /></div>
            <div className="kpi-caption">累计生成</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
          <Card className="kpi-card" style={{ width: '100%' }}>
            <div className="kpi-label"><RiseOutlined /> 7天机会信号</div>
            <div className="kpi-value"><CountUp value={counts.opportunities7d} /></div>
            <div className="kpi-caption">AI 识别到的正向信号</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
          <Card className="kpi-card" style={{ width: '100%' }}>
            <div className="kpi-label"><FallOutlined /> 7天风险信号</div>
            <div className="kpi-value"><CountUp value={counts.risks7d} /></div>
            <div className="kpi-caption">需关注的负向信号</div>
          </Card>
        </Col>
      </Row>

      {/* 趋势图 + 饼图 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={16}>
          <Card
            title={<span><ThunderboltOutlined /> 7 天信号趋势</span>}
            extra={<Text type="secondary" style={{ fontSize: 11 }}>每日各类型信号数</Text>}
            styles={{ body: { padding: 16, minHeight: 280 } }}
          >
            {lineData.length > 0 ? (
              <SignalTrend data={lineData} />
            ) : (
              <EmptyState
                icon={<RobotOutlined />}
                title="暂无趋势数据"
                description="运行几个监控目标后会显示"
                size="small"
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            title={<span>信号分布</span>}
            styles={{ body: { padding: 16, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' } }}
          >
            {pieChartData.length > 0 ? (
              <SignalDonut data={pieChartData} />
            ) : (
              <EmptyState icon={<FireOutlined />} title="暂无数据" size="small" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 最近报告 & 告警 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <FileTextOutlined />
                <span>最近报告</span>
                {recentReports.length > 0 && <Tag>{recentReports.length}</Tag>}
              </Space>
            }
            extra={
              <Link to="/reports" style={{ fontSize: 12 }}>
                查看全部 <ArrowRightOutlined />
              </Link>
            }
            styles={{ body: { padding: '0 16px' } }}
          >
            {recentReports.length === 0 ? (
              <EmptyState
                icon={<FileTextOutlined />}
                title="还没有报告"
                description="添加监控目标后会自动生成"
                action={{ text: '新建监控', onClick: () => navigate('/watchlist'), icon: <PlusOutlined /> }}
                size="small"
              />
            ) : (
              <List
                dataSource={recentReports}
                renderItem={(r: any) => {
                  const meta = signalMeta[r.signal_type] || signalMeta.neutral;
                  return (
                    <List.Item style={{ borderBottom: '1px solid var(--ant-color-border-secondary)', padding: '14px 0' }}>
                      <List.Item.Meta
                        title={
                          <Space>
                            <span className={`signal-tag ${r.signal_type}`}>
                              {meta.icon}{meta.text}
                            </span>
                            <Text strong>{r.title}</Text>
                          </Space>
                        }
                        description={
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, color: 'var(--v-text-3)', fontSize: 12 }}>
                            {r.summary}
                          </Paragraph>
                        }
                      />
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {dayjs(r.created_at).format('MM-DD HH:mm')}
                      </Text>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card
            title={
              <Space>
                <WarningOutlined />
                <span>最近告警</span>
                {data.recentAlerts?.length > 0 && <Tag bordered={false}>{data.recentAlerts.length}</Tag>}
              </Space>
            }
            extra={
              <Link to="/alerts" style={{ fontSize: 12 }}>
                查看全部 <ArrowRightOutlined />
              </Link>
            }
            styles={{ body: { padding: 8 } }}
          >
            {!data.recentAlerts || data.recentAlerts.length === 0 ? (
              <EmptyState
                icon={<CheckCircleOutlined />}
                title="系统运行良好"
                description="暂无告警"
                size="small"
              />
            ) : (
              data.recentAlerts.map((a: any) => {
                const meta = levelMeta[a.level as keyof typeof levelMeta] || levelMeta.info;
                return (
                  <div key={a.id} className={`alert-card ${a.level}`}>
                    <Space align="start" style={{ width: '100%' }} direction="vertical" size={4}>
                      <Space>
                        <span className={`signal-tag ${a.level}`}>{meta.text}</span>
                        <Text strong style={{ fontSize: 13 }}>{a.title}</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>{a.message}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(a.created_at).format('MM-DD HH:mm:ss')}
                      </Text>
                    </Space>
                  </div>
                );
              })
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
