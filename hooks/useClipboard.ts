import { useState, useCallback } from 'react'

export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), timeout)
    } catch {
      // fallback for non-HTTPS
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), timeout)
    }
  }, [timeout])

  return { copy, copied }
}
