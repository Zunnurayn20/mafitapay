/**
 * Firebase Cloud Messaging delivery over the HTTP v1 API.
 *
 * v1 requires an OAuth2 bearer token rather than a static server key, so we mint a short-lived
 * access token by signing a JWT with the service account private key. That keeps the dependency
 * footprint at zero -- node:crypto can sign RS256 without firebase-admin.
 *
 * Configure with MAFITAPAY_FCM_SERVICE_ACCOUNT_JSON and MAFITAPAY_FCM_PROJECT_ID. When either is
 * missing, sends report an error instead of throwing: push is best-effort, like email.
 */

type PushNotificationInput = {
  token: string
  title: string
  message: string
  data?: Record<string, string>
}

type PushDeliveryAttempt = {
  token: string
  delivered: boolean
  error?: string
  /** FCM rejected the token itself -- the app was uninstalled or the token rotated. Safe to prune. */
  tokenInvalid?: boolean
}

/**
 * Service account credentials, stored either as raw JSON or base64 (hosts that mangle the
 * multi-line private key in env vars).
 */
function getFcmConfig() {
  const rawServiceAccount = process.env.MAFITAPAY_FCM_SERVICE_ACCOUNT_JSON?.trim() || ''
  const projectId = process.env.MAFITAPAY_FCM_PROJECT_ID?.trim() || ''
  return {
    configured: Boolean(rawServiceAccount && projectId),
    rawServiceAccount,
    projectId,
  }
}

function parseServiceAccount(raw: string): { clientEmail: string; privateKey: string } | null {
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const parsed = JSON.parse(json)
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : ''
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : ''
  if (!clientEmail || !privateKey) return null
  return { clientEmail, privateKey }
}

async function getFcmAccessToken(): Promise<string | null> {
  const { rawServiceAccount } = getFcmConfig()
  if (!rawServiceAccount) return null

  try {
    const serviceAccount = parseServiceAccount(rawServiceAccount)
    if (!serviceAccount) {
      console.warn('[notifications] FCM service account is missing client_email or private_key.')
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: serviceAccount.clientEmail,
      sub: serviceAccount.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    }

    // Minimal JWT signing with node:crypto (no external dependencies)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const message = `${header}.${body}`

    const { createSign } = await import('node:crypto')
    const sign = createSign('RSA-SHA256')
    sign.update(message)
    const signature = sign.sign(serviceAccount.privateKey, 'base64url')
    const jwt = `${message}.${signature}`

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })

    if (!tokenResponse.ok) {
      console.warn('[notifications] OAuth token request failed:', await tokenResponse.text())
      return null
    }

    const tokenData = await tokenResponse.json()
    return tokenData.access_token || null
  } catch (error) {
    console.warn('[notifications] Failed to generate FCM access token:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function sendPushNotification(input: PushNotificationInput): Promise<PushDeliveryAttempt> {
  const accessToken = await getFcmAccessToken()
  if (!accessToken) {
    return { token: input.token, delivered: false, error: 'FCM service account is not configured.' }
  }

  const { projectId } = getFcmConfig()
  if (!projectId) {
    return { token: input.token, delivered: false, error: 'FCM project ID is not configured.' }
  }

  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: {
            title: input.title,
            body: input.message,
          },
          data: input.data,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channel_id: 'default',
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      // 404 UNREGISTERED means the app was uninstalled or the token rotated; 400 INVALID_ARGUMENT
      // on the token field means it was never valid. Both are permanent -- prune rather than retry.
      const tokenInvalid = response.status === 404
        || (response.status === 400 && errorText.includes('INVALID_ARGUMENT') && errorText.includes('token'))

      return {
        token: input.token,
        delivered: false,
        error: errorText || `FCM delivery failed with status ${response.status}.`,
        tokenInvalid,
      }
    }

    return { token: input.token, delivered: true }
  } catch (error) {
    return {
      token: input.token,
      delivered: false,
      error: error instanceof Error ? error.message : 'FCM delivery failed.',
    }
  }
}

export function isFcmConfigured(): boolean {
  return getFcmConfig().configured
}
