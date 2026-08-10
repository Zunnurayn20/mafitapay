'use client'
import { useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { useAppStore } from '@/store'
import {
  getSupportMailtoUrl,
  getWhatsAppUrl,
  socialChannels,
  supportContact,
  type SocialChannel,
} from '@/lib/support-contact'
import { Copy, Mail, MessageCircle } from 'lucide-react'

const WHATSAPP_PREFILL = 'Hi MafitaPay support, I need help with '
const EMAIL_SUBJECT = 'MafitaPay support request'

/**
 * Brand marks for the social row. Lucide dropped its brand icons, so these are inline paths --
 * currentColor throughout so they follow the theme like every other icon on the page.
 */
const SOCIAL_ICONS: Record<SocialChannel['key'], React.ReactNode> = {
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  twitter: (
    <path d="M4 3h4.2l4.1 5.6L17.2 3H21l-6.5 7.6L21.4 21h-4.2l-4.5-6.1L7.4 21H3.6l7-8.1L4 3z" fill="currentColor" stroke="none" />
  ),
  facebook: (
    <path d="M14.5 8.5h2.2V5.6h-2.6c-2.3 0-3.7 1.4-3.7 3.8v1.8H8v2.9h2.4V21h3.1v-6.9h2.4l.4-2.9h-2.8V9.8c0-.9.3-1.3 1-1.3z" fill="currentColor" stroke="none" />
  ),
  tiktok: (
    <path d="M16.2 3c.4 2 1.6 3.4 3.6 3.6v2.7c-1.3.1-2.6-.3-3.7-1v5.9c0 4.4-4.4 6.9-8 4.6-2.4-1.5-2.9-4.9-1-7 1.3-1.4 3.2-1.9 4.9-1.3v2.9c-1.6-.5-3 .8-2.5 2.3.4 1.4 2.2 1.8 3.2.7.4-.4.5-.9.5-1.5V3h3z" fill="currentColor" stroke="none" />
  ),
}

function SocialIcon({ channel }: { channel: SocialChannel }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SOCIAL_ICONS[channel.key]}
    </svg>
  )
}

export default function SupportPage() {
  const { showToast } = useAppStore()
  const [copied, setCopied] = useState<'email' | 'whatsapp' | null>(null)

  async function copyValue(kind: 'email' | 'whatsapp', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      globalThis.setTimeout(() => setCopied(current => (current === kind ? null : current)), 2000)
    } catch {
      showToast('Could not copy. Long-press to copy instead.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <Card pattern="soft">
        <CardHeader>
          <CardTitle>Contact Support</CardTitle>
        </CardHeader>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[11px] leading-relaxed text-[var(--text2)]">
            Our team is here for transaction issues, KYC, and anything else. WhatsApp is the fastest
            way to reach us. Never share your PIN or password — we will never ask for them.
          </p>

          <div className="mt-4 space-y-2.5">
            <div className="flex items-center gap-3 border border-[var(--border)] bg-[var(--clay2)] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(34,197,94,.12)] text-[var(--green)]">
                <MessageCircle size={17} strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">WhatsApp</div>
                <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--text)]">{supportContact.whatsappDisplay}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyValue('whatsapp', `+${supportContact.whatsappNumber}`)}
                className="shrink-0 cursor-pointer border border-[var(--border)] bg-[var(--clay)] px-2.5 py-2 text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--text2)] transition-colors hover:border-[var(--gold2)] hover:text-[var(--text)]"
              >
                {copied === 'whatsapp' ? 'Copied' : <Copy size={12} strokeWidth={2} />}
              </button>
              <a
                href={getWhatsAppUrl(WHATSAPP_PREFILL)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 bg-[var(--green)] px-3.5 py-2 text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--char)] transition-opacity hover:opacity-90"
              >
                Chat
              </a>
            </div>

            <div className="flex items-center gap-3 border border-[var(--border)] bg-[var(--clay2)] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(202,165,96,.12)] text-[var(--gold2)]">
                <Mail size={17} strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Email</div>
                <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--text)]">{supportContact.email}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyValue('email', supportContact.email)}
                className="shrink-0 cursor-pointer border border-[var(--border)] bg-[var(--clay)] px-2.5 py-2 text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--text2)] transition-colors hover:border-[var(--gold2)] hover:text-[var(--text)]"
              >
                {copied === 'email' ? 'Copied' : <Copy size={12} strokeWidth={2} />}
              </button>
              <a
                href={getSupportMailtoUrl(EMAIL_SUBJECT)}
                className="shrink-0 bg-[var(--gold)] px-3.5 py-2 text-[9px] font-bold uppercase tracking-[0.8px] text-white transition-colors hover:bg-[var(--terra2)]"
              >
                Email
              </a>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Follow MafitaPay</CardTitle>
        </CardHeader>
        <div className="px-4 py-4 sm:px-5">
          <div className="grid grid-cols-2 gap-2">
            {socialChannels.map(channel => (
              <a
                key={channel.key}
                href={channel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 border border-[var(--border)] bg-[var(--clay2)] px-3 py-2.5 transition-colors hover:border-[var(--gold2)]"
              >
                <span className="text-[var(--gold2)]"><SocialIcon channel={channel} /></span>
                <span className="min-w-0">
                  <span className="block text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">{channel.label}</span>
                  <span className="block truncate text-[11px] font-semibold text-[var(--text)]">@{channel.handle}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
