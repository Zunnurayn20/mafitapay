import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { FundingAccountEligibility, Theme, Transaction, User, Wallet } from '@/types'

interface SessionData {
  user: User
  wallet: Wallet | null
  transactions: Transaction[]
  currentSessionToken: string | null
  securitySettings: {
    userId: string
    transactionPinEnabled: boolean
    twoFactorEnabled: boolean
    biometricEnabled: boolean
    createdAt: string
    updatedAt: string
  } | null
  kycSubmission: {
    id: string
    userId: string
    documentType: 'nin' | 'bvn' | 'passport' | 'drivers_license' | 'voters_card'
    documentNumber: string
    documentUrl: string
    documentName?: string
    mimeType?: string
    fileSize?: number
    status: 'pending' | 'approved' | 'rejected'
    notes?: string
    reviewedBy?: string
    reviewedAt?: string
    createdAt: string
    updatedAt: string
  } | null
  fundingAccountEligibility: FundingAccountEligibility
  notifications: {
    id: string
    title: string
    message: string
    type: 'success' | 'error' | 'info'
    read: boolean
    createdAt: string
  }[]
  sessions: {
    token: string
    userId: string
    expiresAt: string
    createdAt: string
    userAgent?: string
    ipAddress?: string
  }[]
}

interface RegisterResult {
  message: string
  requiresEmailVerification?: boolean
  email?: string
  verificationLink?: string
  delivery?: {
    delivered: boolean
    attempts: Array<{ channel: string; provider: string; delivered: boolean; error?: string }>
  }
}

interface AppStore {
  // Auth
  authResolved: boolean
  isAuthenticated: boolean
  user: User | null
  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (payload: { name: string; email: string; phone: string; password: string; referralCode?: string }) => Promise<RegisterResult>
  logout: () => Promise<void>

  // Wallet
  wallet: Wallet | null
  transactions: Transaction[]
  refreshSession: () => Promise<void>
  notifications: SessionData['notifications']
  sessions: SessionData['sessions']
  currentSessionToken: string | null
  securitySettings: SessionData['securitySettings']
  kycSubmission: SessionData['kycSubmission']
  fundingAccountEligibility: FundingAccountEligibility
  markNotificationsRead: () => Promise<void>

  // UI
  theme: Theme
  toggleTheme: () => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  activeModal: string | null
  openModal: (id: string) => void
  closeModal: () => void
  modalData: Record<string, unknown>
  setModalData: (data: Record<string, unknown>) => void

  // Toast
  toast: { message: string; type: 'success' | 'error' | 'info' } | null
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  clearToast: () => void
}

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json()
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || 'Request failed.')
  }
  return payload.data as T
}

function applySessionData(set: (partial: Partial<AppStore>) => void, data: SessionData | null) {
  if (!data) {
    set({
      authResolved: true,
      isAuthenticated: false,
      user: null,
      wallet: null,
      transactions: [],
      notifications: [],
      sessions: [],
      currentSessionToken: null,
      securitySettings: null,
      kycSubmission: null,
      fundingAccountEligibility: {
        eligible: false,
        reason: 'approved_identity_required',
        hasPermanentAccount: false,
        message: 'Submit BVN or NIN KYC and get it approved before creating a permanent funding account.',
      },
    })
    return
  }

  set({
    authResolved: true,
    isAuthenticated: true,
    user: data.user,
    wallet: data.wallet,
    transactions: data.transactions,
    notifications: data.notifications,
    sessions: data.sessions,
    currentSessionToken: data.currentSessionToken,
    securitySettings: data.securitySettings,
    kycSubmission: data.kycSubmission,
    fundingAccountEligibility: data.fundingAccountEligibility,
  })
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Auth
      isAuthenticated: false,
      authResolved: false,
      user: null,
      bootstrap: async () => {
        if (get().authResolved) return

        try {
          const res = await fetch('/api/auth', { credentials: 'include' })
          const data = await readJson<SessionData | null>(res)
          applySessionData(set, data)
        } catch {
          applySessionData(set, null)
        }
      },
      refreshSession: async () => {
        try {
          const res = await fetch('/api/auth', { credentials: 'include', cache: 'no-store' })
          const data = await readJson<SessionData | null>(res)
          applySessionData(set, data)
        } catch {
          applySessionData(set, null)
        }
      },
      login: async (email: string, password: string) => {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        })
        const data = await readJson<SessionData>(res)
        applySessionData(set, data)
      },
      register: async ({ name, email, phone, password, referralCode }) => {
        const res = await fetch('/api/auth', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name, email, phone, password, referralCode }),
        })
        return readJson<RegisterResult>(res)
      },
      logout: async () => {
        await fetch('/api/auth', { method: 'DELETE', credentials: 'include' })
        applySessionData(set, null)
      },

      // Wallet
      wallet: null,
      transactions: [],
      currentSessionToken: null,
      securitySettings: null,
      kycSubmission: null,
      fundingAccountEligibility: {
        eligible: false,
        reason: 'approved_identity_required',
        hasPermanentAccount: false,
        message: 'Submit BVN or NIN KYC and get it approved before creating a permanent funding account.',
      },
      notifications: [],
      sessions: [],
      markNotificationsRead: async () => {
        const res = await fetch('/api/notifications', {
          method: 'PATCH',
          credentials: 'include',
        })
        const data = await readJson<SessionData['notifications']>(res)
        set({ notifications: data })
      },

      // UI
      theme: 'dark',
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: next })
        document.documentElement.setAttribute('data-theme', next)
      },
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      activeModal: null,
      openModal: (id) => set({ activeModal: id }),
      closeModal: () => set({ activeModal: null, modalData: {} }),
      modalData: {},
      setModalData: (data) => set({ modalData: data }),

      // Toast
      toast: null,
      showToast: (message, type = 'success') => {
        set({ toast: { message, type } })
        setTimeout(() => set({ toast: null }), 3500)
      },
      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'mafitapay-store',
      partialize: (s) => ({ theme: s.theme }),
    }
  )
)
