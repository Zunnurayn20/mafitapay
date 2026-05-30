const FALLBACK_ADMIN_EMAIL = 'aminu@mafitapay.ng'

function parseAdminEmails(value?: string) {
  return (value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

export function getConfiguredAdminEmails() {
  const emails = [
    ...parseAdminEmails(process.env.MAFITAPAY_ADMIN_EMAILS),
    ...parseAdminEmails(process.env.MAFITAPAY_ADMIN_EMAIL),
    ...parseAdminEmails(process.env.NEXT_PUBLIC_MAFITAPAY_ADMIN_EMAILS),
    ...parseAdminEmails(process.env.NEXT_PUBLIC_MAFITAPAY_ADMIN_EMAIL),
  ]

  return Array.from(new Set(emails.length > 0 ? emails : [FALLBACK_ADMIN_EMAIL]))
}

export function isAdminEmail(email?: string | null) {
  const normalizedEmail = (email ?? '').trim().toLowerCase()
  if (!normalizedEmail) return false
  return getConfiguredAdminEmails().includes(normalizedEmail)
}
