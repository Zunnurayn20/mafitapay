'use client'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminHealthSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
  const {
    baseExecutorHealth,
    baseTreasuryBalances,
    zeroExHealth,
    cryptoMarketHealth,
    refreshCryptoMarketSnapshotsNow,
    refreshingCryptoMarket,
    renderPriceFreshness,
    flutterwaveHealth,
    flutterwaveBillsHealth,
    providerDiagnosticsReport,
    refreshingProviderDiagnostics,
    reloadProviderDiagnosticsReport,
  } = workspace
  const showRails = !submodule || submodule === 'rails'
  const showProviders = !submodule || submodule === 'providers'
  const showMarket = !submodule || submodule === 'market'

  return (
    <>
      {showRails && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Base Executor Health</div>
        {!baseExecutorHealth ? (
          <div className="text-[11px] text-[var(--muted)]">Base executor state unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {baseExecutorHealth.criticalChecks.map(item => (
                <div key={item.key} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{item.label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${item.ready ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {item.ready ? 'READY' : 'BLOCKED'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)]">
                <div>Builder code: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.builderCode}</span></div>
                <div className="mt-1">RPC: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.rpcUrl}</span></div>
                <div className="mt-1">Configured wallet: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.configuredAddress}</span></div>
                {baseExecutorHealth.derivedAddress && <div className="mt-1">Derived signer: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.derivedAddress}</span></div>}
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)]">
                <div>Reserve Contract: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.contracts.reserve}</span></div>
                <div className="mt-1">USDC: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.contracts.usdc}</span></div>
                <div className="mt-1">WETH: <span className="font-mono text-[var(--text)]">{baseExecutorHealth.contracts.weth}</span></div>
              </div>
            </div>
            {baseExecutorHealth.warnings.length > 0 && (
              <div className="space-y-1 text-[10px] text-[var(--red2)]">
                {baseExecutorHealth.warnings.map((item: string) => <div key={item}>{item}</div>)}
              </div>
            )}
          </div>
        )}
      </Card>}

      {showRails && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Base Treasury</div>
        {!baseTreasuryBalances ? (
          <div className="text-[11px] text-[var(--muted)]">Base treasury balances unavailable.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Wallet</div>
              <div className="mt-2 break-all font-mono text-[10px] text-[var(--text)]">{baseTreasuryBalances.walletAddress}</div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">ETH Gas Balance</div>
              <div className="mt-2 font-mono text-[12px] text-[var(--text)]">{baseTreasuryBalances.ethWei} wei</div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">USDC Treasury Balance</div>
              <div className="mt-2 font-mono text-[12px] text-[var(--text)]">{baseTreasuryBalances.usdcUnits} units</div>
            </div>
          </div>
        )}
      </Card>}

      {showRails && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">0x Swap Health</div>
        {!zeroExHealth ? (
          <div className="text-[11px] text-[var(--muted)]">0x state unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {zeroExHealth.criticalChecks.map(item => (
                <div key={item.key} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{item.label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${item.ready ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {item.ready ? 'READY' : 'BLOCKED'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)]">
              <div>Base URL: <span className="font-mono text-[var(--text)]">{zeroExHealth.baseUrl}</span></div>
              <div className="mt-1">Chain ID: <span className="font-mono text-[var(--text)]">{zeroExHealth.chainId}</span></div>
            </div>
            {zeroExHealth.warnings.length > 0 && (
              <div className="space-y-1 text-[10px] text-[var(--red2)]">
                {zeroExHealth.warnings.map((item: string) => <div key={item}>{item}</div>)}
              </div>
            )}
          </div>
        )}
      </Card>}

      {showMarket && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Crypto Market Health</div>
          <Button variant="secondary" size="sm" onClick={() => void refreshCryptoMarketSnapshotsNow()} disabled={refreshingCryptoMarket}>
            {refreshingCryptoMarket ? 'Refreshing…' : 'Refresh Now'}
          </Button>
        </div>
        {!cryptoMarketHealth ? (
          <div className="text-[11px] text-[var(--muted)]">Crypto market state unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {cryptoMarketHealth.criticalChecks.map(item => (
                <div key={item.key} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{item.label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${item.ready ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {item.ready ? 'READY' : 'BLOCKED'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)]">
                <div>Provider: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.provider}</span></div>
                <div className="mt-1">Base URL: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.baseUrl}</span></div>
                <div className="mt-1">Auth mode: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.authMode}</span></div>
                <div className="mt-1">Status: <span className={`font-bold ${cryptoMarketHealth.status === 'live' ? 'text-[var(--green2)]' : cryptoMarketHealth.status === 'fallback' ? 'text-[var(--gold2)]' : 'text-[var(--red2)]'}`}>{cryptoMarketHealth.status.toUpperCase()}</span></div>
                <div className="mt-1">Cache TTL: <span className="font-mono text-[var(--text)]">{Math.round(cryptoMarketHealth.cacheTtlMs / 1000)}s</span></div>
                <div className="mt-1">Cache age: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.cacheAgeMs == null ? 'none' : `${Math.round(cryptoMarketHealth.cacheAgeMs / 1000)}s`}</span></div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)]">
                <div>Sample IDs: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.sampleIds.join(', ')}</span></div>
                <div className="mt-1">Cached assets: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.cachedAssets.length > 0 ? cryptoMarketHealth.cachedAssets.join(', ') : 'none'}</span></div>
                <div className="mt-1">Last error: <span className="font-mono text-[var(--text)]">{cryptoMarketHealth.lastError ?? 'none'}</span></div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              {cryptoMarketHealth.perAssetStatus.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{item.label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${item.status === 'live' ? 'text-[var(--green2)]' : item.status === 'backup' ? 'text-[var(--gold2)]' : 'text-[var(--red2)]'}`}>
                    {item.status === 'live' ? 'LIVE' : item.status === 'backup' ? 'CACHED' : 'UNAVAILABLE'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {item.priceUsd > 0 ? `$${item.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : 'No trusted USD price'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{renderPriceFreshness(item.updatedAt)}</div>
                </div>
              ))}
            </div>
            {cryptoMarketHealth.warnings.length > 0 && (
              <div className="space-y-2">
                {cryptoMarketHealth.warnings.map((item: string) => (
                  <div key={item} className="border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[10px] text-[var(--red2)]">
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>}

      {showProviders && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Provider Diagnostics</div>
          <Button variant="secondary" size="sm" onClick={() => void reloadProviderDiagnosticsReport()} disabled={refreshingProviderDiagnostics}>
            {refreshingProviderDiagnostics ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {!providerDiagnosticsReport ? (
          <div className="text-[11px] text-[var(--muted)]">Provider diagnostics unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending Events</div>
                <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalPendingEvents > 0 ? 'text-[var(--gold2)]' : 'text-[var(--green2)]'}`}>
                  {providerDiagnosticsReport.totalPendingEvents}
                </div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Failures (24h)</div>
                <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalFailedEvents24h > 0 ? 'text-[var(--red2)]' : 'text-[var(--green2)]'}`}>
                  {providerDiagnosticsReport.totalFailedEvents24h}
                </div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Retry Queue</div>
                <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalRetryingEvents > 0 ? 'text-[var(--gold2)]' : 'text-[var(--green2)]'}`}>
                  {providerDiagnosticsReport.totalRetryingEvents}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Per Provider</div>
                <div className="space-y-2">
                  {providerDiagnosticsReport.providers.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No provider events recorded yet.</div>
                  ) : providerDiagnosticsReport.providers.map(item => {
                    const healthState = item.failedCount > 0
                      ? 'DEGRADED'
                      : item.pendingCount > 0 || item.retryingCount > 0
                        ? 'ATTENTION'
                        : 'OK'
                    const healthStateClass = healthState === 'DEGRADED'
                      ? 'text-[var(--red2)]'
                      : healthState === 'ATTENTION'
                        ? 'text-[var(--gold2)]'
                        : 'text-[var(--green2)]'
                    return (
                    <div key={item.provider} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-bold text-[var(--text)]">{item.provider}</div>
                        <div className={`font-bold ${healthStateClass}`}>
                          {healthState}
                        </div>
                      </div>
                      <div className="mt-1">Events 24h: <span className="font-mono">{item.totalEvents24h}</span> · Pending: <span className="font-mono">{item.pendingCount}</span> · Failed: <span className="font-mono">{item.failedCount}</span> · Retrying: <span className="font-mono">{item.retryingCount}</span></div>
                      <div className="mt-1">Last event: <span className="font-mono">{item.lastEventAt ? new Date(item.lastEventAt).toLocaleString('en-NG') : 'none'}</span></div>
                      <div className="mt-1">Last processed: <span className="font-mono">{item.lastProcessedAt ? new Date(item.lastProcessedAt).toLocaleString('en-NG') : 'none'}</span></div>
                      <div className="mt-1">Last success: <span className="font-mono">{item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString('en-NG') : 'none'}</span></div>
                      <div className="mt-1">Last failure: <span className="font-mono">{item.lastFailureAt ? new Date(item.lastFailureAt).toLocaleString('en-NG') : 'none'}</span></div>
                      {item.lastFailureReason && <div className="mt-1 text-[var(--red2)]">Last failure: {item.lastFailureReason}</div>}
                      {item.topFailureReasons.length > 0 && (
                        <div className="mt-2">
                          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Top Failure Reasons</div>
                          <div className="mt-1 space-y-1">
                            {item.topFailureReasons.map(reason => (
                              <div key={`${item.provider}-${reason.reason}`} className="text-[10px] text-[var(--muted)]">
                                {reason.reason} <span className="font-mono">×{reason.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Failures</div>
                <div className="space-y-2">
                  {providerDiagnosticsReport.recentFailures.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No recent provider failures.</div>
                  ) : providerDiagnosticsReport.recentFailures.map(item => (
                    <div key={`${item.provider}-${item.externalEventId}`} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      <div className="font-bold text-[var(--text)]">{item.provider}</div>
                      <div className="mt-1 font-mono">{item.externalEventId}</div>
                      <div className="mt-1">{item.reference} · {item.status.toUpperCase()} · {new Date(item.createdAt).toLocaleString('en-NG')}</div>
                      {item.retryCount ? <div className="mt-1">Retries: <span className="font-mono">{item.retryCount}</span></div> : null}
                      {item.failureReason && <div className="mt-1 text-[var(--red2)]">{item.failureReason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>}

      {showProviders && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Flutterwave Health</div>
        {!flutterwaveHealth ? (
          <div className="text-[11px] text-[var(--muted)]">Health state unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {flutterwaveHealth.criticalChecks.map(item => (
                <div key={item.key} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{item.label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${item.ready ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {item.ready ? 'READY' : 'BLOCKED'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ['Resolution', flutterwaveHealth.resolution.resolutionEnabled ? 'READY' : 'OFF', flutterwaveHealth.resolution.secretKeyConfigured],
                ['Secure Identity', flutterwaveHealth.secureIdentity.configured ? 'READY' : 'OFF', flutterwaveHealth.secureIdentity.configured],
                ['Payouts', flutterwaveHealth.transfers.payoutsEnabled ? 'READY' : 'OFF', flutterwaveHealth.transfers.payoutsEnabled],
                ['Webhooks', flutterwaveHealth.transfers.webhooksEnabled ? 'READY' : 'OFF', flutterwaveHealth.transfers.webhooksEnabled],
              ].map(([label, value, active]) => (
                <div key={String(label)} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{label}</div>
                  <div className={`mt-2 text-[12px] font-bold ${active ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div>Mode: {flutterwaveHealth.mode.mixed ? 'Mixed (secret key + client credentials)' : flutterwaveHealth.mode.resolutionOnly ? 'Resolution only' : flutterwaveHealth.mode.payoutsOnly ? 'Payouts only' : 'Local fallback only'}</div>
              <div className="mt-1">Secure identity storage: {flutterwaveHealth.secureIdentity.configured ? `configured · ${flutterwaveHealth.secureIdentity.algorithm} · ${flutterwaveHealth.secureIdentity.keyVersion}` : 'missing'}</div>
              <div className="mt-1">Resolution provider: {flutterwaveHealth.resolution.provider}</div>
              <div className="mt-1">Resolution base URL: {flutterwaveHealth.resolution.baseUrl}</div>
              <div className="mt-1">Client ID: {flutterwaveHealth.transfers.clientIdConfigured ? 'configured' : 'missing'} · Client Secret: {flutterwaveHealth.transfers.clientSecretConfigured ? 'configured' : 'missing'}</div>
              <div className="mt-1">Secret Key: {flutterwaveHealth.resolution.secretKeyConfigured ? 'configured' : 'missing'} · Secret Hash: {flutterwaveHealth.transfers.secretHashConfigured ? 'configured' : 'missing'}</div>
              <div className="mt-1">Callback URL: {flutterwaveHealth.transfers.callbackUrlConfigured ? 'configured' : 'missing'}</div>
              <div className="mt-1">Job Secret: {flutterwaveHealth.transfers.jobSecretConfigured ? 'configured' : 'missing'}</div>
              <div className="mt-1">Job Route: <span className="font-mono">/api/jobs/flutterwave/payout-sync</span></div>
            </div>
            {flutterwaveHealth.warnings.length > 0 && (
              <div className="space-y-2">
                {flutterwaveHealth.warnings.map((item: string) => (
                  <div key={item} className="border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[10px] text-[var(--red2)]">
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>}

      {showProviders && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Flutterwave Bills Health</div>
        {!flutterwaveBillsHealth ? (
          <div className="text-[11px] text-[var(--muted)]">Bills health unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Bills Provider</div>
                <div className={`mt-2 text-[12px] font-bold ${flutterwaveBillsHealth.configured ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                  {flutterwaveBillsHealth.configured ? 'READY' : 'BLOCKED'}
                </div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending Sync</div>
                <div className={`mt-2 text-[12px] font-bold ${flutterwaveBillsHealth.pendingCount > 0 ? 'text-[var(--gold2)]' : 'text-[var(--green2)]'}`}>
                  {flutterwaveBillsHealth.pendingCount}
                </div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Success</div>
                <div className="mt-2 text-[12px] font-bold text-[var(--green2)]">{flutterwaveBillsHealth.recentSuccess.length}</div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Issues</div>
                <div className={`mt-2 text-[12px] font-bold ${flutterwaveBillsHealth.providerFailures.length > 0 ? 'text-[var(--red2)]' : 'text-[var(--green2)]'}`}>
                  {flutterwaveBillsHealth.providerFailures.length}
                </div>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending Bills</div>
                <div className="space-y-2">
                  {flutterwaveBillsHealth.pendingBills.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No pending bill payments.</div>
                  ) : flutterwaveBillsHealth.pendingBills.slice(0, 6).map(item => (
                    <div key={item.transaction.id} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      <div className="font-bold text-[var(--text)]">{item.transaction.description}</div>
                      <div className="mt-1">{item.transaction.reference}</div>
                      <div className="mt-1 text-[var(--gold2)] font-bold">{item.transaction.status.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Failures</div>
                <div className="space-y-2">
                  {flutterwaveBillsHealth.recentFailures.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No recent failed bill payments.</div>
                  ) : flutterwaveBillsHealth.recentFailures.map(item => (
                    <div key={item.transaction.id} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      <div className="font-bold text-[var(--text)]">{item.transaction.description}</div>
                      <div className="mt-1">{item.transaction.reference}</div>
                      <div className="mt-1 text-[var(--red2)] font-bold">{item.transaction.status.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Issues</div>
                <div className="space-y-2">
                  {flutterwaveBillsHealth.providerFailures.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No recent Flutterwave bill provider issues.</div>
                  ) : flutterwaveBillsHealth.providerFailures.map(item => (
                    <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      <div className="font-bold text-[var(--text)]">{item.reference}</div>
                      <div className="mt-1">{item.status.toUpperCase()}</div>
                      {item.failureReason && <div className="mt-1 text-[var(--red2)]">{item.failureReason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div>Primary data rail: <span className="font-mono uppercase">{flutterwaveBillsHealth.rails.dataPrimary}</span></div>
              <div className="mt-1">Amigo: {flutterwaveBillsHealth.rails.amigoConfigured ? 'configured' : 'missing'} · Flutterwave: {flutterwaveBillsHealth.rails.flutterwaveConfigured ? 'configured' : 'missing'}</div>
              <div className="mt-1">Recent Amigo data txs: <span className="font-mono">{flutterwaveBillsHealth.recentAmigoData.length}</span> · Recent Flutterwave bills: <span className="font-mono">{flutterwaveBillsHealth.recentFlutterwaveBills.length}</span></div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div>Job Route: <span className="font-mono">/api/jobs/flutterwave/bills-sync</span></div>
              <div className="mt-1">Recent provider events: <span className="font-mono">{flutterwaveBillsHealth.recentProviderEvents.length}</span></div>
            </div>
          </div>
        )}
      </Card>}

    </>
  )
}
