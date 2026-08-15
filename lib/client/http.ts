'use client'

/**
 * Shared response parsing for API calls.
 *
 * Calling `response.json()` directly breaks badly when the body is not JSON — an edge 502 page,
 * a proxy timeout, a plain-text "Internal Server Error". The raw `SyntaxError` ("Unexpected
 * token ... is not valid JSON") then propagates into user-facing toasts, which tells the user
 * nothing and hides the real failure. These helpers read the body as text first and turn a
 * non-JSON response into a message describing what actually happened.
 */

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You are not authorised to perform this action.',
  404: 'That resource could not be found.',
  408: 'The request timed out. Please try again.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our side. Please try again.',
  502: 'The service is temporarily unavailable. Please try again in a moment.',
  503: 'The service is temporarily unavailable. Please try again in a moment.',
  504: 'The request took too long. Please try again.',
}

function describeStatus(status: number) {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]
  if (status >= 500) return 'The service is temporarily unavailable. Please try again in a moment.'
  if (status >= 400) return 'That request could not be completed.'
  return 'Unexpected response from the server.'
}

export type ApiEnvelope<T = unknown> = {
  data?: T
  error?: string
  success?: boolean
  [key: string]: unknown
}

/**
 * Parse a response body as a JSON envelope. Never throws a parser error: a non-JSON body becomes
 * an `Error` whose message reflects the HTTP status. Does not check `response.ok` — callers that
 * want the payload of an error response (validation details, for example) still get it.
 */
export async function parseJsonBody<T = unknown>(response: Response): Promise<ApiEnvelope<T>> {
  const raw = await response.text().catch(() => '')

  if (!raw.trim()) {
    throw new Error(response.ok
      ? 'The service did not respond. Please try again.'
      : describeStatus(response.status))
  }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as ApiEnvelope<T>
    return { data: parsed as T }
  } catch {
    // The body was not JSON at all — an HTML error page or a proxy message. Report the status
    // rather than the parser complaint, and keep the body out of the user-facing string.
    throw new Error(describeStatus(response.status))
  }
}

/**
 * Parse a response and enforce the app's success envelope, returning `data`.
 * Throws with the server-supplied `error` when present, otherwise a status-derived message.
 */
export async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  const payload = await parseJsonBody<T>(response)

  if (!response.ok || payload.success === false) {
    const serverMessage = typeof payload.error === 'string' ? payload.error.trim() : ''
    throw new Error(serverMessage || describeStatus(response.status))
  }

  return payload.data as T
}

/** Convert any thrown value into a message safe to show in a toast. */
export function toUserMessage(error: unknown, fallback: string) {
  // A dropped connection (server restart, edge timeout) surfaces as a TypeError from fetch with
  // a browser-specific message like "Failed to fetch" or "Load failed". Say something useful.
  if (error instanceof TypeError) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  // Empty or truncated bodies from a proxy timeout / crash: `response.json()` throws SyntaxError.
  if (
    error instanceof SyntaxError
    || (error instanceof Error && /unexpected end of json|is not valid json|failed to execute ['"]json['"]/i.test(error.message))
  ) {
    return 'The service did not respond. Please try again.'
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
