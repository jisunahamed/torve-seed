import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  resetKey: string;
  onGoHome: () => void;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Isolates per-view React render errors so one tab fault never blanks the window. */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Torve Desktop] View render error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section
        role="alert"
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 28,
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <div
          style={{
            maxWidth: 460,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 22,
            display: 'grid',
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>This view encountered an unexpected error</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
            {this.state.error.message || 'Unknown UI error'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                border: 'none',
                background: '#d8ff0a',
                color: '#0a0a0a',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onGoHome();
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Back to Overview
            </button>
          </div>
        </div>
      </section>
    );
  }
}
