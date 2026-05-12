# MafitaPay — Digital Finance Platform

> Secure NGN wallet, P2P trading, crypto exchange, and bill payments — built for Nigerians.

## Tech Stack

| Layer       | Technology |
|-------------|------------|
| Framework   | Next.js 15 (App Router) |
| Language    | TypeScript |
| Styling     | Tailwind CSS + CSS Variables |
| State       | Zustand (with persistence) |
| Icons       | Lucide React |
| Fonts       | Playfair Display, DM Sans, Space Mono |

---

## Project Structure

```
mafitapay/
├── app/
│   ├── (auth)/
│   │   ├── login/          Login with email + PIN
│   │   └── register/       2-step account creation
│   ├── (dashboard)/
│   │   ├── dashboard/      Main overview
│   │   ├── history/        Transaction history + filters
│   │   ├── p2p/            P2P marketplace (deposit/withdraw)
│   │   ├── crypto/         Live rates, buy & sell
│   │   ├── bills/          Airtime, data, electric, cable...
│   │   ├── profile/        KYC, account settings
│   │   ├── referrals/      Referral code + history
│   │   └── security/       PIN, 2FA, sessions, limits
│   ├── api/
│   │   ├── auth/           POST /api/auth
│   │   ├── user/           GET/PATCH /api/user
│   │   ├── wallet/
│   │   │   ├── balance/    GET /api/wallet/balance
│   │   │   ├── send/       POST /api/wallet/send
│   │   │   └── withdraw/   POST /api/wallet/withdraw
│   │   ├── transactions/   GET /api/transactions
│   │   ├── p2p/            GET/POST /api/p2p
│   │   ├── crypto/         GET/POST /api/crypto
│   │   └── bills/          POST /api/bills
│   ├── layout.tsx          Root layout with fonts
│   ├── page.tsx            Redirect to /dashboard or /login
│   ├── not-found.tsx       404 page
│   └── error.tsx           Global error boundary
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx     Desktop sidebar with Lucide icons
│   │   ├── Topbar.tsx      Sticky header with search + notifications
│   │   ├── Ticker.tsx      Yoruba proverb + live rate ticker
│   │   ├── MobileNav.tsx   Bottom tab bar for mobile
│   │   └── DashboardLayout.tsx  Full layout wrapper
│   ├── ui/
│   │   ├── Button.tsx      Primary, secondary, green, danger, ghost
│   │   ├── Card.tsx        Card, CardHeader, CardTitle, CardAction
│   │   ├── Modal.tsx       Accessible modal with ESC + backdrop close
│   │   ├── Input.tsx       Labelled input with prefix/suffix
│   │   ├── Badge.tsx       success, pending, failed, info
│   │   ├── PinPad.tsx      4-digit PIN entry with numpad
│   │   ├── Skeleton.tsx    Loading placeholders
│   │   ├── Toast.tsx       Global toast notifications
│   │   └── ErrorBoundary.tsx  Class-based error boundary
│   ├── dashboard/
│   │   ├── WalletHero.tsx  Balance display + action buttons + virtual account
│   │   ├── StatCards.tsx   4-up stats (deposits, withdrawals, P2P, crypto)
│   │   ├── QuickActions.tsx 5 quick action tiles
│   │   ├── ActivityChart.tsx  Bar chart (week/month/year toggle)
│   │   ├── RecentTransactions.tsx  Last 5 transactions table
│   │   ├── CryptoRates.tsx  Live rate widget
│   │   ├── P2PWidget.tsx   Merchant quick-select
│   │   └── ServicesGrid.tsx  8 bill service tiles
│   └── modals/
│       ├── SendModal.tsx    5-step: form → review → PIN → processing → success
│       ├── DepositModal.tsx Virtual account display
│       ├── WithdrawModal.tsx Merchant selector + amount
│       ├── P2PModal.tsx    Merchant account + countdown timer
│       ├── BuyModal.tsx    Asset picker + live conversion + PIN
│       ├── SellModal.tsx   Sell flow with exchange/wallet selector + deposit screen
│       ├── BillsModal.tsx  Dynamic bill form (8 service types)
│       ├── SuccessModal.tsx Generic success with transaction ref
│       └── ModalManager.tsx Centralized modal router
├── hooks/
│   ├── useTheme.ts         Theme toggle with DOM sync
│   ├── useWallet.ts        Wallet data + formatted balance
│   ├── useTransactions.ts  Filtered transaction list
│   ├── useModal.ts         Modal open/close/data helpers
│   └── useClipboard.ts     Clipboard copy with feedback
├── lib/
│   ├── constants.ts        Crypto assets, P2P merchants, bill providers, mock data
│   └── utils.ts            formatNGN, formatCrypto, generateRef, sleep, fmtDate
├── store/
│   └── index.ts            Zustand store (auth, wallet, UI, modals, toasts)
├── types/
│   └── index.ts            All TypeScript interfaces
├── middleware.ts            Auth redirect guard
└── tailwind.config.ts      Tailwind with CSS variable tokens
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to `/login`.

**Demo credentials:** any email + any password (demo mode)

---

## Design System

### Colour Tokens

| Token       | Dark Mode  | Light Mode | Usage              |
|-------------|------------|------------|--------------------|
| `--char`    | `#0D0D14`  | `#F0F0F8`  | Page background    |
| `--coal`    | `#13131F`  | `#FFFFFF`  | Card surface       |
| `--clay`    | `#1A1A2E`  | `#EAEAF4`  | Elevated surface   |
| `--clay2`   | `#22223A`  | `#E0E0EE`  | Input background   |
| `--border`  | `#2E2E4A`  | `#C8C8E0`  | Dividers           |
| `--gold`    | `#4F46E5`  | same       | Primary accent     |
| `--gold2`   | `#818CF8`  | same       | Accent bright      |
| `--green`   | `#2EAA5C`  | same       | Success / NGN      |
| `--red`     | `#C4341A`  | same       | Error / Danger     |
| `--text`    | `#E8E8F0`  | `#0D0D1E`  | Primary text       |
| `--text2`   | `#9898C0`  | `#3A3A6A`  | Secondary text     |
| `--muted`   | `#60607A`  | `#7070A0`  | Placeholder        |

### Typography

- **Display** — Playfair Display (headers, balances, logos)
- **Body** — DM Sans (all UI text)
- **Mono** — Space Mono (amounts, references, addresses)

### Adinkra Identity

The design uses West African Adinkra symbols as background texture:
- **Gye Nyame** — "Except God" (omnipotence)
- **Sankofa** — "Return and fetch it" (learning from the past)
- **Dwennimmen** — Ram's horns (strength with humility)
- **Aya** — Fern (endurance)
- **Kente diamonds** — Geometric weave motif

---

## Features

### 💰 Wallet
- NGN balance with show/hide toggle
- Virtual account (Moniepoint, OPay, PalmPay)
- Deposit via bank transfer
- Send to MafitaPay tags or email (5-step flow with PIN)
- Withdraw via P2P merchant network

### 🔄 P2P Trading
- Verified merchant marketplace
- Completion rate + trade count displayed
- 30-minute order countdown timer
- Deposit: get merchant bank account, transfer, confirm
- Withdraw: choose merchant, amount, merchant sends to your bank

### ₿ Crypto
- Live NGN rates for USDT, ETH, BTC
- Buy: asset picker → amount → wallet address → PIN → processing → success
- Sell: asset picker → amount → exchange/wallet selector → deposit address + QR → confirm sent → success

### 📱 Bills & Airtime
- MTN, Airtel, Glo, 9Mobile airtime
- Mobile data bundles
- EKEDC/IKEDC electricity (meter number)
- DStv / GOTV cable
- Education, gas, insurance, water
- All instant delivery, zero processing fee

### 👥 Referrals
- Unique referral code per user
- ₦200 credited to both parties on first transaction
- Full referral history with earnings

### 🔐 Security
- 4-digit transaction PIN
- Biometric login support
- 2FA (SMS / Authenticator)
- Active session management with remote revoke
- Daily transaction limits (upgradeable via KYC)

---

## API Reference

| Method | Endpoint                | Description          |
|--------|-------------------------|----------------------|
| POST   | `/api/auth`             | Login                |
| GET    | `/api/user`             | Get user profile     |
| PATCH  | `/api/user`             | Update profile       |
| GET    | `/api/wallet/balance`   | Get wallet balance   |
| POST   | `/api/wallet/send`      | Send money           |
| POST   | `/api/wallet/withdraw`  | Withdraw request     |
| GET    | `/api/transactions`     | List transactions    |
| GET    | `/api/p2p`              | List P2P merchants   |
| POST   | `/api/p2p`              | Create P2P order     |
| GET    | `/api/crypto`           | Get crypto rates     |
| POST   | `/api/crypto`           | Place crypto order   |
| POST   | `/api/bills`            | Pay a bill           |

---

## Roadmap

- [ ] WebSocket live rate updates
- [ ] Real bank verification (Paystack/Flutterwave)
- [ ] KYC document upload (Smile Identity)
- [ ] Push notifications (OneSignal)
- [ ] Multi-currency support (USD, GBP)
- [ ] Savings / Investment vault
- [ ] Business accounts
- [ ] Admin dashboard

---

*Built with the Ankara Market Night palette — indigo, green, and kente gold.*
