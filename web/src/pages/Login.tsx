/**
 * 登录页
 */

import { useEffect, useState } from 'react';
import { Form, Input, Button, Tabs, App as AntdApp, ConfigProvider } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { authApi } from '../api/auth';

export default function Login({ demoMode = false }: { demoMode?: boolean }) {
  const { login, register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntdApp.useApp();

  const defaultUsername = demoMode ? 'demo' : localStorage.getItem('vantage.lastUsername') || '';

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
      const from = demoMode ? '/dashboard' : (location.state as any)?.from || (location.pathname === '/login' ? '/app' : location.pathname);
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
      navigate('/app', { replace: true });
    } catch (err: any) {
      message.error(err.response?.data?.error || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfigProvider theme={{ token: {
      colorPrimary: '#3370ff',
      colorTextLightSolid: '#ffffff',
      colorText: document.documentElement.dataset.theme === 'dark' ? '#f2f3f6' : '#1f2329',
      colorTextSecondary: document.documentElement.dataset.theme === 'dark' ? '#a9adb7' : '#646a75',
      colorBgContainer: document.documentElement.dataset.theme === 'dark' ? '#202124' : '#ffffff',
      colorBgElevated: document.documentElement.dataset.theme === 'dark' ? '#292b30' : '#ffffff',
      colorBorder: document.documentElement.dataset.theme === 'dark' ? '#3b3e46' : '#dfe2e8',
      colorBorderSecondary: document.documentElement.dataset.theme === 'dark' ? '#303239' : '#eef0f3',
      borderRadius: 8,
    } }}>
      <div className="login-shell">
        <aside className="login-intro">
          <div className="login-product"><span className="login-product-mark">V</span><strong>Vantage</strong></div>
          <div className="login-intro-content">
            <h1>市场工作台</h1>
            <p>搜索 · 核验 · 监控</p>
            <div className="login-feature-list">
              <span>Agent <small>研究与执行</small></span>
              <span>报告 <small>来源与结论</small></span>
              <span>告警 <small>持续跟进</small></span>
            </div>
          </div>
          <span className="login-intro-footer">Vantage Workspace</span>
        </aside>
        <main className="login-main">
          <div className="login-panel">
            <span className="login-mobile-brand"><span className="login-product-mark">V</span> Vantage</span>
            <h2>{demoMode ? '进入演示工作区' : '登录 Vantage'}</h2>
            <p className="login-panel-note">{demoMode ? '使用只读账号查看真实界面' : '继续使用你的工作区'}</p>
            {demoMode && <div className="demo-login-note">账号 <strong>demo</strong> · 密码 <strong>demo</strong><br/>演示数据只读，不调用 AI、搜索或通知服务</div>}
            <Tabs
            defaultActiveKey="login"
            items={[
              {
                key: 'login',
                label: '登录',
                children: (
                  <Form layout="vertical" onFinish={onLogin} initialValues={{ username: defaultUsername, password: demoMode ? 'demo' : '' }}>
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
              ...(!demoMode && registrationEnabled ? [{
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
          </div>
        </main>
      </div>
    </ConfigProvider>
  );
}
