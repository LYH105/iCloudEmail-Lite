import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppIcon } from './AppIcon';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Last-resort UI for unexpected render errors; request errors stay inline. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unexpected interface error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-screen" role="alert">
        <div className="fatal-icon">
          <AppIcon name="alert" size={26} />
        </div>
        <span className="panel-kicker">界面遇到问题</span>
        <h1>这次操作没有完成</h1>
        <p>{this.state.error.message || '发生了未预期的界面错误。'}</p>
        <button className="btn btn-filled" onClick={() => window.location.reload()}>
          重新加载应用
        </button>
      </div>
    );
  }
}
