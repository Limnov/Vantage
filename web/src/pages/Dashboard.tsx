import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import {
  ArrowRightOutlined, BellOutlined, EyeOutlined, FileTextOutlined,
  ReloadOutlined, RobotOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { dashboardApi, reportsApi } from '../api';
import { useAuth } from '../lib/auth';

type Overview = {
  counts?: { watchlist?: number; reports?: number; opportunities7d?: number; risks7d?: number };
  recentAlerts?: Array<{ id: number; title: string; message?: string; level?: string; created_at?: string }>;
};
type Report = { id: number; title: string; summary?: string; signal_type?: string; created_at?: string };

const shortcuts = [
  { to: '/app', icon: <RobotOutlined />, title: 'Agent', detail: '对话与任务' },
  { to: '/watchlist', icon: <EyeOutlined />, title: '监控', detail: '持续追踪' },
  { to: '/reports', icon: <FileTextOutlined />, title: '报告', detail: '结论与来源' },
  { to: '/alerts', icon: <BellOutlined />, title: '告警', detail: '待处理事项' },
];

export default function Dashboard() {
  const { currentOrg } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const [dashboard, recent] = await Promise.all([
        dashboardApi.get(),
        reportsApi.list({ pageSize: 5 }),
      ]);
      setOverview(dashboard);
      setReports(recent.items || []);
      setError('');
    } catch {
      setError('工作台数据加载失败，请重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = overview?.counts || {};
  const alerts = overview?.recentAlerts || [];

  return (
    <div className="desk-home">
      <div className="desk-home-head">
        <div>
          <span className="desk-overline">当前组织</span>
          <h2>{currentOrg?.name || '工作区'}</h2>
        </div>
        <Button icon={<ReloadOutlined spin={refreshing} />} loading={refreshing} onClick={() => void load()}>
          刷新
        </Button>
      </div>

      {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} />}

      <section className="desk-section" aria-label="快捷入口">
        <div className="desk-section-heading"><h3>快捷入口</h3></div>
        <div className="desk-quick-grid">
          {shortcuts.map((item) => (
            <Link className="desk-quick-link" to={item.to} key={item.to}>
              <span className="desk-quick-icon">{item.icon}</span>
              <span className="desk-quick-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
              <ArrowRightOutlined className="desk-quick-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <section className="desk-section" aria-label="工作区概况">
        <div className="desk-section-heading"><h3>工作区概况</h3></div>
        <div className="desk-stats">
          {[
            ['监控', counts.watchlist],
            ['报告', counts.reports],
            ['7 天机会', counts.opportunities7d],
            ['7 天风险', counts.risks7d],
          ].map(([label, value]) => (
            <div className="desk-stat" key={label}><span>{label}</span><strong>{loading ? <Skeleton.Input active size="small" /> : (value ?? 0)}</strong></div>
          ))}
        </div>
      </section>

      <div className="desk-stream-grid">
        <section className="desk-stream" aria-label="最近报告">
          <div className="desk-stream-head"><h3>最近报告 <span>{reports.length}</span></h3><Link to="/reports">查看全部 <ArrowRightOutlined /></Link></div>
          <div className="desk-stream-body">
            {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : reports.length ? reports.map((report) => (
              <Link className="desk-row" to="/reports" key={report.id}>
                <span className="desk-row-icon"><FileTextOutlined /></span>
                <span className="desk-row-main"><strong>{report.title}</strong><small>{report.summary || '查看报告详情'}</small></span>
                <span className="desk-row-time">{report.created_at ? dayjs(report.created_at).format('MM-DD') : ''}</span>
              </Link>
            )) : <p className="desk-empty">暂无报告 <Link to="/watchlist">前往监控</Link></p>}
          </div>
        </section>
        <section className="desk-stream" aria-label="最近告警">
          <div className="desk-stream-head"><h3>最近告警 <span>{alerts.length}</span></h3><Link to="/alerts">查看全部 <ArrowRightOutlined /></Link></div>
          <div className="desk-stream-body">
            {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : alerts.length ? alerts.map((alert) => (
              <Link className="desk-row" to="/alerts" key={alert.id}>
                <span className={`desk-row-icon ${alert.level === 'critical' ? 'is-critical' : ''}`}><BellOutlined /></span>
                <span className="desk-row-main"><strong>{alert.title}</strong><small>{alert.message || '查看告警详情'}</small></span>
                <span className="desk-row-time">{alert.created_at ? dayjs(alert.created_at).format('MM-DD') : ''}</span>
              </Link>
            )) : <p className="desk-empty">暂无告警</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
