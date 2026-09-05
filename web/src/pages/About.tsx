/**
 * 关于页面
 */

import { Card, Typography, Space, Tag, Row, Col, Descriptions, Button, App as AntdApp } from 'antd';
import {
  GithubOutlined, BookOutlined, BulbOutlined, RocketOutlined,
  ThunderboltOutlined, AimOutlined, CheckCircleOutlined
} from '@ant-design/icons';
import { dashboardApi } from '../api';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '../version';

const { Title, Text, Paragraph } = Typography;

const features = [
  { icon: <RocketOutlined />, title: '自动化采集', desc: '多源搜索引擎 + AI 摘要，7×24 不间断监控跨境动态' },
  { icon: <AimOutlined />, title: '智能路由', desc: '按等级/类目/标签的精细路由，让对的告警发到对的群' },
  { icon: <ThunderboltOutlined />, title: '进程内缓存', desc: '内存 LRU + TTL 缓存，减少重复 AI 与外部 API 调用' },
  { icon: <CheckCircleOutlined />, title: '可观测性', desc: '访问日志 / 慢查询 / Metrics 端点，问题一目了然' }
];

const changelog = [
  { version: `v${APP_VERSION}`, date: '2026-09-05', items: ['Agent-first 成为默认业务入口，并保留经典版切换', '统一黑白米色视觉系统', '持久 Agent 队列、质量评测、页面拆包与移动端适配'] },
  { version: 'v2.3.0', date: '2026-08-07', items: ['GitHub Pages 部署 + 自定义域名 (vantage.shengxia.me)', 'Demo 模式：HashRouter + Mock 适配器，在线免部署体验', '修复 Dashboard 空白问题（mock 数据结构对齐后端 API）', '前端防御性检查 + Quickstart 支持 Demo 访问'] },
  { version: 'v2.2.0', date: '2026-08-06', items: ['UI/UX 大幅升级：菜单 3 组分类 + Sider 折叠 + 面包屑导航', '快捷键支持：Ctrl+K 搜索 / ? 帮助面板 / 数字键导航', '通知中心：顶栏告警 Badge + 下拉列表', '微交互：数字 CountUp 动画 / 按钮 hover 缩放 / 响应式自适应'] },
  { version: 'v2.1.0', date: '2026-06-04', items: ['统一错误处理 + Request ID', 'AI 摘要二级缓存', 'Metrics 监控端点', 'LRU 包装 bug 修复'] },
  { version: 'v2.0.0', date: '2026-06-04', items: ['多租户架构（组织/用户/角色）', 'JWT 认证', '飞书 Bot 管理', '告警路由引擎', '设置三级作用域'] },
  { version: 'v1.0.0', date: '2026-06-04', items: ['监控目标 CRUD', 'Tavily 采集', 'AI 摘要 (DeepSeek)', '飞书推送', 'Web Dashboard'] }
];

export default function About() {
  const [health, setHealth] = useState<any>(null);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    dashboardApi.health().then(setHealth).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Hero */}
      <Card style={{ marginBottom: 16, background: 'var(--v-accent)', color: 'var(--v-on-accent)', border: '1px solid var(--v-border)' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <img
              src="/vantage-logo-white.png"
              width={56}
              height={56}
              alt="Vantage"
              className="accent-logo-light"
              style={{ objectFit: 'contain', marginBottom: 12 }}
            />
            <img
              src="/vantage-logo.png"
              width={56}
              height={56}
              alt="Vantage"
              className="accent-logo-dark"
              style={{ objectFit: 'contain', marginBottom: 12 }}
            />
            <Tag style={{ background: 'var(--v-focus)', color: 'var(--v-on-accent)', border: 0 }}>v{APP_VERSION}</Tag>
            <Title level={2} style={{ color: 'var(--v-on-accent)', margin: '8px 0 4px' }}>Vantage · 跨境瞭望台</Title>
            <Text style={{ color: 'var(--v-on-accent)', opacity: 0.78, fontSize: 15 }}>
              Stay ahead of every market, before the market moves.
            </Text>
          </div>
          <Space wrap>
            <Button icon={<BookOutlined />} href="https://vantage.shengxia.me/QUICKSTART.html" target="_blank">快速上手</Button>
            <Button icon={<GithubOutlined />} href="https://github.com/panda-lsy/Vantage-Hackathon" target="_blank">源代码</Button>
            <Button icon={<BulbOutlined />} href="https://github.com/panda-lsy/Vantage-Hackathon/issues" target="_blank">问题反馈</Button>
          </Space>
        </Space>
      </Card>

      {/* 系统健康 */}
      {health && (
        <Card title="系统健康" size="small" style={{ marginBottom: 16 }}>
          <Space size="large" wrap>
            {Object.entries(health.checks || health).map(([k, v]) => (
              <Space key={k}>
                <span style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: ['ok', 'memory'].includes(String(v)) ? 'var(--v-ok)' : 'var(--v-risk)',
                  display: 'inline-block'
                }} />
                <Text>{k}</Text>
                <Tag color={['ok', 'memory'].includes(String(v)) ? 'default' : 'error'}>{String(v)}</Tag>
              </Space>
            ))}
          </Space>
        </Card>
      )}

      {/* 核心特性 */}
      <Card title="核心特性" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          {features.map((f, i) => (
            <Col span={12} key={i}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ fontSize: 24, color: 'var(--v-text-2)' }}>{f.icon}</div>
                <div>
                  <Text strong>{f.title}</Text>
                  <div><Text type="secondary" style={{ fontSize: 12 }}>{f.desc}</Text></div>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 系统信息 */}
      <Card title="系统信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="版本">v{APP_VERSION}</Descriptions.Item>
          <Descriptions.Item label="后端">Node.js + Express 5</Descriptions.Item>
          <Descriptions.Item label="前端">React 18 + Vite 5 + Antd 5</Descriptions.Item>
          <Descriptions.Item label="数据库">SQLite（单文件）</Descriptions.Item>
          <Descriptions.Item label="缓存">进程内 LRU + TTL</Descriptions.Item>
          <Descriptions.Item label="AI">自定义 OpenAI-compatible / 百炼 / DeepSeek / MiniMax（设置页可配置）</Descriptions.Item>
          <Descriptions.Item label="采集">Tavily API</Descriptions.Item>
          <Descriptions.Item label="推送">飞书 Webhook (卡片 + 文本)</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 更新日志 */}
      <Card title="更新日志" size="small">
        {changelog.map(c => (
          <div key={c.version} style={{ marginBottom: 16 }}>
            <Space>
              <Tag>{c.version}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{c.date}</Text>
            </Space>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {c.items.map((item, i) => (
                <li key={i}><Text style={{ fontSize: 13 }}>{item}</Text></li>
              ))}
            </ul>
          </div>
        ))}
      </Card>

      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--v-text-3)', fontSize: 12 }}>
        Built by <Text strong>Freak</Text> · Powered by <Text strong>Hina 🍃</Text>
      </div>
    </div>
  );
}
