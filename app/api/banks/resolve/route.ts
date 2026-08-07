import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getFlutterwaveResolutionConfigState, resolveBankBeneficiary } from '@/lib/server/bank-resolution'
import { normalizeAccountNumber } from '@/lib/server/validation'

const MAX_CANDIDATES = 6

type Candidate = { code: string; name: string }

function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (code.length < 2 || name.length < 2 || seen.has(code)) continue
    seen.add(code)
    candidates.push({ code, name })
    if (candidates.length >= MAX_CANDIDATES) break
  }
  return candidates
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body.', success: false }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const accountNumber = normalizeAccountNumber(
    typeof payload.accountNumber === 'string' ? payload.accountNumber : ''
  )

  if (!/^\d{10}$/.test(accountNumber)) {
    return NextResponse.json({ error: 'Account number must be exactly 10 digits.', success: false }, { status: 400 })
  }

  const { resolutionEnabled } = getFlutterwaveResolutionConfigState()
  if (!resolutionEnabled) {
    return NextResponse.json({
      data: { resolutionEnabled: false, match: null, attempted: 0 },
      success: true,
    })
  }

  const candidates = readCandidates(payload.candidates)
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'At least one bank candidate is required.', success: false }, { status: 400 })
  }

  let attempted = 0
  for (const candidate of candidates) {
    attempted += 1
    try {
      const result = await resolveBankBeneficiary({
        bankCode: candidate.code,
        bankName: candidate.name,
        accountNumber,
      })
      if (result.status === 'verified' && result.accountName) {
        return NextResponse.json({
          data: {
            resolutionEnabled: true,
            attempted,
            match: {
              bankCode: result.bankCode,
              bankName: result.bankName,
              accountNumber: result.accountNumber,
              accountName: result.accountName,
            },
          },
          success: true,
        })
      }
    } catch {
      // A rejected candidate is expected while probing; keep trying the rest.
    }
  }

  return NextResponse.json({
    data: { resolutionEnabled: true, match: null, attempted },
    success: true,
  })
}
