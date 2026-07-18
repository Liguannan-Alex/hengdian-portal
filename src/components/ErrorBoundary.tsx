import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Home, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('门户界面发生错误', error, info)
  }

  private goHome = () => {
    this.setState({ hasError: false })
    window.location.hash = '#/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-4 py-12 text-paper">
        <section className="w-full max-w-lg rounded-2xl border border-paper/15 bg-ink-soft p-7 text-center shadow-2xl sm:p-10">
          <TriangleAlert className="mx-auto h-9 w-9 text-gold-soft" aria-hidden="true" />
          <h1 className="mt-5 text-2xl font-semibold">页面暂时没有正常打开</h1>
          <p className="mt-3 text-sm leading-6 text-paper/68">
            当前界面遇到异常。你可以先刷新页面；如果仍未恢复，请返回首页重新进入。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              刷新页面
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={this.goHome}
              className="border-paper/25 bg-transparent text-paper hover:bg-paper/10 hover:text-paper"
            >
              <Home className="mr-1.5 h-4 w-4" aria-hidden="true" />
              返回首页
            </Button>
          </div>
        </section>
      </main>
    )
  }
}
