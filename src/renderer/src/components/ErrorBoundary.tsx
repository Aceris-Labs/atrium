import { Component, type ReactNode } from "react";
import { toast } from "./Toast";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    toast().error(error.message || "Something went wrong");
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-fg">
            <div className="text-lg font-semibold">Something went wrong</div>
            <div className="text-sm text-fg-muted max-w-[480px] text-center whitespace-pre-wrap">
              {this.state.error.message}
            </div>
            <button
              type="button"
              className="mt-2 px-3 py-1 rounded-md border border-line hover:bg-bg-card-hover text-sm"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
