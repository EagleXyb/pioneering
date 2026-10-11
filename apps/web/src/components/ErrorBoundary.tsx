/**
 * 全局错误边界 — 捕获子组件渲染异常，避免白屏
 */
import React from 'react';
import { EmptyStateGlyph } from './icons/emptyStateGlyph';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">
            <EmptyStateGlyph variant="error" />
          </div>
          <div className="error-boundary-title">页面出错了</div>
          <div className="error-boundary-desc">
            {this.state.error?.message || '发生未知错误，请稍后重试。'}
          </div>
          <button className="error-boundary-btn" onClick={this.handleReset}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
