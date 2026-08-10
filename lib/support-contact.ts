/**
 * Support and social contact details.
 *
 * Read from NEXT_PUBLIC_* so a number or handle can change without a code edit, with the current
 * values as fallbacks so a missing env var degrades to the right contact rather than a dead link.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, so each must be referenced as a full literal
 * process.env.NEXT_PUBLIC_X expression -- a computed lookup would resolve to undefined in the
 * browser bundle.
 */

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_MAFITAPAY_WHATSAPP_NUMBER?.trim() || '2348162037790'
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_MAFITAPAY_SUPPORT_EMAIL?.trim() || 'support@mafitapay.com'
const INSTAGRAM_HANDLE = process.env.NEXT_PUBLIC_MAFITAPAY_INSTAGRAM?.trim() || 'mafitapay'
const TWITTER_HANDLE = process.env.NEXT_PUBLIC_MAFITAPAY_TWITTER?.trim() || 'mafitapay'
const FACEBOOK_HANDLE = process.env.NEXT_PUBLIC_MAFITAPAY_FACEBOOK?.trim() || 'mafitapay'
const TIKTOK_HANDLE = process.env.NEXT_PUBLIC_MAFITAPAY_TIKTOK?.trim() || 'mafitapay'

/** Strip the @ and any wrapping URL so env values work whether set as "@name", "name", or a link. */
function normalizeHandle(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^@+/, '')
    .replace(/\/+$/, '')
}

/** Digits only. wa.me rejects +, spaces and dashes, and a leading 0 is a local number, not E.164. */
function normalizePhone(value: string) {
  return value.replace(/\D/g, '')
}

export type SocialChannel = {
  key: 'instagram' | 'twitter' | 'facebook' | 'tiktok'
  label: string
  handle: string
  url: string
}

export const supportContact = {
  whatsappNumber: normalizePhone(WHATSAPP_NUMBER),
  /** Display form: +234 816 203 7790 */
  whatsappDisplay: formatPhoneForDisplay(normalizePhone(WHATSAPP_NUMBER)),
  email: SUPPORT_EMAIL,
}

/**
 * Deep link into WhatsApp. wa.me hands off to the installed app on mobile and web.whatsapp.com on
 * desktop, so it works in the Capacitor shell and the browser without branching.
 */
export function getWhatsAppUrl(message?: string) {
  const base = `https://wa.me/${supportContact.whatsappNumber}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

export function getSupportMailtoUrl(subject?: string) {
  const base = `mailto:${supportContact.email}`
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base
}

export const socialChannels: SocialChannel[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    handle: normalizeHandle(INSTAGRAM_HANDLE),
    url: `https://instagram.com/${normalizeHandle(INSTAGRAM_HANDLE)}`,
  },
  {
    key: 'twitter',
    label: 'X (Twitter)',
    handle: normalizeHandle(TWITTER_HANDLE),
    url: `https://x.com/${normalizeHandle(TWITTER_HANDLE)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    handle: normalizeHandle(FACEBOOK_HANDLE),
    url: `https://facebook.com/${normalizeHandle(FACEBOOK_HANDLE)}`,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    handle: normalizeHandle(TIKTOK_HANDLE),
    url: `https://tiktok.com/@${normalizeHandle(TIKTOK_HANDLE)}`,
  },
]

function formatPhoneForDisplay(digits: string) {
  // Nigerian numbers in E.164: 234 + 10 digits. Anything else is shown as given rather than
  // forced into a grouping that would misrepresent it.
  if (digits.length === 13 && digits.startsWith('234')) {
    const local = digits.slice(3)
    return `+234 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
  }
  return `+${digits}`
}
