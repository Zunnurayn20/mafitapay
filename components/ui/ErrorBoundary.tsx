'use client'
import { Component, ReactNode } from 'react'
import { Button } from './Button'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="font-display font-bold text-xl text-[var(--text)] mb-2">Something went wrong</div>
          <div className="text-[12px] text-[var(--muted)] mb-5 max-w-xs">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <Button onClick={() => this.setState({ hasError: false })}>Try again</Button>
        </div>
      )
    }
    return this.props.children
  }
}
