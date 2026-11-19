# Canton Coin integration readiness

Status: discovery and provider evaluation. No Canton asset is enabled in the app.

## Current MafitaPay boundaries

- Crypto catalog pairs and their pricing live in `crypto_pairs` and are exposed through `CryptoAsset`.
- Orders use provider-specific execution rails; `CryptoOrder.executionRail` currently has no Canton rail.
- Deposit address families are EVM, Solana, TON, NEAR, and Sui. Canton party IDs do not fit those address formats.
- Deposit monitoring and settlement are implemented through chain-specific scanners and provider webhooks. Canton deposits cannot safely be credited by reusing an EVM scanner or a generic address check.
- Admin network choices are explicit. Adding Canton there before transfers and deposit processing exist could make an incomplete pair look operational.

Relevant code: `types/index.ts`, `lib/server/crypto-deposit-addresses.ts`, `lib/server/crypto-deposit-scanner.ts`, `lib/server/crypto-execution.ts`, and `app/(dashboard)/admin/admin-config.ts`.

## Canton-specific behavior to account for

- A Canton account is a party hosted on a validator, rather than a conventional public-chain address.
- CC uses 10 decimal places.
- A party needs to be allocated and have a CC transfer pre-approval before it can receive CC directly. Without pre-approval, incoming transfers may be offers requiring acceptance.
- Transfers may be direct or two-step; settlement tracking needs to represent offer, acceptance/rejection/withdrawal, and completion states.
- Canton finality and balance/history reads come through the Canton ledger/validator APIs or a custody provider, not an EVM JSON-RPC scanner.
- Validator traffic costs and provider fees need to be accounted for separately from a gas fee model.

These constraints follow the [Canton Network Token Standard](https://github.com/canton-foundation/cips/blob/main/cip-0056/cip-0056.md), [Splice Validator API docs](https://docs.global.canton.network.sync.global/app_dev/validator_api/index.html), and provider documentation for [Dfns](https://www.canton.network/blog/introducing-dfns-institutional-grade-custody-and-wallet-infrastructure-on-canton-network) and [Ripple Custody](https://docs.ripple.com/products/custody/accounts-and-assets/blockchains/canton).

## Decisions required before enabling CC

1. **Provider and operating model:** Dfns-managed wallet infrastructure, BitGo custody/trading, Ripple Custody plus a MafitaPay or node-provider validator, or another provider. Verify Nigeria onboarding and commercial terms directly.
2. **Customer account model:** one provider party per customer, pooled MafitaPay treasury party with internal attribution, or another approved model. This affects privacy, reconciliation, and deposit identification.
3. **Initial customer flows:** price display, buy, sell/deposit, withdrawal, or a limited subset. A market price feed alone does not establish buy/sell liquidity or custody support.
4. **Inbound transfer lifecycle:** provider webhooks/events, confirmation/finality semantics, transfer-offer handling, duplicate delivery behavior, and manual reconciliation path.
5. **Outbound controls:** approval policy, allowlists, limits, reversal/failed-order handling, and provider-reported fees.

## Safe implementation sequence

1. Confirm provider API, access model, pricing, validator responsibility, and sandbox/mainnet environment.
2. Add a Canton provider adapter behind the existing crypto order/deposit domain, with explicit CC precision and party-ID validation. Do not route through the EVM scanner.
3. Add persistence for provider account/party mapping and idempotent Canton transfer events only after agreeing the customer account model. Review the Postgres migration and reconciliation design before changing the production schema.
4. Add admin visibility and operating controls while customer buy/sell remain disabled.
5. Test account setup, direct receipt, transfer offers, duplicate/out-of-order events, rejected/withdrawn transfers, and reconciliation against provider sandbox or test environment.
6. Enable a small controlled cohort only after the provider confirms mainnet readiness and operational support.

Until steps 1–3 are settled, do not add Canton as a selectable live network, create customer CC deposit instructions, or enable CC buy/sell. A price-only listing can be evaluated separately, but should be clearly marked as informational and must not imply that MafitaPay can custody or transfer CC.
