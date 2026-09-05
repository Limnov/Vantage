/**
 * 成员管理页
 */

import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, Avatar, Typography, App as AntdApp, Popconfirm, Tabs } from 'antd';
import { UserAddOutlined, UserOutlined, SearchOutlined, CrownOutlined } from '@ant-design/icons';
import { membersApi } from '../api';
import { useAuth } from '../lib/auth';

const { Title, Text } = Typography;

export default function Members() {
  const { currentOrgId, currentOrg, user: me } = useAuth();
  const { message } = AntdApp.useApp();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm();
  const [tab, setTab] = useState('invite');
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const load = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      const r = await membersApi.list(currentOrgId);
      setMembers(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentOrgId]);

  const onInvite = async (values: any) => {
    try {
      if (tab === 'existing') {
        await membersApi.add(currentOrgId, values.userId, values.role);
      } else {
        await membersApi.inviteAndCreate({ ...values, orgId: currentOrgId });
      }
      message.success('已添加');
      setAddOpen(false);
      form.resetFields();
      setUserResults([]);
      setUserSearch('');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '失败');
    }
  };

  const onChangeRole = async (id: number, role: string) => {
    await membersApi.update(id, { role });
    message.success('已更新');
    load();
  };

  const onRemove = async (id: number) => {
    await membersApi.remove(id);
    message.success('已移除');
    load();
  };

  const searchUsers = async (q: string) => {
    setUserSearch(q);
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await membersApi.searchUsers(q);
      setUserResults(r.items || []);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>成员管理</Title>
          <Text type="secondary">当前组织：<Text strong>{currentOrg?.name || '-'}</Text> · 共 {members.length} 人</Text>
        </div>
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>
          添加成员
        </Button>
      </div>

      <Card>
        <Table
          dataSource={members}
          rowKey="id"
          loading={loading}
          pagination={false}
          columns={[
            {
              title: '成员',
              render: (_, r: any) => (
                <Space>
                  <Avatar src={r.avatar_url} icon={<UserOutlined />} />
                  <div>
                    <div>
                      <Text strong>{r.display_name || r.username}</Text>
                      {r.id === me?.id && <Tag style={{ marginLeft: 8 }}>我</Tag>}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>@{r.username} · {r.email}</Text>
                  </div>
                </Space>
              )
            },
            {
              title: '角色',
              dataIndex: 'role',
              render: (v, r: any) => (
                <Select
                  value={v}
                  style={{ width: 120 }}
                  disabled={v === 'owner' || r.user_id === me?.id}
                  onChange={(nv) => onChangeRole(r.id, nv)}
                  options={[
                    { value: 'admin', label: <span><CrownOutlined /> Admin</span> },
                    { value: 'member', label: 'Member' },
                    { value: 'viewer', label: 'Viewer' }
                  ]}
                />
              )
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (v) => v === 'active' ? <Tag>活跃</Tag> : <Tag>{v}</Tag>
            },
            {
              title: '加入时间',
              dataIndex: 'joined_at',
              render: (v) => new Date(v).toLocaleDateString('zh-CN')
            },
            {
              title: '操作',
              render: (_, r: any) => (
                r.role !== 'owner' && r.user_id !== me?.id ? (
                  <Popconfirm title="移除该成员？" onConfirm={() => onRemove(r.id)}>
                    <Button size="small" danger>移除</Button>
                  </Popconfirm>
                ) : <Text type="secondary">-</Text>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title="添加成员"
        open={addOpen}
        onCancel={() => { setAddOpen(false); form.resetFields(); setUserResults([]); setUserSearch(''); }}
        onOk={() => form.submit()}
        width={600}
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'invite',
              label: '邀请新用户',
              children: (
                <Form form={form} layout="vertical" onFinish={onInvite} initialValues={{ role: 'member' }}>
                  <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}>
                    <Input placeholder="3-50 字符" />
                  </Form.Item>
                  <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
                    <Input placeholder="you@example.com" />
                  </Form.Item>
                  <Form.Item name="display_name" label="昵称">
                    <Input placeholder="可选" />
                  </Form.Item>
                  <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6 }]}>
                    <Input.Password placeholder="至少 6 位" />
                  </Form.Item>
                  <Form.Item name="role" label="角色">
                    <Select>
                      <Select.Option value="admin">Admin</Select.Option>
                      <Select.Option value="member">Member</Select.Option>
                      <Select.Option value="viewer">Viewer</Select.Option>
                    </Select>
                  </Form.Item>
                </Form>
              )
            },
            {
              key: 'existing',
              label: '添加已有用户',
              children: (
                <Form form={form} layout="vertical" onFinish={onInvite} initialValues={{ role: 'member' }}>
                  <Form.Item label="搜索用户" extra="输入用户名/邮箱/昵称搜索">
                    <Input
                      prefix={<SearchOutlined />}
                      placeholder="搜索..."
                      value={userSearch}
                      onChange={e => searchUsers(e.target.value)}
                    />
                  </Form.Item>
                  {userResults.length > 0 && (
                    <Form.Item name="userId" label="选择用户" rules={[{ required: true, message: '请选择用户' }]}>
                      <Select placeholder="选择用户">
                        {userResults.map(u => (
                          <Select.Option key={u.id} value={u.id}>
                            {u.display_name || u.username} ({u.email})
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  )}
                  <Form.Item name="role" label="角色">
                    <Select>
                      <Select.Option value="admin">Admin</Select.Option>
                      <Select.Option value="member">Member</Select.Option>
                      <Select.Option value="viewer">Viewer</Select.Option>
                    </Select>
                  </Form.Item>
                </Form>
              )
            }
          ]}
        />
      </Modal>
    </div>
  );
}
