/**
 * 面包屑导航
 * - 根据当前路径自动生成
 * - 支持自定义
 */

import { Breadcrumb as AntBreadcrumb } from 'antd';
import { useLocation, Link } from 'react-router-dom';
import { HomeOutlined } from '@ant-design/icons';

const pathMeta: Record<string, { label: string; icon?: React.ReactNode }> = {
  '/dashboard': { label: '仪表盘' },
  '/watchlist': { label: '监控目标' },
  '/reports': { label: '情报报告' },
  '/agent': { label: 'Agent 工作台' },
  '/alerts': { label: '告警中心' },
  '/organization': { label: '组织管理' },
  '/members': { label: '成员' },
  '/bots': { label: '飞书 Bot' },
  '/routes': { label: '告警路由' },
  '/settings': { label: '系统设置' },
  '/help': { label: '帮助' },
  '/about': { label: '关于' }
};

export function Breadcrumb() {
  const location = useLocation();
  const path = location.pathname;

  // 匹配最长的前缀
  const matched = Object.keys(pathMeta)
    .filter(p => path === p || path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];

  if (!matched) return null;

  return (
    <AntBreadcrumb
      style={{ marginBottom: 12, fontSize: 12 }}
      items={[
        {
          title: (
            <Link to="/dashboard">
              <HomeOutlined style={{ marginRight: 4 }} />
              首页
            </Link>
          )
        },
        {
          title: pathMeta[matched].label
        }
      ]}
    />
  );
}
