/**
 * 统一空状态组件
 */

import { Empty, Typography, Button, Space } from 'antd';
import { InboxOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: {
    text: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  onRefresh?: () => void;
  size?: 'small' | 'default' | 'large';
}

export function EmptyState({
  icon = <InboxOutlined />,
  title = '暂无数据',
  description,
  action,
  onRefresh,
  size = 'default'
}: Props) {
  const padding = size === 'small' ? 32 : size === 'large' ? 80 : 48;
  return (
    <div style={{ padding, textAlign: 'center' }}>
      <div style={{ fontSize: size === 'small' ? 32 : 48, color: 'var(--v-text-3)', marginBottom: 12 }}>
        {icon}
      </div>
      <Text strong style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>{title}</Text>
      {description && <Text type="secondary" style={{ fontSize: 12 }}>{description}</Text>}
      {(action || onRefresh) && (
        <div style={{ marginTop: 16 }}>
          <Space>
            {action && (
              <Button type="primary" icon={action.icon || <PlusOutlined />} onClick={action.onClick}>
                {action.text}
              </Button>
            )}
            {onRefresh && (
              <Button icon={<ReloadOutlined />} onClick={onRefresh}>刷新</Button>
            )}
          </Space>
        </div>
      )}
    </div>
  );
}
