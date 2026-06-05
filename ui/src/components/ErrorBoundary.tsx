// ui/src/components/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconAlert } from "./icons";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Top-level error boundary so a render crash shows a recoverable panel. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Castor UI render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center-fill" style={{ minHeight: "60vh" }}>
          <span style={{ color: "var(--danger)" }}>
            <IconAlert size={36} />
          </span>
          <div className="empty-title" style={{ color: "var(--text-primary)" }}>
            Something went wrong
          </div>
          <div className="empty-msg" style={{ maxWidth: 480 }}>
            {this.state.error.message}
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
