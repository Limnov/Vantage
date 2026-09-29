import { useAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { Card, Tag, Space, Typography, Button, Drawer, Skeleton, Empty, Row, Col, Pagination, Spin } from 'antd';
import {
  EyeOutlined, SendOutlined, FileTextOutlined,
  ArrowRightOutlined,
  LinkOutlined, AimOutlined, MessageOutlined, ClockCircleOutlined, ApiOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { reportsApi } from '../api';
import ForecastCard from '../components/ForecastCard';

const { Title, Paragraph, Text } = Typography;

const signalMeta: Record<string, { color: string; text: string; icon: any }> = {
  opportunity: { color: 'var(--v-ok)', text: '机会', icon: null },
  neutral: { color: 'var(--v-info)', text: '中性', icon: null },
  risk: { color: 'var(--v-risk)', text: '风险', icon: null }
};

const sentimentMeta: Record<string, { color: string; text: string }> = {
  positive: { color: 'var(--v-ok)', text: '正面' },
  neutral: { color: 'default', text: '中性' },
  negative: { color: 'var(--v-risk)', text: '负面' }
};

export default function Reports() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterSignal, setFilterSignal] = useState<string | undefined>();
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (filterSignal) params.signal = filterSignal;
      const r = await reportsApi.list(params);
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, filterSignal]);

  const onShowDetail = async (id: number) => {
    setDetail({ loading: true });
    setDetailLoading(true);
    try {
      const r = await reportsApi.get(id);
      setDetail(r);
    } finally {
      setDetailLoading(false);
    }
  };

  const onPush = async (id: number) => {
    const r = await reportsApi.push(id);
    if (r.ok) {
      // @ts-ignore
      window.message?.success('已推送到飞书');
    } else {
      // @ts-ignore
      window.message?.error(r.error || '推送失败');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <FileTextOutlined />
            情报报告
          </h1>
          <div className="page-subtitle">共 {total} 份报告 · AI 提炼的跨境市场洞察</div>
        </div>
      </div>

      <Card style={{ marginBottom: 16, borderRadius: 8 }} styles={{ body: { padding: 12 } }}>
        <Space wrap>
          <Text type="secondary">信号筛选：</Text>
          <Tag.CheckableTag checked={!filterSignal} onChange={() => setFilterSignal(undefined)}>全部</Tag.CheckableTag>
          {Object.entries(signalMeta).map(([k, v]) => (
            <Tag.CheckableTag
              key={k}
              checked={filterSignal === k}
              onChange={(checked) => setFilterSignal(checked ? k : undefined)}
            >
              <Space size={4}>
                {v.icon}
                <span>{v.text}</span>
              </Space>
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {loading && !items.length ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>
      ) : !items.length ? (
        <Card><Empty description="暂无报告" style={{ padding: 40 }} /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((r: any) => (
            <Col xs={24} sm={12} xl={8} key={r.id}>
              <Card className="report-card-item" styles={{ body: { padding: 18 } }} onClick={() => onShowDetail(r.id)}>
                <div className="report-card-item-head">
                  <span className={`signal-tag ${r.signal_type}`}>{signalMeta[r.signal_type]?.text || r.signal_type}</span>
                  <span className={`signal-tag ${r.sentiment === 'positive' ? 'opportunity' : r.sentiment === 'negative' ? 'risk' : 'neutral'}`}>
                    {sentimentMeta[r.sentiment]?.text || r.sentiment}
                  </span>
                  {r.agent_run_id && <Tag bordered={false} icon={<ApiOutlined />}>Agent</Tag>}
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {dayjs(r.created_at).format('MM-DD HH:mm')}
                  </Text>
                </div>
                <div className="report-card-item-title">{r.title}</div>
                <Paragraph ellipsis={{ rows: 3 }} className="report-card-item-summary">{r.summary}</Paragraph>
                <div className="report-card-item-foot">
                  <Text type="secondary" style={{ fontSize: 11 }}>#{r.id}</Text>
                  <Space size={4}>
                    <Button size="small" type="text" icon={<EyeOutlined />} onClick={(e) => { e.stopPropagation(); onShowDetail(r.id); }}>查看</Button>
                    <Button size="small" type="text" disabled={user?.is_demo} icon={<SendOutlined />} onClick={(e) => { e.stopPropagation(); onPush(r.id); }}>推送</Button>
                  </Space>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        />
      </div>

      <Drawer
        title={null}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={760}
        styles={{ body: { padding: 0, background: 'var(--ant-color-bg-layout)' } }}
        headerStyle={{ display: 'none' }}
      >
        {detailLoading || !detail || detail.loading ? (
          <div style={{ padding: 32 }}>
            <Skeleton active paragraph={{ rows: 1 }} />
            <Skeleton active style={{ marginTop: 24 }} />
            <Skeleton active paragraph={{ rows: 6 }} style={{ marginTop: 24 }} />
          </div>
        ) : (
          <ReportDetail report={detail} />
        )}
      </Drawer>
    </div>
  );
}

function ReportDetail({ report }: { report: any }) {
  const sigMeta = signalMeta[report.signal_type] || signalMeta.neutral;
  const sentMeta = sentimentMeta[report.sentiment] || sentimentMeta.neutral;

  return (
    <div style={{ padding: 24 }}>
      {/* Hero */}
      <div className={`report-hero ${report.signal_type}`}>
        <Space size="small" style={{ marginBottom: 12 }}>
          <span className={`signal-tag ${report.signal_type}`}>
            {sigMeta.icon}{sigMeta.text}
          </span>
          <Tag>{sentMeta.text}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ClockCircleOutlined /> {dayjs(report.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </Text>
        </Space>
        <h1 className="hero-title">{report.title}</h1>
        <p className="hero-summary">{report.summary}</p>
      </div>

      {/* 元数据 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="large">
          {report.agent_run_id && (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>Agent 任务</Text>
              <div><Text code style={{ fontSize: 12 }}>{report.agent_run_id}</Text></div>
            </div>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>查询关键词</Text>
            <div><Text code style={{ fontSize: 12 }}>{report.query}</Text></div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>报告日期</Text>
            <div><Text style={{ fontSize: 12 }}>{report.report_date}</Text></div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>处理耗时</Text>
            <div><Text style={{ fontSize: 12 }}>{(report.duration_ms / 1000).toFixed(1)}s</Text></div>
          </div>
        </Space>
      </Card>

      {/* 关键洞察 */}
      {report.key_points?.length > 0 && (
        <Card
          size="small"
          title={<Space><AimOutlined /><span>关键洞察</span></Space>}
          style={{ marginBottom: 16 }}
          styles={{ body: { padding: '8px 16px' } }}
        >
          {report.key_points.map((p: string, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < report.key_points.length - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none' }}>
              <span style={{
                minWidth: 22, height: 22, borderRadius: 11,
                background: 'var(--v-text)', color: 'var(--v-surface)',
                fontSize: 11, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
              }}>{i + 1}</span>
              <Text style={{ flex: 1, lineHeight: 1.7 }}>{p}</Text>
            </div>
          ))}
        </Card>
      )}

      {/* AI 简短回答 */}
      {report.raw_data?.answer && (
        <Card
          size="small"
          title={<Space><MessageOutlined /><span>AI 简短回答</span></Space>}
          style={{ marginBottom: 16 }}
        >
          <Paragraph style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {report.raw_data.answer}
          </Paragraph>
        </Card>
      )}

      <ForecastCard forecast={report.raw_data?.forecast} evidence={report.raw_data?.evidence} review={report.forecast_review} />

      {/* 来源 */}
      <Card
        size="small"
        title={<Space><LinkOutlined /><span>信息来源（{report.sources?.length || 0}）</span></Space>}
        styles={{ body: { padding: '8px 16px' } }}
      >
        {(report.sources || []).map((s: any, i: number) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: i < (report.sources?.length || 0) - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none' }}>
            <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>
              <ArrowRightOutlined /> {s.title || s.url}
            </a>
            <div>
              <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>{s.url}</Text>
            </div>
            {s.publishedDate && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                <ClockCircleOutlined /> {s.publishedDate}
              </Text>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
