/**
 * 错误边界
 * - 捕获子组件渲染错误
 * - 显示友好降级 UI
 * - 上报日志
 */

import React from 'react';
import { Result, Button, Typography } from 'antd';

const { Paragraph, Text } = Typography;

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return <>{this.props.fallback}</>;

      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={
            <div>
              <Paragraph style={{ marginBottom: 4 }}>
                <Text type="secondary">{this.state.error?.message || '未知错误'}</Text>
              </Paragraph>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                尝试刷新页面，或联系管理员
              </Paragraph>
            </div>
          }
          extra={[
            <Button key="reset" onClick={this.reset}>重试</Button>,
            <Button key="reload" type="primary" onClick={() => window.location.reload()}>刷新页面</Button>
          ]}
        />
      );
    }
    return this.props.children;
  }
}
