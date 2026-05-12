import { expect, test, type APIRequestContext } from '@playwright/test'

function buildUniqueDigits() {
  const seed = `${Date.now()}${Math.floor(Math.random() * 10_000)}`
  return seed.slice(-11).padStart(11, '1')
}

async function ensureAdminSession(request: APIRequestContext, adminEmail: string, adminPassword: string) {
  const registerResponse = await request.put('/api/auth', {
    data: {
      name: 'Mafita Admin',
      email: adminEmail,
      phone: `080${buildUniqueDigits().slice(0, 8)}`,
      password: adminPassword,
    },
  })

  if (registerResponse.ok()) {
    return
  }

  const loginResponse = await request.post('/api/auth', {
    data: {
      email: adminEmail,
      password: adminPassword,
    },
  })

  expect(loginResponse.ok()).toBeTruthy()
}

test('BVN KYC approval unlocks permanent funding account and deposit webhook credits wallet', async ({ page, request }) => {
  const adminEmail = process.env.MAFITAPAY_ADMIN_EMAIL ?? 'aminu@mafitapay.ng'
  const adminPassword = 'AdminPass123!'
  const secretHash = process.env.MAFITAPAY_FLUTTERWAVE_SECRET_HASH

  test.skip(!secretHash, 'MAFITAPAY_FLUTTERWAVE_SECRET_HASH is required for webhook verification in E2E.')

  const email = `user.${Date.now()}@example.com`
  const phone = `080${buildUniqueDigits().slice(0, 8)}`
  const password = 'TestPass123!'
  const bvn = buildUniqueDigits()

  await page.goto('/register')
  await page.getByLabel('Full Name').fill('Test User')
  await page.getByLabel('Email Address').fill(email)
  await page.getByLabel('Phone Number').fill(phone)
  await page.getByRole('button', { name: /Continue/i }).click()

  await page.getByLabel('Create Password').fill(password)
  await page.getByLabel('Confirm Password').fill(password)
  await page.getByRole('button', { name: /Create Account/i }).click()

  await page.waitForURL('**/dashboard')
  await page.goto('/profile#kyc-identity')

  await page.getByRole('button', { name: /^BVN$/i }).click()
  await page.getByLabel('Document Number').fill(bvn)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'identity.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'),
  })
  await page.getByRole('button', { name: /Submit KYC Documents/i }).click()
  await expect(page.getByText(/Latest Submission/i)).toBeVisible()
  await expect(page.getByText(/BVN/i)).toBeVisible()
  await expect(page.getByText(/PENDING/i)).toBeVisible()

  const authResponse = await page.request.get('/api/auth')
  expect(authResponse.ok()).toBeTruthy()
  const authPayload = await authResponse.json()
  const userId = authPayload.data?.user?.id as string
  expect(userId).toBeTruthy()

  await ensureAdminSession(request, adminEmail, adminPassword)
  const queueResponse = await request.get('/api/admin/kyc')
  expect(queueResponse.ok()).toBeTruthy()
  const queuePayload = await queueResponse.json()
  const targetSubmission = (queuePayload.data as Array<{ id: string; userId: string; documentType: string; status: string }>).find(item => item.userId === userId && item.documentType === 'bvn' && item.status === 'pending')
  expect(targetSubmission).toBeTruthy()

  const approveResponse = await request.patch('/api/admin/kyc', {
    data: {
      submissionId: targetSubmission?.id,
      status: 'approved',
      notes: 'Approved in Playwright e2e flow.',
    },
  })
  expect(approveResponse.ok()).toBeTruthy()

  await page.reload()
  await page.getByRole('button', { name: /Deposit/i }).click()
  await expect(page.getByText(/Approved BVN on file/i)).toBeVisible()
  await page.getByRole('button', { name: /Generate Permanent Account/i }).click()

  await expect(page.getByText(/Permanent Funding Account/i)).toBeVisible()
  const providerReferenceRow = page.getByText(/Provider reference:/i)
  await expect(providerReferenceRow).toBeVisible()
  const providerReferenceText = (await providerReferenceRow.textContent()) ?? ''
  const staticReference = providerReferenceText.split(':').slice(1).join(':').trim()
  expect(staticReference).toContain('static_va_')

  const accountRow = page.locator('text=/\\d{4}\\s\\d{4}\\s\\d{2,}/').first()
  const accountText = (await accountRow.textContent()) ?? ''
  const accountNumber = accountText.replace(/\D/g, '')
  expect(accountNumber.length).toBeGreaterThanOrEqual(10)

  const webhookResponse = await request.post('/api/webhooks/flutterwave', {
    headers: {
      'Content-Type': 'application/json',
      'verif-hash': secretHash!,
    },
    data: {
      event: 'charge.completed',
      data: {
        id: `evt_${Date.now()}`,
        flw_ref: `flw_${Date.now()}`,
        tx_ref: staticReference,
        amount: 5000,
        status: 'successful',
        payment_type: 'bank_transfer',
        account_number: accountNumber,
        bank_name: 'Flutterwave Test Bank',
        narration: 'Test User MAFITAPAY',
        customer: {
          email,
        },
      },
    },
  })
  expect(webhookResponse.ok()).toBeTruthy()

  await page.goto('/dashboard')
  await page.reload()
  await expect(page.getByText('4,900')).toBeVisible()
})
