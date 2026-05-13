'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAppStore } from '@/store'

export default function KycPage() {
  const { kycSubmission, refreshSession, showToast, user } = useAppStore()
  const [documentType, setDocumentType] = useState<'nin' | 'bvn' | 'passport' | 'drivers_license' | 'voters_card'>('nin')
  const [documentNumber, setDocumentNumber] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [documentName, setDocumentName] = useState('')
  const [mimeType, setMimeType] = useState('')
  const [fileSize, setFileSize] = useState<number | undefined>(undefined)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [submittingKyc, setSubmittingKyc] = useState(false)
  const [refreshingKycState, setRefreshingKycState] = useState(false)
  const uploadOptional = documentType === 'bvn' || documentType === 'nin'

  useEffect(() => {
    setDocumentType(kycSubmission?.documentType ?? 'nin')
    setDocumentNumber('')
    setDocumentUrl(kycSubmission?.documentUrl ?? '')
    setDocumentName(kycSubmission?.documentName ?? '')
    setMimeType(kycSubmission?.mimeType ?? '')
    setFileSize(kycSubmission?.fileSize)
  }, [kycSubmission?.documentName, kycSubmission?.documentType, kycSubmission?.documentUrl, kycSubmission?.fileSize, kycSubmission?.mimeType])

  const kycCopy = user?.kycStatus === 'verified'
    ? {
        headline: 'Verification complete',
        body: 'Your account has full access to supported wallet and transfer limits.',
      }
    : user?.kycStatus === 'rejected'
      ? {
          headline: 'Verification requires attention',
          body: 'Your last verification attempt was rejected. Upload a valid government ID to continue.',
        }
      : {
          headline: 'Verification required',
          body: 'Upload a valid government ID to unlock higher transaction limits and full P2P access.',
        }

  async function submitKyc() {
    if (!documentNumber.trim() || (!uploadOptional && !documentUrl.trim())) {
      showToast(uploadOptional ? 'Document number is required.' : 'Document number and an uploaded document are required.', 'error')
      return
    }

    setSubmittingKyc(true)
    try {
      const response = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentType, documentNumber, documentUrl, documentName, mimeType, fileSize }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'KYC submission failed.')
      }

      setRefreshingKycState(true)
      await refreshSession()
      showToast('KYC documents submitted for review.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'KYC submission failed.', 'error')
    } finally {
      setRefreshingKycState(false)
      setSubmittingKyc(false)
    }
  }

  async function uploadDocument(file: File) {
    setUploadingDocument(true)
    try {
      const body = new FormData()
      body.append('file', file)

      const response = await fetch('/api/kyc/upload', {
        method: 'POST',
        credentials: 'include',
        body,
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Document upload failed.')
      }

      setDocumentUrl(payload.data.documentUrl)
      setDocumentName(payload.data.documentName)
      setMimeType(payload.data.mimeType)
      setFileSize(payload.data.fileSize)
      showToast('Document uploaded. Submit KYC to send it for review.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Document upload failed.', 'error')
    } finally {
      setUploadingDocument(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <div className="space-y-4">
        <Card className="p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Unlocked Limits</div>
          <div className="space-y-3">
            {[
              ['Daily transfer limit', user?.kycStatus === 'verified' ? '₦500,000' : '₦50,000', user?.kycStatus === 'verified' ? 100 : 10],
              ['P2P deposit limit', user?.kycStatus === 'verified' ? '₦1,000,000' : '₦25,000', user?.kycStatus === 'verified' ? 100 : 2.5],
              ['Crypto volume', user?.kycStatus === 'verified' ? '₦500,000' : '₦76,000', user?.kycStatus === 'verified' ? 100 : 15],
            ].map(([label, value, pct]) => (
              <div key={label as string}>
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="text-[var(--muted)]">{label}</span>
                  <span className="font-bold text-[var(--text)]">{value}</span>
                </div>
                <div className="h-1.5 border border-[var(--border)] bg-[var(--clay2)]">
                  <div className="h-full bg-[var(--gold)]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <Card className="p-6">
          <div className="mb-4">
            <div className="text-[18px] font-black text-[var(--text)]">{kycCopy.headline}</div>
            <div className="mt-2 text-[12px] leading-relaxed text-[var(--text2)]">{kycCopy.body}</div>
          </div>
          {user?.kycStatus === 'verified' ? (
            <div className="border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(46,170,92,.3)] bg-[rgba(46,170,92,.14)]">
                  <BadgeCheck className="h-6 w-6 text-[var(--green2)]" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-[var(--green2)]">KYC Verified</div>
                  <div className="mt-1 text-[11px] text-[var(--text2)]">
                    Your identity has been approved. No further document submission is required right now.
                  </div>
                </div>
              </div>
              {kycSubmission && (
                <div className="mt-4 border border-[rgba(46,170,92,.18)] bg-[rgba(13,13,20,.18)] p-4 text-[11px]">
                  <div className="mb-1 font-bold text-[var(--text)]">Approved Identity</div>
                  <div className="text-[var(--muted)]">
                    {kycSubmission.documentType.toUpperCase()} · {kycSubmission.documentNumber}
                  </div>
                  {kycSubmission.documentName && (
                    <a href={kycSubmission.documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-bold text-[var(--gold2)] underline">
                      {kycSubmission.documentName}
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-5 border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="text-[11px] font-bold text-[var(--text)]">What to submit</div>
                <div className="mt-2 text-[11px] leading-relaxed text-[var(--text2)]">
                  Submit a valid identity record to unlock higher limits and complete account verification.
                </div>
                <div className="mt-3 space-y-2 text-[10px] text-[var(--muted)]">
                  <div>BVN and NIN can be submitted with just the number. Document upload is optional.</div>
                  <div>Passport, Driver License, and Voter Card require both the document number and an uploaded file.</div>
                  <div>For permanent funding account eligibility, BVN or NIN is still the required identity path.</div>
                </div>
              </div>
              <div className="space-y-4">
                {(uploadingDocument || refreshingKycState) && (
                  <div className="border border-[rgba(202,165,96,.2)] bg-[rgba(202,165,96,.08)] px-3 py-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
                    {uploadingDocument ? 'Uploading document…' : 'Refreshing verification state…'}
                  </div>
                )}
                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Document Type</div>
                  <select
                    value={documentType}
                    onChange={event => setDocumentType(event.target.value as typeof documentType)}
                    disabled={uploadingDocument || submittingKyc || refreshingKycState}
                    className="w-full border border-[var(--border)] bg-[var(--clay2)] px-3.5 py-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--gold)]"
                  >
                    <option value="nin">NIN</option>
                    <option value="bvn">BVN</option>
                    <option value="passport">Passport</option>
                    <option value="drivers_license">Driver License</option>
                    <option value="voters_card">Voter Card</option>
                  </select>
                </div>

                <Input
                  label="Document Number"
                  value={documentNumber}
                  onChange={event => setDocumentNumber(event.target.value)}
                  disabled={uploadingDocument || submittingKyc || refreshingKycState}
                  placeholder={documentType === 'bvn' || documentType === 'nin' ? '11 digits required' : undefined}
                />
                {kycSubmission?.documentNumber && (
                  <div className="text-[10px] text-[var(--muted)]">
                    Latest stored number: {kycSubmission.documentNumber}. Enter a fresh number only when resubmitting or changing documents.
                  </div>
                )}
                {(documentType === 'bvn' || documentType === 'nin') && (
                  <div className="text-[10px] text-[var(--muted)]">{documentType.toUpperCase()} must be exactly 11 digits.</div>
                )}

                <div>
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">
                    Document Upload {uploadOptional ? '(Optional)' : ''}
                  </div>
                  <label className="flex cursor-pointer items-center justify-between gap-3 border border-dashed border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[11px] text-[var(--text2)]">
                    <span className="min-w-0 truncate">{documentName || 'Choose a PDF or image document'}</span>
                    <span className="border border-[var(--border)] px-2.5 py-1 text-[9px] font-bold text-[var(--gold2)]">{uploadingDocument ? 'UPLOADING…' : 'UPLOAD'}</span>
                    <input
                      type="file"
                      accept=".pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingDocument || submittingKyc || refreshingKycState}
                      onChange={event => {
                        const file = event.target.files?.[0]
                        if (file) void uploadDocument(file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <div className="mt-2 text-[10px] text-[var(--muted)]">
                    {uploadOptional
                      ? 'Optional for BVN/NIN. You can submit with just the number, or attach a document if you want.'
                      : 'Required. Allowed: PDF, JPG, PNG, WEBP up to 5MB.'}
                    {fileSize ? ` Uploaded: ${(fileSize / 1024 / 1024).toFixed(2)}MB.` : ''}
                  </div>
                  {documentUrl && (
                    <a href={documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-bold text-[var(--gold2)] underline">
                      View uploaded document
                    </a>
                  )}
                </div>

                {kycSubmission && (
                  <div className="border border-[var(--border)] bg-[var(--clay)] p-4 text-[11px]">
                    <div className="mb-1 font-bold text-[var(--text)]">Latest Submission</div>
                    <div className="text-[var(--muted)]">
                      {kycSubmission.documentType.toUpperCase()} · {kycSubmission.documentNumber} · {kycSubmission.status.toUpperCase()}
                    </div>
                    {kycSubmission.documentName && (
                      <a href={kycSubmission.documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-bold text-[var(--gold2)] underline">
                        {kycSubmission.documentName}
                      </a>
                    )}
                    {kycSubmission.notes && (
                      <div className="mt-2 text-[var(--red2)]">Review note: {kycSubmission.notes}</div>
                    )}
                  </div>
                )}
                {refreshingKycState && (
                  <div className="space-y-2 border border-[var(--border)] bg-[var(--clay)] p-4">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                )}
              </div>

              <div className="mt-5">
                <Button className="w-full py-3" onClick={submitKyc} loading={submittingKyc || refreshingKycState} disabled={uploadingDocument || refreshingKycState}>
                  {refreshingKycState ? 'Refreshing State…' : uploadingDocument ? 'Waiting for Upload…' : 'Submit KYC Documents'}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
