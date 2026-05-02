import React, { Component, ReactNode, ErrorInfo } from 'react';
import { messagesZh } from '../i18n/messages-zh';
import { messagesEn } from '../i18n/messages-en';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ErrorBoundary 不能用 hooks(class component),也不能假设 I18nProvider 一定在外层(它在外面,
// 但出错时 Provider 可能没渲染)。直接读 localStorage 选语言,fallback 到 zh
function pickTable(): Record<string, string> {
  try {
    const lang = window.localStorage.getItem('viewer-lang');
    return lang === 'en' ? messagesEn : messagesZh;
  } catch {
    return messagesZh;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      const tbl = pickTable();
      return (
        <div style={{ padding: '20px', color: '#ff6b6b', backgroundColor: '#1a1a1a', minHeight: '100vh' }}>
          <h1 style={{ fontSize: '24px', marginBottom: '10px' }}>{tbl['error.title']}</h1>
          <p style={{ marginBottom: '10px', color: '#8b949e' }}>
            {tbl['error.body']}
          </p>
          {this.state.error && (
            <details style={{ marginTop: '20px', color: '#8b949e' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>{tbl['error.details']}</summary>
              <pre style={{
                backgroundColor: '#0d1117',
                padding: '10px',
                borderRadius: '6px',
                overflow: 'auto'
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo && '\n\n' + this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
