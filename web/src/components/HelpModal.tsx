/**
 * 帮助/快捷键面板
 */

import { Modal, Typography, Tag, Space, Divider } from 'antd';
import {
  KeyOutlined, QuestionCircleOutlined,
  BulbOutlined, ApiOutlined, BellOutlined, EyeOutlined
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const shortcutGroups = [
  {
    title: '全局',
    icon: <KeyOutlined />,
    items: [
      { keys: ['⌘', 'K'], desc: '打开全局搜索' },
      { keys: ['?'], desc: '打开本帮助' },
      { keys: ['Esc'], desc: '关闭弹窗/抽屉' },
      { keys: ['G'], desc: '然后 D / W / R / A：跳到仪表盘/监控/报告/告警' }
    ]
  },
  {
    title: '导航',
    icon: <EyeOutlined />,
    items: [
      { keys: ['1'], desc: '仪表盘' },
      { keys: ['2'], desc: '监控目标' },
      { keys: ['3'], desc: '情报报告' },
      { keys: ['4'], desc: '告警中心' }
    ]
  }
];

const tips = [
  {
    icon: <BulbOutlined />,
    title: '用好组织隔离',
    desc: '不同组织的数据完全隔离。顶栏可随时切换当前组织。'
  },
  {
    icon: <ApiOutlined />,
    title: '配置告警路由',
    desc: '在「告警路由」中配置规则，让不同等级的告警发到不同的飞书群。'
  },
  {
    icon: <BellOutlined />,
    title: '关键词告警',
    desc: '在监控目标里设置「告警关键词」，命中时会触发 critical 告警。'
  }
];

export function HelpModal({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      title={<Space><QuestionCircleOutlined /> 帮助 & 快捷键</Space>}
    >
      <div style={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 8 }}>
        {shortcutGroups.map(group => (
          <div key={group.title} style={{ marginBottom: 20 }}>
            <Title level={5} style={{ marginBottom: 10 }}>
              <Space>{group.icon}{group.title}</Space>
            </Title>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {group.items.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', background: 'var(--ant-color-fill-tertiary)', borderRadius: 6 }}>
                  <Space size={4}>
                    {s.keys.map((k, ki) => (
                      <Tag key={ki} color="default" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, margin: 0, padding: '1px 6px' }}>
                        {k}
                      </Tag>
                    ))}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>{s.desc}</Text>
                </div>
              ))}
            </div>
          </div>
        ))}

        <Divider />

        <Title level={5} style={{ marginBottom: 12 }}>
          <Space><BulbOutlined />使用技巧</Space>
        </Title>
        {tips.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
            <div style={{ fontSize: 18, marginTop: 2 }}>{t.icon}</div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 13 }}>{t.title}</Text>
              <div><Text type="secondary" style={{ fontSize: 12 }}>{t.desc}</Text></div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
