/**
 * 组织管理页
 * - 列出当前用户的组织
 * - 显示成员数量、监控项数量、机器人数量
 * - 创建新组织
 * - 切换组织
 */

import { useEffect, useState } from 'react';
import { Button, Modal, Form, Input, Typography, Tag, Empty, Spin, Popconfirm, App as AntdApp } from 'antd';
import { PlusOutlined, TeamOutlined, CheckCircleOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import { orgsApi } from '../api';
import { useAuth } from '../lib/auth';

const { Text } = Typography;

export default function Organization() {
  const { user, currentOrgId, switchOrg, refresh } = useAuth();
  const { message, modal } = AntdApp.useApp();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await orgsApi.list();
      setOrgs(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onCreate = async (values: any) => {
    try {
      await orgsApi.create(values);
      message.success('组织创建成功');
      setCreateOpen(false);
      form.resetFields();
      await refresh();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const onSuspend = async (id: number, name: string) => {
    modal.confirm({
      title: '暂停组织？',
      content: `暂停 "${name}" 后，所有成员将无法访问此组织。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await orgsApi.remove(id);
          message.success('已暂停');
          load();
        } catch (err: any) {
          message.error(err.response?.data?.error || '失败');
        }
      }
    });
  };

  return (
    <div>
      <div className="desk-management-head">
        <div>
          <Text type="secondary">共 {orgs.length} 个组织</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建组织
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : orgs.length === 0 ? (
        <Empty description="你还没加入任何组织" />
      ) : (
        <div className="desk-org-list">
          {orgs.map(org => <div className="desk-org-row" key={org.id}>
            <span className="desk-file-icon"><TeamOutlined /></span>
            <div className="desk-org-info">
              <strong>{org.name}</strong>
              <small>{org.member_count} 成员 · {org.watchlist_count} 监控 · {org.bot_count || 0} Bot</small>
            </div>
            <span className="desk-org-meta">{org.role} · {org.plan}</span>
            {org.status === 'active' ? <Tag icon={<CheckCircleOutlined />}>活跃</Tag> : <Tag icon={<StopOutlined />}>已暂停</Tag>}
            <div className="desk-org-actions">
              <Button size="small" icon={<SwapOutlined />} onClick={() => switchOrg(org.id)} disabled={org.id === currentOrgId}>{org.id === currentOrgId ? '当前' : '切换'}</Button>
              {org.role === 'owner' && org.id !== 1 && <Popconfirm title="暂停该组织？" onConfirm={() => onSuspend(org.id, org.name)}><Button size="small" danger icon={<StopOutlined />}>暂停</Button></Popconfirm>}
            </div>
          </div>)}
        </div>
      )}

      <Modal
        title="新建组织"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="创建"
      >
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="name" label="组织名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：跨境 3C 监控组" />
          </Form.Item>
          <Form.Item name="slug" label="Slug（可选）" extra="URL 标识，留空自动生成">
            <Input placeholder="如：crossborder-3c" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={3} placeholder="这个组织是做什么的？" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
