import { Component, type ReactNode } from 'react';
import { View } from '@tarojs/components';
import './index.scss';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: { componentStack: string }) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View className="error-boundary">
          <View className="error-boundary-icon">⚠</View>
          <View className="error-boundary-title">页面异常</View>
          <View className="error-boundary-desc">遇到了一些问题，请重试</View>
          <View className="error-boundary-action" onClick={this.handleRetry}>
            点击重试
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}
