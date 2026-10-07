export const EMAIL_RE = /^\S+@\S+\.\S+$/
export const PHONE_RE = /^\+?[1-9]\d{9,14}$/

export function normalizePhone(value: string) {
  const trimmed = value.trim()
  const normalized = trimmed.replace(/[^\d+]/g, '')
  if (normalized.startsWith('+')) return normalized
  if (normalized.startsWith('0')) return `+234${normalized.slice(1)}`
  if (normalized.startsWith('234')) return `+${normalized}`
  return normalized
}

export function phoneFromChipInput(local: string) {
  const digits = local.trim()
  if (!digits) return ''
  if (/^(\+|0|234)/.test(digits)) return normalizePhone(digits)
  return normalizePhone(`0${digits}`)
}

export function passwordChecks(password: string) {
  return { length: password.length >= 8, letter: /[A-Za-z]/.test(password), number: /\d/.test(password) }
}
export const isPasswordValid = (password: string) => Object.values(passwordChecks(password)).every(Boolean)
export type FieldErrors<K extends string> = Partial<Record<K, string>>

export function validateProfileFields(value: { name: string; email: string; phone: string }): FieldErrors<'name' | 'email' | 'phone'> {
  const errors: FieldErrors<'name' | 'email' | 'phone'> = {}
  if (!value.name.trim()) errors.name = 'Enter your full name'
  else if (value.name.trim().length < 2) errors.name = 'Full name must be at least 2 characters'
  if (!value.email.trim()) errors.email = 'Enter your email address'
  else if (!EMAIL_RE.test(value.email.trim())) errors.email = "That email doesn't look right"
  if (!value.phone.trim()) errors.phone = 'Enter your phone number'
  else if (!PHONE_RE.test(phoneFromChipInput(value.phone))) errors.phone = 'Enter a valid Nigerian phone number'
  return errors
}
