"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-lg font-semibold text-neutral-800">Something went wrong</h1>
          <p className="max-w-md text-sm text-neutral-500">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
