'use client'
import { useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { readJsonResponse } from '@/lib/client/http'
import type { BankDirectoryEntry, Beneficiary } from '@/types'

export type BankAccountValue = {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}

// Probed in this order when the account number is new. Ranked by how often Nigerian
// transfers land at each bank, so the first call usually hits. Intersected with the live
// directory below, so a code the provider has dropped is never sent.
const POPULAR_BANK_CODES = ['999992', '058', '044', '011', '057', '033', '999991', '50211', '090405']

const MAX_PROBE_CANDIDATES = 6

type ProbeState = 'idle' | 'probing' | 'resolved' | 'unresolved' | 'error'

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

function isComplete(accountNumber: string) {
  return /^\d{10}$/.test(accountNumber)
}

function rankCandidates(banks: BankDirectoryEntry[], beneficiaries: Beneficiary[]) {
  const byCode = new Map(banks.map(bank => [bank.code, bank]))
  const ordered: BankDirectoryEntry[] = []
  const seen = new Set<string>()

  const push = (code: string) => {
    if (!code || seen.has(code)) return
    const bank = byCode.get(code)
    if (!bank) return
    seen.add(code)
    ordered.push(bank)
  }

  const recentFirst = [...beneficiaries]
    .filter(item => item.kind === 'bank' && item.bankCode)
    .sort((a, b) => (b.lastUsedAt || b.updatedAt || '').localeCompare(a.lastUsedAt || a.updatedAt || ''))

  recentFirst.forEach(item => push(item.bankCode || ''))
  POPULAR_BANK_CODES.forEach(push)

  return ordered.slice(0, MAX_PROBE_CANDIDATES)
}

export function BankAccountPicker({
  banks,
  beneficiaries,
  value,
  onChange,
  disabled,
}: {
  banks: BankDirectoryEntry[]
  beneficiaries: Beneficiary[]
  value: BankAccountValue
  onChange: (next: BankAccountValue) => void
  disabled?: boolean
}) {
  const [bankQuery, setBankQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [probeState, setProbeState] = useState<ProbeState>('idle')
  const [probeMessage, setProbeMessage] = useState('')
  const [detectedBank, setDetectedBank] = useState(false)
  const probeSequence = useRef(0)

  const savedBankAccounts = useMemo(
    () => beneficiaries.filter(item => item.kind === 'bank' && item.accountNumber),
    [beneficiaries]
  )

  const savedMatch = useMemo(
    () => savedBankAccounts.find(item => item.accountNumber === value.accountNumber),
    [savedBankAccounts, value.accountNumber]
  )

  const filteredBanks = useMemo(() => {
    const query = bankQuery.trim().toLowerCase()
    if (!query) return banks
    return banks.filter(bank => bank.name.toLowerCase().includes(query) || bank.code.includes(query))
  }, [banks, bankQuery])

  const recentBankCodes = useMemo(() => {
    const codes = [...savedBankAccounts]
      .sort((a, b) => (b.lastUsedAt || b.updatedAt || '').localeCompare(a.lastUsedAt || a.updatedAt || ''))
      .map(item => item.bankCode)
      .filter((code): code is string => Boolean(code))
    return [...new Set(codes)].slice(0, 4)
  }, [savedBankAccounts])

  // Resolution runs from the handlers below rather than an effect: every trigger is a user action
  // (finishing the number, picking a bank), so there is nothing to synchronise against.
  async function runProbe(accountNumber: string, candidates: BankDirectoryEntry[]) {
    if (candidates.length === 0) {
      setProbeState('unresolved')
      setProbeMessage('Pick your bank below.')
      return
    }

    const sequence = ++probeSequence.current
    setProbeState('probing')
    setProbeMessage(candidates.length === 1 ? 'Verifying account…' : 'Looking up account…')

    try {
      const response = await fetch('/api/banks/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountNumber,
          candidates: candidates.map(candidate => ({ code: candidate.code, name: candidate.name })),
        }),
      })
      const data = await readJsonResponse<{
        resolutionEnabled?: boolean
        match?: BankAccountValue | null
      }>(response)
      if (sequence !== probeSequence.current) return

      if (data.match) {
        onChange(data.match)
        setDetectedBank(candidates.length > 1)
        setProbeState('resolved')
        setProbeMessage('')
        return
      }

      setDetectedBank(false)
      setProbeState('unresolved')
      if (data.resolutionEnabled === false) {
        setProbeMessage('Pick your bank below.')
      } else if (candidates.length === 1) {
        setProbeMessage('That account number was not found at this bank. Check it and try again.')
      } else {
        setProbeMessage('Could not detect the bank — pick it below.')
      }
    } catch {
      if (sequence !== probeSequence.current) return
      setProbeState('error')
      setProbeMessage('Verification is unavailable right now. Pick your bank below.')
    }
  }

  function applyAccountNumber(raw: string) {
    const accountNumber = digitsOnly(raw)
    // Cancel any probe still in flight for the previous number.
    probeSequence.current += 1
    setDetectedBank(false)
    setProbeMessage('')

    const match = savedBankAccounts.find(item => item.accountNumber === accountNumber)
    if (match) {
      // Already verified against this bank, so skip the provider round-trip entirely.
      onChange({
        bankCode: match.bankCode || '',
        bankName: match.bankName || '',
        accountNumber,
        accountName: match.accountName || '',
      })
      setDetectedBank(true)
      setProbeState('resolved')
      return
    }

    onChange({ ...value, accountNumber, accountName: '' })
    setProbeState('idle')

    // Auto-probe as soon as the number is complete. If a bank is already chosen, verify against
    // that one alone rather than guessing.
    if (!disabled && isComplete(accountNumber)) {
      const chosen = value.bankCode ? banks.find(bank => bank.code === value.bankCode) : undefined
      void runProbe(accountNumber, chosen ? [chosen] : rankCandidates(banks, beneficiaries))
    }
  }

  function pickBank(bank: BankDirectoryEntry) {
    onChange({ ...value, bankCode: bank.code, bankName: bank.name, accountName: '' })
    setBankQuery('')
    setListOpen(false)
    setDetectedBank(false)
    setProbeState('idle')
    setProbeMessage('')

    // Picking a bank is enough to verify a complete number, so do it rather than making the user
    // re-touch the field.
    if (!disabled && isComplete(value.accountNumber)) {
      void runProbe(value.accountNumber, [bank])
    }
  }

  return (
    <div className="space-y-3">
      <Input
        label="Account Number"
        placeholder="0123456789"
        inputMode="numeric"
        autoComplete="off"
        value={value.accountNumber}
        disabled={disabled}
        onChange={event => applyAccountNumber(event.target.value)}
      />
      {savedMatch && probeState !== 'resolved' && (
        <div className="flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--clay2)] p-2.5">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[1px] text-[var(--muted)]">Saved beneficiary</div>
            <div className="truncate text-[11px] font-semibold text-[var(--text)]">{savedMatch.label}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange({
                bankCode: savedMatch.bankCode || '',
                bankName: savedMatch.bankName || '',
                accountNumber: value.accountNumber,
                accountName: savedMatch.accountName || '',
              })
              setDetectedBank(true)
              setProbeState('resolved')
              setProbeMessage('')
            }}
            className="shrink-0 text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--gold2)] underline"
          >
            Use saved
          </button>
        </div>
      )}

      <div className="relative">
        <Input
          label="Bank"
          placeholder={value.bankName || 'Search banks…'}
          value={listOpen ? bankQuery : (value.bankName || '')}
          disabled={disabled}
          onChange={event => {
            setBankQuery(event.target.value)
            setListOpen(true)
          }}
          onFocus={() => {
            setBankQuery('')
            setListOpen(true)
          }}
          onBlur={() => globalThis.setTimeout(() => setListOpen(false), 150)}
          suffix={detectedBank ? 'AUTO' : '⌄'}
        />
        {listOpen && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto border border-[var(--border)] bg-[var(--clay)] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.5)]">
            {recentBankCodes.length > 0 && !bankQuery.trim() && (
              <div className="border-b border-[var(--border)] px-3 pb-1 pt-2">
                <div className="mb-1 text-[8px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recently used</div>
                {recentBankCodes.map(code => {
                  const bank = banks.find(item => item.code === code)
                  if (!bank) return null
                  return (
                    <button
                      key={code}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => pickBank(bank)}
                      className="flex w-full items-center justify-between px-1 py-1.5 text-left text-[11px] text-[var(--text)] hover:bg-[var(--clay2)]"
                    >
                      {bank.name}
                    </button>
                  )
                })}
              </div>
            )}
            {filteredBanks.map(bank => (
              <button
                key={bank.code}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onClick={() => pickBank(bank)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2.5 text-left text-[11px] transition-colors hover:bg-[var(--clay2)]',
                  value.bankCode === bank.code ? 'bg-[rgba(79,70,229,.08)]' : ''
                )}
              >
                <span className="text-[var(--text)]">{bank.name}</span>
                {value.bankCode === bank.code && <span className="text-[9px] font-bold text-[var(--gold2)]">Selected</span>}
              </button>
            ))}
            {filteredBanks.length === 0 && (
              <div className="px-3 py-2.5 text-[10px] text-[var(--muted)]">No banks match “{bankQuery}”.</div>
            )}
          </div>
        )}
      </div>

      {probeState === 'probing' && (
        <div className="text-[10px] text-[var(--muted)]">{probeMessage}</div>
      )}
      {probeState === 'resolved' && value.accountName && (
        <div className="border border-[var(--green)] bg-[rgba(34,197,94,.08)] p-2.5">
          <div className="text-[8px] uppercase tracking-[1px] text-[var(--green2)]">Account name</div>
          <div className="text-[12px] font-bold text-[var(--text)]">{value.accountName}</div>
        </div>
      )}
      {probeState === 'unresolved' && (
        <div className="text-[10px] text-[var(--muted)]">{probeMessage}</div>
      )}
      {probeState === 'error' && (
        <div className="text-[10px] text-[var(--red2)]">{probeMessage}</div>
      )}
    </div>
  )
}
