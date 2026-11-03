import type { Metadata } from 'next'
import { LegalDocument, LegalSection } from '@/components/legal/LegalDocument'

export const metadata: Metadata = {
  title: 'Privacy Policy | MafitaPay',
  description: 'How MafitaPay collects, uses, protects, and shares personal information.',
}

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" updatedAt="November 3, 2026">
      <p>
        This policy explains how MafitaPay handles personal information when you use the MafitaPay website, Android app, and related support services. It applies to people who create an account, make or receive a payment, use a bill or crypto feature, contact support, or visit our public pages.
      </p>

      <LegalSection title="Information we collect">
        <p><strong className="text-[var(--text)]">Account and contact information:</strong> name, email address, phone number, account identifiers, referral details, and the authentication information needed to protect your account. If you choose password login, we store a salted password hash rather than your readable password. Email-code authentication is handled with our authentication provider.</p>
        <p><strong className="text-[var(--text)]">Identity and verification information:</strong> BVN or NIN details and, where a verification flow requires them, identity-document images and related KYC review information. Sensitive identity numbers are encrypted in our application storage. Please submit these details only through MafitaPay’s verification flow.</p>
        <p><strong className="text-[var(--text)]">Financial and transaction information:</strong> wallet and ledger entries, deposits, withdrawals, transfer recipients, bank and account details needed to make a transaction, bill-payment details, transaction references, fees, status updates, and support or dispute records.</p>
        <p><strong className="text-[var(--text)]">Crypto information:</strong> the asset, network, quote, destination address, exchange identifiers you choose to link, and on-chain transaction references. Public blockchain transactions and addresses can be visible to anyone and may remain on the relevant network permanently.</p>
        <p><strong className="text-[var(--text)]">Device and security information:</strong> session identifiers, device labels, app and operating-system details, IP address and user-agent information associated with security events, and push-notification tokens if you enable notifications. We also store settings needed to remember your preferences.</p>
        <p>Biometric unlock on Android is performed by the device’s operating system. MafitaPay does not receive your fingerprint or face template. If you register a web passkey, our service receives and stores the passkey’s public credential information, not the biometric secret used by your authenticator.</p>
      </LegalSection>

      <LegalSection title="How we use information">
        <ul className="list-disc space-y-1 pl-5">
          <li>Create and secure your account, verify your email, authenticate you, and prevent unauthorized access.</li>
          <li>Complete requested wallet, bank, bill-payment, airtime, data, and crypto transactions; provide quotes, receipts, status updates, and customer support.</li>
          <li>Complete KYC, fraud prevention, risk checks, dispute handling, accounting, and legal or regulatory recordkeeping.</li>
          <li>Operate referrals and rewards, including eligibility checks and abuse prevention.</li>
          <li>Maintain, troubleshoot, and protect the service, and notify you about security or service matters.</li>
        </ul>
      </LegalSection>

      <LegalSection title="When information is shared">
        <p>We share only information needed for the relevant purpose with service providers that help us operate MafitaPay, and with authorities or other parties where required by law or needed to protect users and the service. Depending on which features you use, these providers can include:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-[var(--text)]">Railway</strong> for application hosting and deployment, and <strong className="text-[var(--text)]">Supabase/Postgres infrastructure</strong> for application data storage where configured.</li>
          <li><strong className="text-[var(--text)]">Privy</strong> for email-based authentication and <strong className="text-[var(--text)]">Resend</strong> for service emails such as verification and security messages.</li>
          <li><strong className="text-[var(--text)]">Flutterwave</strong> and other payment or banking partners for virtual accounts, collections, transfers, and transaction processing.</li>
          <li>Bill and airtime providers, which may include <strong className="text-[var(--text)]">Bardetech, ASBData, and Amigo</strong>, to fulfil the specific service you request.</li>
          <li>Blockchain infrastructure, quote-routing, and exchange services used to create or monitor a crypto transaction. Public transaction details are also shared with the blockchain network when an on-chain transaction is submitted.</li>
          <li><strong className="text-[var(--text)]">Firebase Cloud Messaging</strong> to deliver push notifications if you enable them.</li>
        </ul>
        <p>Providers process information under their own terms and privacy notices. The provider used for a transaction may depend on availability, product, network, and the route selected by MafitaPay.</p>
      </LegalSection>

      <LegalSection title="Storage, security, and international processing">
        <p>We use access controls and technical safeguards intended to protect account and transaction information. Passwords are stored as salted hashes, and sensitive identity numbers are encrypted by the application. No online service can guarantee absolute security, so protect your sign-in details and tell us promptly if you suspect unauthorized access.</p>
        <p>MafitaPay and its service providers may process or store information in Nigeria or other countries where their systems operate. Where applicable, we take steps intended to protect information transferred across borders.</p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>We retain information for as long as needed to provide the service, maintain account and transaction records, resolve disputes, prevent fraud, and meet legal or regulatory obligations. Financial, KYC, security, and audit records may need to be retained even after an account is closed. Other information will be deleted or de-identified when it is no longer needed, subject to those obligations and technical constraints.</p>
        <p>You can request account and associated-data deletion from <a className="text-[var(--gold2)] underline" href="/delete-account">our deletion-request page</a> or in the app under Security. We may verify your identity and explain any information we must retain.</p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>You can review or correct some account details in the app, control push notifications through your device settings, and ask us about access, correction, deletion, or other rights available under applicable data-protection law. To make a request, email <a className="text-[var(--gold2)] underline" href="mailto:support@mafitapay.com">support@mafitapay.com</a>. You may also have the right to complain to the Nigeria Data Protection Commission or another competent authority.</p>
      </LegalSection>

      <LegalSection title="Children">
        <p>MafitaPay is intended for people legally able to use the financial services offered in their location. We do not knowingly invite children to create accounts. If you believe a child has provided personal information to MafitaPay, contact support.</p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>We may update this policy as the service or applicable requirements change. We will post the current version here and update its revision date. For privacy questions or requests, contact MafitaPay at <a className="text-[var(--gold2)] underline" href="mailto:support@mafitapay.com">support@mafitapay.com</a>.</p>
      </LegalSection>
    </LegalDocument>
  )
}
