import type { BillProvider } from '@/types'

export type BillServiceConfig = {
  id: BillProvider['id']
  type: BillProvider['type']
  displayName: string
  accountLabel: string
  accountPlaceholder: string
  quickAmounts: number[]
  minAmount: number
  maxAmount: number
  requiresNetwork: boolean
  requiresAccount: boolean
}

export type SupportedNetworkProviderKey = 'mtn' | 'airtel' | 'glo' | '9mobile'

const NETWORK_PROVIDER_NAME_MATCHERS: Record<SupportedNetworkProviderKey, string[]> = {
  mtn: ['mtn'],
  airtel: ['airtel'],
  glo: ['glo'],
  '9mobile': ['9mobile', 'etisalat'],
}

const NETWORK_PREFIXES: Record<SupportedNetworkProviderKey, string[]> = {
  mtn: ['07025', '07026', '0703', '0704', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916'],
  airtel: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0904', '0907', '0912'],
  glo: ['0705', '0805', '0807', '0811', '0815', '0905', '0915'],
  '9mobile': ['0809', '0817', '0818', '0908', '0909'],
}

export const BILL_SERVICE_CONFIG: Record<BillProvider['type'], BillServiceConfig> = {
  airtime: {
    id: 'airtime',
    type: 'airtime',
    displayName: 'Airtime',
    accountLabel: 'Phone Number',
    accountPlaceholder: '0803 000 0000',
    quickAmounts: [100, 200, 500, 1000],
    minAmount: 50,
    maxAmount: 50000,
    requiresNetwork: true,
    requiresAccount: true,
  },
  data: {
    id: 'data',
    type: 'data',
    displayName: 'Data',
    accountLabel: 'Phone Number',
    accountPlaceholder: '0803 000 0000',
    quickAmounts: [350, 650, 1500, 2700],
    minAmount: 100,
    maxAmount: 100000,
    requiresNetwork: true,
    requiresAccount: true,
  },
  electric: {
    id: 'electric',
    type: 'electric',
    displayName: 'Electricity',
    accountLabel: 'Meter Number',
    accountPlaceholder: 'Enter meter number',
    quickAmounts: [1000, 2000, 5000, 10000],
    minAmount: 500,
    maxAmount: 250000,
    requiresNetwork: false,
    requiresAccount: true,
  },
  cable: {
    id: 'cable',
    type: 'cable',
    displayName: 'Cable TV',
    accountLabel: 'Decoder / Smart Card',
    accountPlaceholder: 'Enter smart card number',
    quickAmounts: [5000, 9900, 15000, 25000],
    minAmount: 500,
    maxAmount: 250000,
    requiresNetwork: false,
    requiresAccount: true,
  },
  education: {
    id: 'edu',
    type: 'education',
    displayName: 'Education',
    accountLabel: 'Student ID / Account',
    accountPlaceholder: 'Enter student ID or account number',
    quickAmounts: [5000, 10000, 20000, 50000],
    minAmount: 1000,
    maxAmount: 500000,
    requiresNetwork: false,
    requiresAccount: true,
  },
  gas: {
    id: 'gas',
    type: 'gas',
    displayName: 'Gas Fee',
    accountLabel: 'Customer Reference',
    accountPlaceholder: 'Enter gas customer reference',
    quickAmounts: [2000, 5000, 10000, 20000],
    minAmount: 500,
    maxAmount: 250000,
    requiresNetwork: false,
    requiresAccount: true,
  },
  insurance: {
    id: 'insure',
    type: 'insurance',
    displayName: 'Insurance',
    accountLabel: 'Policy Number',
    accountPlaceholder: 'Enter policy number',
    quickAmounts: [5000, 10000, 25000, 50000],
    minAmount: 1000,
    maxAmount: 500000,
    requiresNetwork: false,
    requiresAccount: true,
  },
  water: {
    id: 'water',
    type: 'water',
    displayName: 'Water',
    accountLabel: 'Customer Number',
    accountPlaceholder: 'Enter water customer number',
    quickAmounts: [1000, 2000, 5000, 10000],
    minAmount: 500,
    maxAmount: 250000,
    requiresNetwork: false,
    requiresAccount: true,
  },
}

export function getBillServiceConfig(provider?: Pick<BillProvider, 'type' | 'name'> | null) {
  if (!provider) return null
  return BILL_SERVICE_CONFIG[provider.type] ?? null
}

export function normalizeNigerianPhoneNumber(input: string) {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('234') && digits.length === 13) return `0${digits.slice(3)}`
  if (digits.length === 10) return `0${digits}`
  return digits
}

export function isValidNigerianPhoneNumber(input: string) {
  return /^0\d{10}$/.test(normalizeNigerianPhoneNumber(input))
}

export function detectNetworkProviderKeyFromPhone(input: string): SupportedNetworkProviderKey | null {
  const normalized = normalizeNigerianPhoneNumber(input)
  if (!normalized.startsWith('0') || normalized.length < 4) return null

  const candidates = Object.entries(NETWORK_PREFIXES)
    .flatMap(([providerKey, prefixes]) => prefixes.map(prefix => ({ providerKey: providerKey as SupportedNetworkProviderKey, prefix })))
    .sort((a, b) => b.prefix.length - a.prefix.length)

  const match = candidates.find(candidate => normalized.startsWith(candidate.prefix))
  return match?.providerKey ?? null
}

export function getDetectedNetworkProviderName(
  input: string,
  networkProviders: Array<{ name: string }>,
) {
  const detectedKey = detectNetworkProviderKeyFromPhone(input)
  if (!detectedKey) return null

  const matchedProvider = networkProviders.find(provider => {
    const normalizedName = provider.name.trim().toLowerCase()
    return NETWORK_PROVIDER_NAME_MATCHERS[detectedKey].some(matcher => normalizedName.includes(matcher))
  })

  return matchedProvider?.name ?? null
}
