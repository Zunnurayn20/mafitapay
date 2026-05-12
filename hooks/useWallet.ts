import { useAppStore } from '@/store'
import { formatNGN } from '@/lib/utils'

export function useWallet() {
  const { wallet } = useAppStore()

  return {
    wallet,
    balance: wallet?.balance ?? 0,
    balanceFmt: wallet ? formatNGN(wallet.balance) : '—',
    lockedBalance: wallet?.lockedBalance ?? 0,
    virtualAccounts: wallet?.virtualAccounts ?? [],
    primaryAccount: wallet?.virtualAccounts[0] ?? null,
  }
}
