export function normalizeAccountNumber(value: string) {
  return value.replace(/\D/g, '')
}

export function validateBankPayoutInput(input: {
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
}) {
  const bankCode = typeof input.bankCode === 'string' ? input.bankCode.trim() : ''
  const bankName = typeof input.bankName === 'string' ? input.bankName.trim() : ''
  const accountNumber = normalizeAccountNumber(typeof input.accountNumber === 'string' ? input.accountNumber : '')
  const accountName = typeof input.accountName === 'string' ? input.accountName.trim() : ''

  if (bankCode.length < 2) {
    throw new Error('Valid bank code is required.')
  }

  if (bankName.length < 2) {
    throw new Error('Valid bank name is required.')
  }

  if (!/^\d{10}$/.test(accountNumber)) {
    throw new Error('Account number must be exactly 10 digits.')
  }

  return { bankCode, bankName, accountNumber, accountName }
}
