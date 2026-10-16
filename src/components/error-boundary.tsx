import { Component, type ReactNode } from 'react'
import { Button } from './ui'

/** If a screen ever fails to draw, offer a way out instead of a blank page. No details: they'd only help an attacker. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="app-height flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="font-semibold">Something went wrong</p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    )
  }
}
