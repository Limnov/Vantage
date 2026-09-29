import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Space, Spin, Tag, Typography, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { ReloadOutlined, RiseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { forecastReviewsApi } from '../api';
import { useAuth } from '../lib/auth';

const { Text } = Typography;

type Review = {
  id: number;
  report_id: number | null;
  question: string;
  horizon_days: number;
  valid_until: string;
  status: 'pending' | 'evaluating' | 'evaluated' | 'void';
  verdict?: string | null;
  rationale?: string | null;
  confidence?: string | null;
  attempts?: number;
  last_error?: string | null;
  evaluated_at?: string | null;
};

const VERDICT_LABEL: Record<string, string> = {
  baseline: '落在基准情景',
  upside: '落在上行情景',
  downside: '落在下行情景',
  invalidated: '失效条件已出现',
  void: '无法判定'
};

function statusOf(review: Review) {
  if (review.status === 'evaluated' || review.status === 'void') {
    return { text: VERDICT_LABEL[review.verdict || 'void'] || '无法判定', tone: review.verdict || 'void' };
  }
  if (review.status === 'evaluating') return { text: '回评中', tone: 'pending' };
  return { text: `待回评 · 到期 ${String(review.valid_until).slice(0, 10)}`, tone: 'pending' };
}

export default function Forecasts() {
  const navigate = useNavigate();
  const { user, currentOrg } = useAuth();
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canReview = Boolean(
    user?.is_system_admin || ['owner', 'admin'].includes(currentOrg?.my_role || currentOrg?.role || '')
  ) && !user?.is_demo;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await forecastReviewsApi.list({ limit: 50 });
      setItems(Array.isArray(r?.items) ? r.items : []);
      setTotal(Number(r?.total || 0));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runReview = async (review: Review) => {
    setBusyId(review.id);
    try {
      const r = await forecastReviewsApi.review(review.id);
      const verdict = r?.outcome?.verdict;
      message.success(verdict === 'void'
        ? '回评完成：证据不足，已记为无法判定'
        : `回评完成：${VERDICT_LABEL[verdict] || verdict}`);
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || '回评失败，已记录并等待重试');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const pending = items.filter(item => item.status === 'pending' || item.status === 'evaluating').length;
  const reviewed = items.filter(item => item.status === 'evaluated' && item.verdict && item.verdict !== 'void').length;
  const undecided = items.filter(item => item.verdict === 'void' || (item.status === 'void')).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <RiseOutlined />
            预测
          </h1>
          <div className="page-subtitle">
            共 {total} 条情景判断 · 到期后自动回看一次，判定落在哪一侧
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" onClick={() => navigate('/app')}>发起预测</Button>
        </Space>
      </div>

      <Space size={12} wrap style={{ marginBottom: 16 }}>
        <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
          <Text type="secondary" style={{ fontSize: 12 }}>待回评</Text>
          <div className="forecast-stat-value">{pending}</div>
        </Card>
        <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
          <Text type="secondary" style={{ fontSize: 12 }}>已判定</Text>
          <div className="forecast-stat-value">{reviewed}</div>
        </Card>
        <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
          <Text type="secondary" style={{ fontSize: 12 }}>无法判定</Text>
          <div className="forecast-stat-value">{undecided}</div>
        </Card>
      </Space>

      {loading && !items.length && (
        <Card><div style={{ padding: 48, textAlign: 'center' }}><Spin /></div></Card>
      )}

      {!loading && !items.length && (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
                <p style={{ marginBottom: 8 }}>
                  <Text strong>还没有情景判断。</Text>
                  预测不会被自动创建：只有在目标里明确要求「预测 / 未来 N 天 / 短期趋势」时，Agent 才会给出情景判断。
                </p>
                <p style={{ marginBottom: 8 }}>
                  例如：<Text code>研究最近 30 天美国手机配件市场的可核验变化，并对未来 30 天的选品机会给出基准、上行和下行情景。</Text>
                </p>
                <p style={{ marginBottom: 0, fontSize: 12, color: 'var(--v-text-2)' }}>
                  门槛与预测本身一致：至少两个独立来源、一份已核验原文，并写明前提、观察信号与失效条件；证据不足时不会给出情景，只说明无法预测。
                </p>
              </div>
            }
          >
            <Button type="primary" onClick={() => navigate('/app')}>去 Agent 发起</Button>
          </Empty>
        </Card>
      )}

      {items.map(review => {
        const status = statusOf(review);
        return (
          <Card key={review.id} style={{ marginBottom: 12 }} styles={{ body: { padding: 18 } }}>
            <div className="forecast-row-head">
              <span className={`forecast-verdict v-${status.tone}`}>{status.text}</span>
              <Text strong style={{ fontSize: 15, flex: 1 }}>{review.question}</Text>
              <Space size={6}>
                {review.report_id && (
                  <Link to={`/reports?open=${review.report_id}`} style={{ fontSize: 12 }}>查看报告 #{review.report_id}</Link>
                )}
                {review.status === 'pending' && canReview && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={busyId === review.id}
                    onClick={() => void runReview(review)}
                  >
                    立即回评
                  </Button>
                )}
              </Space>
            </div>
            {review.rationale && (
              <p className="forecast-row-body">{review.rationale}</p>
            )}
            <div className="forecast-row-meta">
              <span>视野 {review.horizon_days} 天</span>
              <span>到期 {String(review.valid_until).slice(0, 10)}</span>
              {review.evaluated_at && <span>回评于 {String(review.evaluated_at).slice(0, 10)}</span>}
              {review.confidence && <span>置信度 {review.confidence === 'medium' ? '中' : '低'}</span>}
              {review.attempts ? <span>已尝试 {review.attempts} 次</span> : null}
              {review.last_error && <span className="forecast-row-error">上次失败：{review.last_error}</span>}
              {!review.report_id && <Tag bordered={false}>报告已删除</Tag>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
