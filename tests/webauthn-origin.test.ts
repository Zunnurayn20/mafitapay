import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptedCeremonyOrigins,
  androidApkKeyHashOrigin,
  resolveWebAuthnTarget,
} from '../lib/server/webauthn-origin.ts'

const debugOrigin = 'android:apk-key-hash:agld5FKveI42m__HbWaQH-1p8_m5Zm1Nt_L5Nt9jwl4'

test('Android app host wins when the configured RP ID is a different site', () => {
  const target = resolveWebAuthnTarget('https://mafitapay.vercel.app', {
    appUrl: 'https://mafitapay.com',
    rpId: 'mafitapay.com',
  })
  assert.equal(target.rpID, 'mafitapay.vercel.app')
  assert.equal(target.origin, 'https://mafitapay.vercel.app')
})

test('configured RP ID is kept when it is the page host or its parent', () => {
  const exact = resolveWebAuthnTarget('https://mafitapay.vercel.app', {
    appUrl: 'https://mafitapay.vercel.app',
  })
  assert.equal(exact.rpID, 'mafitapay.vercel.app')

  const parent = resolveWebAuthnTarget('https://www.mafitapay.com', {
    appUrl: 'https://mafitapay.com',
    rpId: 'mafitapay.com',
  })
  assert.equal(parent.rpID, 'mafitapay.com')
  assert.equal(parent.origin, 'https://www.mafitapay.com')
})

test('localhost development does not inherit a production RP ID', () => {
  const target = resolveWebAuthnTarget('http://localhost:3000', {
    appUrl: 'https://mafitapay.com',
    rpId: 'mafitapay.com',
  })
  assert.equal(target.rpID, 'localhost')
  assert.equal(target.origin, 'http://localhost:3000')
})

test('a public suffix cannot be used as the RP ID', () => {
  const target = resolveWebAuthnTarget('https://mafitapay.vercel.app', {
    rpId: 'vercel.app',
  })
  assert.equal(target.rpID, 'mafitapay.vercel.app')
})

test('unknown sites cannot start a ceremony', () => {
  assert.throws(
    () => resolveWebAuthnTarget('https://evil.example', { appUrl: 'https://mafitapay.com' }),
    /not available for this site/,
  )
})

test('verification accepts the website origin and the Android signing-cert origin', () => {
  assert.equal(
    androidApkKeyHashOrigin('6A:09:5D:E4:52:AF:78:8E:36:9B:FF:C7:6D:66:90:1F:ED:69:F3:F9:B9:66:6D:4D:B7:F2:F9:36:DF:63:C2:5E'),
    debugOrigin,
  )
  const origins = acceptedCeremonyOrigins('https://mafitapay.vercel.app', {
    androidCertSha256: 'AB:CD',
  })
  assert.ok(origins.includes('https://mafitapay.vercel.app'))
  assert.ok(origins.includes(debugOrigin))
  assert.equal(origins.filter(origin => origin === debugOrigin).length, 1)
})
