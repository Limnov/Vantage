import { useEffect, useState } from 'react';
import { ArrowRightOutlined, CheckCircleOutlined, ExclamationCircleOutlined, GithubOutlined } from '@ant-design/icons';
import { dashboardApi } from '../api';
import { APP_VERSION } from '../version';

const repositoryUrl = 'https://github.com/Limnov/Vantage';
const cloud = import.meta.env.VITE_PLATFORM === 'cloudflare';

export default function About() {
  const [health, setHealth] = useState<{ status?: string } | null>(null);

  useEffect(() => {
    dashboardApi.health().then(setHealth).catch(() => setHealth({ status: 'unknown' }));
  }, []);

  const capabilities = [
    ['Agent', '研究市场、管理监控和处理告警'],
    ['搜索与核验', '检索公开信息并记录来源'],
    ['报告', '保存结论、证据和历史记录'],
    ['通知', '经人工批准后发送飞书通知'],
  ];

  return (
    <div className="desk-about">
      <div className="desk-about-identity">
        <span className="desk-about-logo">V</span>
        <div><h2>Vantage</h2><p>市场情报工作台</p></div>
        <span className="desk-about-version">v{APP_VERSION}</span>
      </div>

      <section className="desk-about-section">
        <h3>产品能力</h3>
        <div className="desk-about-list">
          {capabilities.map(([title, detail]) => <div className="desk-about-row" key={title}><strong>{title}</strong><span>{detail}</span></div>)}
        </div>
      </section>

      <section className="desk-about-section">
        <h3>系统</h3>
        <div className="desk-about-list">
          <div className="desk-about-row"><strong>运行状态</strong><span className={health?.status === 'ok' ? 'is-healthy' : ''}>{health?.status === 'ok' ? <><CheckCircleOutlined /> 正常</> : health ? <><ExclamationCircleOutlined /> 请检查服务</> : '检查中'}</span></div>
          <div className="desk-about-row"><strong>部署平台</strong><span>{cloud ? 'Cloudflare' : 'Node.js'}</span></div>
          <div className="desk-about-row"><strong>版本</strong><span>v{APP_VERSION}</span></div>
        </div>
      </section>

      <section className="desk-about-section">
        <h3>项目</h3>
        <div className="desk-about-list">
          <a className="desk-about-row" href={repositoryUrl} target="_blank" rel="noreferrer"><strong><GithubOutlined /> 源代码</strong><ArrowRightOutlined /></a>
          <a className="desk-about-row" href={`${repositoryUrl}#快速开始`} target="_blank" rel="noreferrer"><strong>快速开始</strong><ArrowRightOutlined /></a>
          <a className="desk-about-row" href={`${repositoryUrl}/issues`} target="_blank" rel="noreferrer"><strong>问题反馈</strong><ArrowRightOutlined /></a>
        </div>
      </section>
    </div>
  );
}
