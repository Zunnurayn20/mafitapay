import { execFile } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

const TON_RPC_TIMEOUT_MS = 12_000
const TON_RPC_MIN_INTERVAL_MS = 1_000
const TON_RPC_RATE_LIMIT_RETRIES = 3
const execFileAsync = promisify(execFile)

export const TON_NETWORK_BUSY_MESSAGE = 'TON network is busy right now. Please try again in a moment.'

type TonHttpResult = {
  status: number
  statusText: string
  data: unknown
  headers: Record<string, string | string[] | undefined>
  transport: 'https' | 'curl'
}

let tonRpcChain: Promise<unknown> = Promise.resolve()
let tonRpcNotBefore = 0

export function isTonRateLimitPayload(data: unknown) {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  if (record.code === 429 || record.code === '429') return true
  const text = `${typeof record.error === 'string' ? record.error : ''} ${typeof record.result === 'string' ? record.result : ''}`.toLowerCase()
  return text.includes('ratelimit')
}

export function tonFailureStatus(message: string, responseStatus?: number, data?: unknown) {
  if (responseStatus === 429 || isTonRateLimitPayload(data)) return 429
  const jsonStart = message.indexOf('{')
  if (jsonStart >= 0) {
    try {
      if (isTonRateLimitPayload(JSON.parse(message.slice(jsonStart)))) return 429
    } catch {
      // The message is not a Toncenter JSON payload.
    }
  }
  if (/ratelimit exceed/i.test(message)) return 429
  return responseStatus
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function enqueueTonRpc<T>(task: () => Promise<T>) {
  const run = tonRpcChain.then(async () => {
    const waitMs = tonRpcNotBefore - Date.now()
    if (waitMs > 0) await sleep(waitMs)
    try {
      return await task()
    } finally {
      tonRpcNotBefore = Date.now() + TON_RPC_MIN_INTERVAL_MS
    }
  })
  tonRpcChain = run.then(() => undefined, () => undefined)
  return run
}

function shouldRetryTonRpcViaCurl(error: unknown) {
  if (!(error instanceof Error)) return false
  const enriched = error as Error & { code?: string }
  return enriched.code === 'EAI_AGAIN'
    || enriched.code === 'ETIMEDOUT'
    || enriched.code === 'ECONNRESET'
    || enriched.code === 'ENOTFOUND'
}

async function postJsonOverHttps<T>(input: string, body: string, headers?: Record<string, string>) {
  const url = new URL(input)

  return await new Promise<{ status: number; statusText: string; data: T; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'user-agent': 'mafitapay/0.1.0',
        ...headers,
      },
    }, response => {
      const status = response.statusCode ?? 0
      const statusText = response.statusMessage ?? ''
      let raw = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        raw += chunk
      })
      response.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) as T : null
          resolve({
            status,
            statusText,
            data: parsed as T,
            headers: response.headers,
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid JSON response.'))
        }
      })
    })

    request.setTimeout(TON_RPC_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('Request timed out.'), { code: 'ETIMEDOUT' }))
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function postJsonViaCurl<T>(input: string, body: string, headers?: Record<string, string>) {
  const args = [
    '-sS',
    '--max-time',
    String(Math.ceil(TON_RPC_TIMEOUT_MS / 1000)),
    '-X',
    'POST',
    input,
    '--data-binary',
    body,
    '-w',
    '\n%{http_code}',
  ]

  for (const [key, value] of Object.entries({
    'user-agent': 'mafitapay/0.1.0',
    ...headers,
  })) {
    args.push('-H', `${key}: ${value}`)
  }

  const { stdout } = await execFileAsync('curl', args)
  const markerIndex = stdout.lastIndexOf('\n')
  if (markerIndex < 0) {
    throw new Error('Missing HTTP status from curl response.')
  }
  const raw = stdout.slice(0, markerIndex)
  const status = Number(stdout.slice(markerIndex + 1).trim())
  return {
    status,
    statusText: '',
    data: raw ? JSON.parse(raw) as T : null as T,
    headers: {},
  }
}

function isTonRateLimited(response: { status: number; data: unknown }) {
  return response.status === 429 || isTonRateLimitPayload(response.data)
}

async function postTonRpcAttempt(input: string, body: string, headers: Record<string, string>): Promise<TonHttpResult> {
  try {
    const response = await postJsonOverHttps<unknown>(input, body, headers)
    return { ...response, transport: 'https' }
  } catch (error) {
    if (!shouldRetryTonRpcViaCurl(error)) throw error
    const response = await postJsonViaCurl<unknown>(input, body, headers)
    return { ...response, headers: {}, transport: 'curl' }
  }
}

async function postTonRpc(input: string, body: string, headers: Record<string, string>) {
  return enqueueTonRpc(async () => {
    let response = await postTonRpcAttempt(input, body, headers)
    for (let attempt = 0; attempt < TON_RPC_RATE_LIMIT_RETRIES && isTonRateLimited(response); attempt += 1) {
      await sleep(TON_RPC_MIN_INTERVAL_MS)
      response = await postTonRpcAttempt(input, body, headers)
    }
    return response
  })
}

export function createTonHttpAdapter(): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const headers = Object.fromEntries(
      Object.entries(config.headers?.toJSON ? config.headers.toJSON() as Record<string, unknown> : (config.headers as Record<string, unknown> | undefined) ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    )
    const body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data ?? {})
    const response = await postTonRpc(config.url ?? '', body, headers)
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      config,
      request: { transport: response.transport },
    }
  }
}
