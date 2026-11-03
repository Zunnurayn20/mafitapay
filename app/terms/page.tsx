import type { Metadata } from 'next'
import { LegalDocument, LegalSection } from '@/components/legal/LegalDocument'

export const metadata: Metadata = {
  title: 'Terms of Service | MafitaPay',
  description: 'Terms for using MafitaPay accounts, payments, bills, crypto features, and rewards.',
}

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" updatedAt="November 3, 2026">
      <p>
        These Terms apply when you access or use MafitaPay’s website, Android app, wallet, payment, bill, crypto, referral, or support features. By creating an account or using a feature, you agree to these Terms and the <a className="text-[var(--gold2)] underline" href="/privacy">Privacy Policy</a>. If you do not agree, do not use the service.
      </p>

      <LegalSection title="Who may use MafitaPay">
        <p>You must be legally able to enter into a binding agreement and meet the eligibility requirements that apply to the service and your location. You must provide accurate and current account details, keep them updated, and use only accounts, payment methods, and identity information you are authorized to use. We may ask for verification before enabling or continuing some services.</p>
      </LegalSection>

      <LegalSection title="Your account and security">
        <p>You are responsible for activity performed through your account and for keeping your password, email access, device, transaction PIN, and recovery methods secure. Do not share authentication codes or transaction PINs. Contact support promptly if you suspect that your account or device has been accessed without permission.</p>
        <p>We may pause, limit, or close access where necessary to protect an account, investigate suspected fraud or misuse, comply with provider requirements, or meet legal obligations. You may deactivate your account in Security settings and request account deletion through the in-app or web deletion path.</p>
      </LegalSection>

      <LegalSection title="Transactions, quotes, and providers">
        <p>Before you confirm a transaction, review the recipient, asset or service, network, amount, rate, and displayed fees. Quotes may expire or change before confirmation. MafitaPay may use banks, payment companies, bill vendors, exchanges, blockchain infrastructure, and other providers to fulfil requested transactions. Their availability, processing times, terms, and checks may apply in addition to these Terms.</p>
        <p>A transaction can take time to complete and may show pending or processing while MafitaPay or a provider confirms its result. Do not repeat a transaction merely because its status has not refreshed. Check the transaction details or contact support. If a provider rejects or cannot complete a request, the final status and any balance adjustment will follow the transaction’s actual outcome.</p>
        <p>Fees, rates, and amounts are shown in the app where available. Market values and estimates are informational and may differ from the final execution amount. We will not knowingly present a quote as guaranteed where it can change before execution.</p>
      </LegalSection>

      <LegalSection title="Wallet and bank services">
        <p>Wallet balances and transaction records in MafitaPay reflect the service’s available records and may be subject to verification, provider settlement, limits, reversals, or legal restrictions. Virtual account and bank-transfer features may be supplied by partner institutions. A displayed account number or transfer status does not change the terms of the partner providing that account or payment rail.</p>
        <p>You authorize MafitaPay and relevant providers to process the information and instructions needed to execute a transaction you submit. Check the recipient and amount carefully before approval.</p>
      </LegalSection>

      <LegalSection title="Crypto features and external addresses">
        <p>Crypto assets are volatile and may lose value. MafitaPay does not provide investment, tax, or legal advice. Prices and availability can change quickly, and crypto transactions may be delayed by providers or network conditions.</p>
        <p>For crypto sent to an external address, you are responsible for entering an address that supports the selected asset and network. Blockchain transfers are generally irreversible after confirmation. Network fees may apply. Do not send an asset over a different network from the one shown in the transaction flow.</p>
        <p>Crypto services may be limited or unavailable in some locations and may require additional identity checks. Use them only where permitted by applicable law and the rules of the relevant provider or network.</p>
      </LegalSection>

      <LegalSection title="Bills, airtime, and data">
        <p>Check the phone number, provider, plan, subscriber or meter details, and amount before submitting a purchase. Delivery and reversal depend on the relevant operator or provider. Some completed purchases may not be reversible.</p>
      </LegalSection>

      <LegalSection title="Referrals and rewards">
        <p>Referral and reward offers are subject to the eligibility rules, limits, and conditions shown in MafitaPay. We may review an award and withhold, reverse, or reject it where activity is duplicate, misleading, abusive, or otherwise ineligible. Rewards are not cash unless the applicable offer expressly says so; available uses and limits are shown in the app.</p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You may not use MafitaPay to break the law, deceive another person, interfere with the service, evade verification or transaction controls, submit false information, exploit a technical fault, or access another user’s account or data. You may not use the service to facilitate fraud, money laundering, sanctions evasion, or other prohibited activity.</p>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>We work to keep MafitaPay available but do not promise uninterrupted access. Maintenance, provider outages, network congestion, security events, or legal requirements may affect a feature. We may modify or discontinue features, subject to applicable law and any transaction already in progress.</p>
      </LegalSection>

      <LegalSection title="Liability and applicable law">
        <p>Nothing in these Terms removes a right or remedy that cannot lawfully be excluded. To the extent permitted by applicable law, MafitaPay is not responsible for indirect losses, third-party provider failures, or losses caused by incorrect details supplied by you, except where the law requires otherwise. These Terms are governed by the laws applicable in Nigeria, without limiting any mandatory consumer protections that apply to you.</p>
      </LegalSection>

      <LegalSection title="Updates and contact">
        <p>We may revise these Terms when the service or applicable requirements change. The current version and revision date will appear on this page. Continued use after an update means you accept the revised Terms where the law permits that result. For questions or complaints, contact <a className="text-[var(--gold2)] underline" href="mailto:support@mafitapay.com">support@mafitapay.com</a>.</p>
      </LegalSection>
    </LegalDocument>
  )
}
