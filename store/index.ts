import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { readJsonResponse } from '@/lib/client/http'
import { CryptoDepositAddress, FundingAccountEligibility, Theme, Transaction, User, Wallet } from '@/types'

interface SessionData {
  user: User
  wallet: Wallet | null
  transactions: Transaction[]
  currentSessionToken: string | null
  transferFeeMarginNgn?: number
  securitySettings: {
    userId: string
    transactionPinEnabled: boolean
    hasTransactionPin: boolean
    transactionPinLockedUntil?: string
    twoFactorEnabled: boolean
    biometricEnabled: boolean
    hasBiometricCredential: boolean
    biometricCredentialCount: number
    biometricCredentialLabel?: string
    biometricLastVerifiedAt?: string
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
  cryptoDepositAddresses: CryptoDepositAddress[]
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
  cryptoDepositAddresses: CryptoDepositAddress[]
  /** Server-resolved transfer margin, so fee quotes match what will actually be debited. */
  transferFeeMarginNgn: number | null
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
  return readJsonResponse<T>(res)
}

// Backoff for retrying the session read, capped so a long offline stretch settles into one quiet
// request every few seconds rather than a hot loop.
const SESSION_RETRY_DELAYS_MS = [400, 1_000, 2_500, 5_000, 10_000]

function sessionRetryDelay(attempt: number) {
  return SESSION_RETRY_DELAYS_MS[Math.min(attempt, SESSION_RETRY_DELAYS_MS.length - 1)]
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Guards against a second bootstrap loop starting while the first is still retrying. */
let bootstrapInFlight = false

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
        message: 'Submit BVN or NIN KYC and get it approved before creating a secondary Flutterwave funding account.',
      },
      cryptoDepositAddresses: [],
      transferFeeMarginNgn: null,
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
    cryptoDepositAddresses: data.cryptoDepositAddresses ?? [],
    transferFeeMarginNgn: typeof data.transferFeeMarginNgn === 'number' ? data.transferFeeMarginNgn : null,
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
        if (get().authResolved || bootstrapInFlight) return
        bootstrapInFlight = true

        // `GET /api/auth` answers 200 with `data: null` when there is genuinely no session, so a
        // throw here never means "signed out" -- it means the request did not complete: the radio
        // still waking after the phone slept, a Railway cold start, a proxy timeout. Reporting that
        // as signed-out is what sent authenticated users to the login page on resume, because
        // DashboardLayout pushes /login the moment authResolved flips with no session.
        //
        // Leaving authResolved false instead holds the brand splash, which is the honest state: we
        // do not yet know. Retry until the server actually answers.
        try {
          for (let attempt = 0; ; attempt += 1) {
            try {
              const res = await fetch('/api/auth', { credentials: 'include' })
              applySessionData(set, await readJson<SessionData | null>(res))
              return
            } catch {
              await sleep(sessionRetryDelay(attempt))
            }
          }
        } finally {
          bootstrapInFlight = false
        }
      },
      refreshSession: async () => {
        try {
          const res = await fetch('/api/auth', { credentials: 'include', cache: 'no-store' })
          applySessionData(set, await readJson<SessionData | null>(res))
        } catch {
          // Same reasoning as bootstrap: a throw means the request failed, not that the session
          // ended, so keep the state we already have. This runs every 20s and on every resume and
          // window focus, so clearing it on one blip signed people out mid-flow -- including right
          // after a withdrawal or deposit, where callers refresh to pick up the new balance.
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
        try {
          const { unregisterPushNotifications } = await import('@/lib/client/native-push')
          await unregisterPushNotifications()
        } catch {
          // ignore
        }
        await fetch('/api/auth', { method: 'DELETE', credentials: 'include' })
        try {
          const { clearBiometricSession } = await import('@/lib/client/native-biometric')
          clearBiometricSession()
        } catch {
          // ignore
        }
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
        message: 'Submit BVN or NIN KYC and get it approved before creating a secondary Flutterwave funding account.',
      },
      cryptoDepositAddresses: [],
      transferFeeMarginNgn: null,
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
