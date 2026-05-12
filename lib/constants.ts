import type { CryptoAsset, P2PMerchant, BillProvider, NetworkProvider } from '../types/index.ts'

export const CRYPTO_ASSETS: CryptoAsset[] = [
  { id: 'USDT_BSC', name: 'Tether USD', symbol: 'USDT', network: 'BSC', icon: '/crypto-assets/usdt.png', marketSourceId: 'tether', marketPriceUsd: 1, marketRate: 1600, buyRate: 1628.8, sellRate: 1571.2, buySpreadBps: 180, sellSpreadBps: 180, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 0.3 },
  { id: 'USDC_BASE', name: 'USD Coin', symbol: 'USDC', network: 'Base', icon: '/crypto-assets/usdc.png', marketSourceId: 'usd-coin', marketPriceUsd: 1, marketRate: 1595, buyRate: 1620.52, sellRate: 1569.48, buySpreadBps: 160, sellSpreadBps: 160, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 0.2 },
  { id: 'USDC_SOLANA', name: 'USD Coin', symbol: 'USDC', network: 'Solana', icon: '/crypto-assets/usdc.png', marketSourceId: 'usd-coin', marketPriceUsd: 1, marketRate: 1595, buyRate: 1620.52, sellRate: 1569.48, buySpreadBps: 160, sellSpreadBps: 160, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 0.2 },
  { id: 'ETH_BASE', name: 'Ethereum', symbol: 'ETH', network: 'Base', icon: '/crypto-assets/eth.png', marketSourceId: 'ethereum', marketPriceUsd: 3200, marketRate: 5250000, buyRate: 5391750, sellRate: 5108250, buySpreadBps: 270, sellSpreadBps: 270, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 1.8 },
  { id: 'ETH_ETHEREUM', name: 'Ethereum', symbol: 'ETH', network: 'Ethereum', icon: '/crypto-assets/eth.png', marketSourceId: 'ethereum', marketPriceUsd: 3200, marketRate: 5250000, buyRate: 5418000, sellRate: 5082000, buySpreadBps: 320, sellSpreadBps: 320, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: false, change24h: 1.8 },
  { id: 'SOL_SOLANA', name: 'Solana', symbol: 'SOL', network: 'Solana', icon: '/crypto-assets/sol.png', marketSourceId: 'solana', marketPriceUsd: 180, marketRate: 285000, buyRate: 293550, sellRate: 276450, buySpreadBps: 300, sellSpreadBps: 300, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 2.4 },
  { id: 'BNB_BSC', name: 'BNB', symbol: 'BNB', network: 'BSC', icon: '/crypto-assets/bnb.png', marketSourceId: 'binancecoin', marketPriceUsd: 620, marketRate: 980000, buyRate: 1007440, sellRate: 952560, buySpreadBps: 280, sellSpreadBps: 280, quoteTtlSeconds: 30, isActive: true, transakEnabled: true, baseExecutionEnabled: true, change24h: 1.1 },
  { id: 'TON_TON', name: 'Toncoin', symbol: 'TON', network: 'TON', icon: '/crypto-assets/ton.svg', marketSourceId: 'the-open-network', marketPriceUsd: 1.32, marketRate: 1980, buyRate: 2039.4, sellRate: 1920.6, buySpreadBps: 300, sellSpreadBps: 300, quoteTtlSeconds: 30, isActive: true, transakEnabled: false, baseExecutionEnabled: true, change24h: 1.5 },
  { id: 'SUI_SUI', name: 'Sui', symbol: 'SUI', network: 'Sui', icon: '/crypto-assets/sui.svg', marketSourceId: 'sui', marketPriceUsd: 1.02, marketRate: 1632, buyRate: 1680.96, sellRate: 1583.04, buySpreadBps: 300, sellSpreadBps: 300, quoteTtlSeconds: 30, isActive: true, transakEnabled: false, baseExecutionEnabled: true, change24h: 1.7 },
  { id: 'NEAR_NEAR', name: 'NEAR Protocol', symbol: 'NEAR', network: 'NEAR', icon: '/crypto-assets/near.svg', marketSourceId: 'near', marketPriceUsd: 6.4, marketRate: 10240, buyRate: 10547.2, sellRate: 9932.8, buySpreadBps: 300, sellSpreadBps: 300, quoteTtlSeconds: 30, isActive: true, transakEnabled: false, baseExecutionEnabled: true, change24h: 1.6 },
]

export const P2P_MERCHANTS: P2PMerchant[] = [
  { id: 'm1', name: 'AdiolaStore',    initial: 'A', bank: 'First Bank',   accountNumber: '3012345678', accountName: 'ADIO STORES NIG LTD',       completionRate: 98, totalTrades: 234, minAmount: 5000,  maxAmount: 500000,  availableBalance: 200000,  isOnline: true },
  { id: 'm2', name: 'KanatMerchant',  initial: 'K', bank: 'GTBank',       accountNumber: '0128374651', accountName: 'KANAT MERCHANT SERVICES',    completionRate: 95, totalTrades: 891, minAmount: 1000,  maxAmount: 1000000, availableBalance: 850000,  isOnline: true },
  { id: 'm3', name: 'FatimahPay',     initial: 'F', bank: 'Access Bank',  accountNumber: '0091827364', accountName: 'FATIMAH ENTERPRISES LTD',    completionRate: 100, totalTrades: 56, minAmount: 2000,  maxAmount: 300000,  availableBalance: 120000,  isOnline: true },
]

export const BILL_PROVIDERS: BillProvider[] = [
  { id: 'airtime', name: 'Airtime', icon: '📱', type: 'airtime', accountLabel: 'Phone Number', accountPlaceholder: '0803 000 0000', helperText: 'Top up a valid Nigerian mobile number instantly.', minAmount: 50, maxAmount: 50000, requiresNetwork: true, requiresAccount: true, isActive: true },
  { id: 'data', name: 'Data', icon: '🌐', type: 'data', accountLabel: 'Phone Number', accountPlaceholder: '0803 000 0000', helperText: 'Purchase mobile data for a Nigerian mobile line.', minAmount: 100, maxAmount: 100000, requiresNetwork: true, requiresAccount: true, isActive: true },
  { id: 'electric', name: 'Electricity', icon: '⚡', type: 'electric', accountLabel: 'Meter Number', accountPlaceholder: 'Enter meter number', helperText: 'Pay for prepaid or postpaid meter service.', minAmount: 500, maxAmount: 250000, requiresNetwork: false, requiresAccount: true, isActive: true },
  { id: 'cable', name: 'Cable TV', icon: '📺', type: 'cable', accountLabel: 'Decoder / Smart Card', accountPlaceholder: 'Enter smart card number', helperText: 'Renew a decoder or smart card subscription.', minAmount: 500, maxAmount: 250000, requiresNetwork: false, requiresAccount: true, isActive: true },
  { id: 'edu', name: 'Education', icon: '🎓', type: 'education', accountLabel: 'Student ID / Account', accountPlaceholder: 'Enter student ID or account number', helperText: 'Settle school, exam, or education-related fees.', minAmount: 1000, maxAmount: 500000, requiresNetwork: false, requiresAccount: true, isActive: true },
  { id: 'gas', name: 'Gas Fee', icon: '⛽', type: 'gas', accountLabel: 'Customer Reference', accountPlaceholder: 'Enter gas customer reference', helperText: 'Pay gas utility bills using a valid customer reference.', minAmount: 500, maxAmount: 250000, requiresNetwork: false, requiresAccount: true, isActive: true },
  { id: 'insure', name: 'Insurance', icon: '🏥', type: 'insurance', accountLabel: 'Policy Number', accountPlaceholder: 'Enter policy number', helperText: 'Pay a valid insurance policy or premium reference.', minAmount: 1000, maxAmount: 500000, requiresNetwork: false, requiresAccount: true, isActive: true },
  { id: 'water', name: 'Water', icon: '🚰', type: 'water', accountLabel: 'Customer Number', accountPlaceholder: 'Enter water customer number', helperText: 'Pay water utility bills using the official customer number.', minAmount: 500, maxAmount: 250000, requiresNetwork: false, requiresAccount: true, isActive: true },
]

export const NETWORK_PROVIDERS: NetworkProvider[] = [
  { name: 'MTN Nigeria', icon: '/network-providers/mtn.svg' },
  { name: 'Airtel Nigeria', icon: '/network-providers/airtel.svg' },
  { name: 'Glo Nigeria', icon: '/network-providers/glo.svg' },
  { name: '9Mobile', icon: '/network-providers/9mobile.svg' },
]

export const EXCHANGES = ['Binance', 'Bybit', 'OKX', 'KuCoin', 'Bitget', 'HTX']

export const DEPOSIT_UIDS: Record<string, Record<string, string>> = {
  Binance: {
    USDT_BSC: '0x8f89A1C6c772f657B9f7B1E0f7F57f7eB2C23921',
    USDC_BASE: '0x4d4C4e5e6f70819293949596979899A0b1C2D3E4',
    USDC_SOLANA: '4tSvZvnbyzHXLMTiFonMyxZoHmFqau1XArcRCVHLZ5gX',
    ETH_BASE: '0x4d4C4e5e6f70819293949596979899A0b1C2D3E4',
    ETH_ETHEREUM: '0x3a8B9Fd21E7cC4507D29bF8Aa12e4F36d7B5aC90',
    SOL_SOLANA: '3eYH8fK7Kk2wN4f7yVh3Y5J3a7sF9R8kP1Q2w3E4R5T6',
    BNB_BSC: '0x8f89A1C6c772f657B9f7B1E0f7F57f7eB2C23921',
  },
  Bybit: {
    USDT_BSC: '0x7F2dC85Ae9b3E10844fD6cB92a35F4e21D8c7bE5',
    USDC_BASE: '0x1b2C3d4E5f60718293A4b5C6d7E8F90123456789',
    USDC_SOLANA: 'A4kL3n6P7uJ2mY5cW8sX1eR4tV7qB9zN2dF6gH3jK8L1',
    ETH_BASE: '0x1b2C3d4E5f60718293A4b5C6d7E8F90123456789',
    ETH_ETHEREUM: '0x7F2dC85Ae9b3E10844fD6cB92a35F4e21D8c7bE5',
    SOL_SOLANA: '7R5tQ9zYwX3vB1nM4pK8sF6gH2jL5mN8qR1tV4wX7Y2',
    BNB_BSC: '0x7F2dC85Ae9b3E10844fD6cB92a35F4e21D8c7bE5',
  },
  OKX: {
    USDT_BSC: '0x9B4eA72Fc3D08145aE7aB52b36F8d19C2e5aD710',
    USDC_BASE: '0x5c6D7e8F90123456789AbCdEf0123456789aBCdE',
    USDC_SOLANA: '9r2D6fL1xM5vT8qP4nK7sH3jC6bW9yU2aE5tR8mN1pQ4',
    ETH_BASE: '0x5c6D7e8F90123456789AbCdEf0123456789aBCdE',
    ETH_ETHEREUM: '0x9B4eA72Fc3D08145aE7aB52b36F8d19C2e5aD710',
    SOL_SOLANA: '9vX8cB7nM6aS5dF4gH3jK2lP1oI9uY8tR7eW6qZ5xC4',
    BNB_BSC: '0x9B4eA72Fc3D08145aE7aB52b36F8d19C2e5aD710',
  },
}

export const MOCK_TRANSACTIONS = [
  { id: 't1', type: 'p2p_deposit',    status: 'success', amount: 25000,  fee: 0,   description: 'P2P Deposit — AdiolaStore',   reference: 'MFP-284711', createdAt: '2025-06-11T10:23:00Z', icon: '⬇' },
  { id: 't2', type: 'airtime',        status: 'success', amount: -2000,  fee: 0,   description: 'Airtime — MTN',              reference: 'MFP-284698', createdAt: '2025-06-11T07:45:00Z', icon: '📱' },
  { id: 't3', type: 'p2p_withdrawal', status: 'success', amount: -15000, fee: 0,   description: 'P2P Withdrawal — AdiolaStore', reference: 'MFP-284501', createdAt: '2025-06-10T15:12:00Z', icon: '⬆' },
  { id: 't4', type: 'crypto_sell',    status: 'success', amount: 38000,  fee: 200, description: 'USDT Sell — 50 USDT',        reference: 'MFP-284422', createdAt: '2025-06-10T09:30:00Z', icon: '₿' },
  { id: 't5', type: 'cable',          status: 'success', amount: -9900,  fee: 0,   description: 'DStv Compact',               reference: 'MFP-284310', createdAt: '2025-06-10T11:04:00Z', icon: '📺' },
  { id: 't6', type: 'referral_bonus', status: 'success', amount: 200,    fee: 0,   description: 'Referral Bonus — Yusuf',     reference: 'MFP-284205', createdAt: '2025-06-10T14:00:00Z', icon: '₦' },
  { id: 't7', type: 'electric',       status: 'success', amount: -5000,  fee: 0,   description: 'EKEDC Electricity',          reference: 'MFP-284100', createdAt: '2025-06-10T08:15:00Z', icon: '⚡' },
]

export const MOCK_USER = {
  id: 'u1',
  name: 'Aminu Ibrahim',
  email: 'aminu@mafitapay.ng',
  phone: '08034512873',
  handle: '@aminupay',
  referralCode: 'MAFAT2912',
  accountStatus: 'active' as const,
  kycStatus: 'pending' as const,
  tier: 'basic' as const,
  createdAt: '2025-01-01T00:00:00Z',
}

export const MOCK_WALLET = {
  balance: 147500,
  lockedBalance: 12000,
  reserveBalance: 0,
  reserveLockedBalance: 0,
  currency: 'NGN' as const,
  virtualAccounts: [
    { bank: 'Moniepoint', accountNumber: '9023451287', accountName: 'AMINU IBRAHIM MAFITAPAY', provider: 'moniepoint' as const },
  ],
}
