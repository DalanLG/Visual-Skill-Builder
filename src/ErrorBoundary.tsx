import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 'var(--z-error)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-24)',
          color: 'var(--text)',
          background: 'var(--bg-base)',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-muted)', marginTop: 0 }}>Something went wrong</h1>
            <pre className="font-mono" style={{
              background: 'var(--bg-input)',
              padding: 'var(--space-16)',
              borderRadius: 'var(--radius-btn)',
              overflow: 'auto',
              fontSize: 12,
              color: 'var(--text)',
            }}>
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
              style={{ marginTop: 'var(--space-16)' }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

