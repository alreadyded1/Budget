import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode; resetKey: string }
type State = { error: Error | null; resetKey: string }

/** A screen that crashes shows this instead of a blank page (D-108); moving to another page
 * (a new `resetKey`) tries again. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children
    return (
      <section role="alert" className="max-w-xl">
        <h1 className="text-xl font-semibold tracking-tight">
          Something went wrong on this screen
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Your data is safe: nothing is lost when a screen fails to draw. Try another page, or
          reload this one.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900"
          >
            Reload
          </button>
          <a
            href="/"
            className="rounded px-3 py-1.5 text-sm text-sky-700 underline dark:text-sky-300"
          >
            Dashboard
          </a>
        </div>
        <details className="mt-4 text-xs text-slate-500">
          <summary>Details</summary>
          <pre className="mt-1 whitespace-pre-wrap">{this.state.error.message}</pre>
        </details>
      </section>
    )
  }
}
