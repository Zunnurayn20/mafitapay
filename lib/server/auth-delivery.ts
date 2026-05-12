type PasswordResetDeliveryInput = {
  email: string
  phone?: string
  resetLink: string
  expiresAt: string
}

type EmailVerificationDeliveryInput = {
  email: string
  verificationLink: string
  expiresAt: string
}

type DeliveryAttempt = {
  channel: 'email' | 'sms'
  provider: string
  delivered: boolean
  error?: string
}

function getAppUrl() {
  return (process.env.MAFITAPAY_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

function getResendConfig() {
  const apiKey = process.env.MAFITAPAY_RESEND_API_KEY?.trim() || ''
  const fromEmail = process.env.MAFITAPAY_RESEND_FROM_EMAIL?.trim() || ''
  const fromName = process.env.MAFITAPAY_RESEND_FROM_NAME?.trim() || 'MafitaPay'
  return {
    configured: Boolean(apiKey && fromEmail),
    apiKey,
    fromEmail,
    fromName,
  }
}

function getTermiiConfig() {
  const apiKey = process.env.MAFITAPAY_TERMII_API_KEY?.trim() || ''
  const senderId = process.env.MAFITAPAY_TERMII_SENDER_ID?.trim() || ''
  const channel = process.env.MAFITAPAY_TERMII_CHANNEL?.trim() || 'generic'
  return {
    configured: Boolean(apiKey && senderId),
    apiKey,
    senderId,
    channel,
  }
}

function formatExpiry(expiresAt: string) {
  return new Date(expiresAt).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function sendPasswordResetEmail(input: PasswordResetDeliveryInput): Promise<DeliveryAttempt> {
  const resend = getResendConfig()
  if (!resend.configured) {
    return { channel: 'email', provider: 'resend', delivered: false, error: 'Email delivery provider is not configured.' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: [input.email],
        subject: 'Reset your MafitaPay password',
        text: `Use this link to reset your MafitaPay password: ${input.resetLink}\n\nThis link expires on ${formatExpiry(input.expiresAt)}.\n\nIf you did not request this, ignore this message.`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
            <h2>Reset your MafitaPay password</h2>
            <p>Use the button below to choose a new password.</p>
            <p>
              <a href="${input.resetLink}" style="display:inline-block;padding:12px 18px;background:#caa560;color:#111827;text-decoration:none;font-weight:700;">
                Reset Password
              </a>
            </p>
            <p>If the button does not work, use this link:</p>
            <p><a href="${input.resetLink}">${input.resetLink}</a></p>
            <p>This link expires on ${formatExpiry(input.expiresAt)}.</p>
            <p>If you did not request this, you can ignore this message.</p>
            <p style="color:#6b7280;font-size:12px">Sent from ${getAppUrl()}</p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      const payload = await response.text()
      return { channel: 'email', provider: 'resend', delivered: false, error: payload || 'Email delivery failed.' }
    }
  } catch (error) {
    return {
      channel: 'email',
      provider: 'resend',
      delivered: false,
      error: error instanceof Error ? error.message : 'Email delivery failed.',
    }
  }

  return { channel: 'email', provider: 'resend', delivered: true }
}

async function sendEmailVerificationEmail(input: EmailVerificationDeliveryInput): Promise<DeliveryAttempt> {
  const resend = getResendConfig()
  if (!resend.configured) {
    return { channel: 'email', provider: 'resend', delivered: false, error: 'Email delivery provider is not configured.' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: [input.email],
        subject: 'Verify your MafitaPay email',
        text: `Verify your MafitaPay email with this link: ${input.verificationLink}\n\nThis link expires on ${formatExpiry(input.expiresAt)}.\n\nIf you did not create this account, ignore this message.`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
            <h2>Verify your MafitaPay email</h2>
            <p>Use the button below to activate your account.</p>
            <p>
              <a href="${input.verificationLink}" style="display:inline-block;padding:12px 18px;background:#caa560;color:#111827;text-decoration:none;font-weight:700;">
                Verify Email
              </a>
            </p>
            <p>If the button does not work, use this link:</p>
            <p><a href="${input.verificationLink}">${input.verificationLink}</a></p>
            <p>This link expires on ${formatExpiry(input.expiresAt)}.</p>
            <p>If you did not create this account, you can ignore this message.</p>
            <p style="color:#6b7280;font-size:12px">Sent from ${getAppUrl()}</p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      const payload = await response.text()
      return { channel: 'email', provider: 'resend', delivered: false, error: payload || 'Email delivery failed.' }
    }
  } catch (error) {
    return {
      channel: 'email',
      provider: 'resend',
      delivered: false,
      error: error instanceof Error ? error.message : 'Email delivery failed.',
    }
  }

  return { channel: 'email', provider: 'resend', delivered: true }
}

async function sendPasswordResetSms(input: PasswordResetDeliveryInput): Promise<DeliveryAttempt> {
  const termii = getTermiiConfig()
  if (!termii.configured || !input.phone) {
    return { channel: 'sms', provider: 'termii', delivered: false, error: input.phone ? 'SMS delivery provider is not configured.' : 'User phone number is not available.' }
  }

  const sms = `MafitaPay password reset: ${input.resetLink} . Expires ${formatExpiry(input.expiresAt)}. Ignore if not requested.`
  try {
    const response = await fetch('https://api.ng.termii.com/api/sms/send/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: termii.apiKey,
        to: [input.phone.replace(/^\+/, '')],
        from: termii.senderId,
        sms,
        type: 'plain',
        channel: termii.channel,
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || payload.code !== 'ok') {
      return {
        channel: 'sms',
        provider: 'termii',
        delivered: false,
        error: typeof payload?.message === 'string' ? payload.message : 'SMS delivery failed.',
      }
    }
  } catch (error) {
    return {
      channel: 'sms',
      provider: 'termii',
      delivered: false,
      error: error instanceof Error ? error.message : 'SMS delivery failed.',
    }
  }

  return { channel: 'sms', provider: 'termii', delivered: true }
}

export async function deliverPasswordReset(input: PasswordResetDeliveryInput) {
  const attempts = await Promise.all([
    sendPasswordResetEmail(input),
    sendPasswordResetSms(input),
  ])

  return {
    delivered: attempts.some(item => item.delivered),
    attempts,
  }
}

export async function deliverEmailVerification(input: EmailVerificationDeliveryInput) {
  const attempt = await sendEmailVerificationEmail(input)
  return {
    delivered: attempt.delivered,
    attempts: [attempt],
  }
}
