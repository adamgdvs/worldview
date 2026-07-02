import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Top-level error boundary. The most common fatal error is CesiumWidget
 * failing to acquire a WebGL context (headless browsers, remote desktops,
 * exhausted GPU contexts) — without this the app renders a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isWebGL = /webgl/i.test(error.message)
    return (
      <div className="w-screen h-screen bg-[#020408] flex items-center justify-center font-mono">
        <div className="max-w-lg border border-[#D97736]/40 bg-[#0a0f1a] p-8 space-y-4">
          <div className="text-[#D97736] font-bold tracking-[0.3em] text-sm">
            ⚠ SYSTEM FAULT
          </div>
          <div className="text-[#8899aa] text-xs leading-relaxed">
            {isWebGL ? (
              <>
                WORLDVIEW requires WebGL to render the tactical globe, but the
                browser failed to initialise a GPU context. Try a different
                browser, update your graphics drivers, or disable GPU-blocking
                extensions.
              </>
            ) : (
              <>An unrecoverable error occurred while rendering the display.</>
            )}
          </div>
          <pre className="text-[10px] text-[#556677] bg-black/40 p-3 overflow-auto max-h-40 whitespace-pre-wrap">
            {error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="text-[#00F0FF] border border-[#00F0FF]/40 px-4 py-1.5 text-xs tracking-widest hover:bg-[#00F0FF]/10 cursor-pointer"
          >
            RESTART SYSTEM
          </button>
        </div>
      </div>
    )
  }
}
