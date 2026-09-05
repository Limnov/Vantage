/**
 * 登录页
 */

import { useEffect, useState } from 'react';
import { Form, Input, Button, Card, Typography, Space, Tabs, App as AntdApp } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { authApi } from '../api/auth';

const { Title, Text } = Typography;

export default function Login() {
  const { login, register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntdApp.useApp();

  const defaultUsername = localStorage.getItem('vantage.lastUsername') || '';

  useEffect(() => {
    authApi.registration()
      .then(({ enabled }) => setRegistrationEnabled(enabled))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  const onLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      localStorage.setItem('vantage.lastUsername', values.username);
      message.success('登录成功');
      const from = (location.state as any)?.from || '/';
      navigate(from, { replace: true });
    } catch (err: any) {
      message.error(err.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (values: any) => {
    setLoading(true);
    try {
      await register(values);
      message.success('注册成功，已自动创建组织');
      navigate('/', { replace: true });
    } catch (err: any) {
      message.error(err.response?.data?.error || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <Card className="login-card">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="login-brand-lockup">
            <img
              src="/vantage-logo.png"
              width={72}
              height={72}
              alt="Vantage"
              className="brand-logo-light"
              style={{ display: 'block', objectFit: 'contain', margin: '0 auto 12px' }}
            />
            <img
              src="/vantage-logo-white.png"
              width={72}
              height={72}
              alt="Vantage"
              className="brand-logo-dark"
              style={{ display: 'block', objectFit: 'contain', margin: '0 auto 12px' }}
            />
            <Title level={3} style={{ margin: 0 }}>Vantage</Title>
            <Text type="secondary">情报与行动 · Agent 工作台</Text>
          </div>

          <Tabs
            defaultActiveKey="login"
            centered
            items={[
              {
                key: 'login',
                label: '登录',
                children: (
                  <Form layout="vertical" onFinish={onLogin} initialValues={{ username: defaultUsername }}>
                    <Form.Item name="username" label="用户名 / 邮箱" rules={[{ required: true, message: '请输入用户名' }]}>
                      <Input prefix={<UserOutlined />} placeholder="admin" size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                      <Input.Password prefix={<LockOutlined />} placeholder="••••••" size="large" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button type="primary" htmlType="submit" loading={loading} block size="large">
                        登录
                      </Button>
                    </Form.Item>
                  </Form>
                )
              },
              ...(registrationEnabled ? [{
                key: 'register',
                label: '注册',
                children: (
                  <Form layout="vertical" onFinish={onRegister}>
                    <Form.Item name="username" label="用户名" rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, message: '至少 3 个字符' }
                    ]}>
                      <Input prefix={<UserOutlined />} placeholder="3-50 字符" size="large" />
                    </Form.Item>
                    <Form.Item name="display_name" label="昵称（可选）">
                      <Input placeholder="你的显示名" size="large" />
                    </Form.Item>
                    <Form.Item name="email" label="邮箱" rules={[
                      { required: true, message: '请输入邮箱' },
                      { type: 'email', message: '邮箱格式不正确' }
                    ]}>
                      <Input prefix={<MailOutlined />} placeholder="you@example.com" size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[
                      { required: true, message: '请输入密码' },
                      { min: 12, message: '至少 12 个字符' }
                    ]}>
                      <Input.Password prefix={<LockOutlined />} placeholder="至少 12 位" size="large" />
                    </Form.Item>
                    <Form.Item name="orgName" label="组织名（可选）" extra="留空将自动生成">
                      <Input placeholder="我的工作空间" size="large" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button type="primary" htmlType="submit" loading={loading} block size="large">
                        创建账号
                      </Button>
                    </Form.Item>
                  </Form>
                )
              }] : [])
            ]}
          />

          </Space>
      </Card>
    </div>
  );
}
