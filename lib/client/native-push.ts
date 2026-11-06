import { isAndroidApp } from '@/lib/client/native-app'

let registrationStarted = false
let registeredToken: string | null = null
const FCM_PROJECT_ID = 'mafitapay-7cf5f'
const FCM_PROJECT_STORAGE_KEY = 'mfp_fcm_project_id'

/**
 * Register this device for push notifications and hand the FCM token to the server.
 *
 * Only meaningful inside the native shell: the browser build has no FCM registration, and the
 * plugin is a no-op there. Failures are logged and swallowed -- push is a convenience on top of the
 * in-app notification list and the notification email, so a device that never registers still sees
 * everything by opening the app.
 *
 * Call only once the user is authenticated: the token is stored against their account, so
 * registering before the session resolves would just 401.
 */
export async function initializePushNotifications() {
  if (registrationStarted || !isAndroidApp()) return
  registrationStarted = true

  try {
    const { App } = await import('@capacitor/app')
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const appInfo = await App.getInfo().catch(() => null)
    // The new Firebase sender is bundled starting at Android versionCode 5 (v1.0.4).
    const usesNewFirebaseProject = Number(appInfo?.build ?? 0) >= 5

    await PushNotifications.addListener('registration', token => {
      registeredToken = token.value
      void fetch('/api/push-tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value, platform: 'android' }),
      }).then(response => {
        if (!response.ok) {
          console.warn(`[push] server rejected token registration: ${response.status}`)
          return
        }
        if (usesNewFirebaseProject) {
          try {
            window.localStorage.setItem(FCM_PROJECT_STORAGE_KEY, FCM_PROJECT_ID)
          } catch {
            // The token is registered on the server; if storage is unavailable, don't block push.
          }
        }
      }).catch(error => {
        console.warn('[push] could not send token to server:', error)
      })
    })

    await PushNotifications.addListener('registrationError', error => {
      console.warn('[push] registration failed:', error)
    })

    // Taps on a delivered notification. The tray entry is drawn by the OS from the FCM payload, so
    // there is nothing to render here -- opening the app is the whole behaviour.
    await PushNotifications.addListener('pushNotificationActionPerformed', () => {})

    const existing = await PushNotifications.checkPermissions()
    const permission = existing.receive === 'prompt' || existing.receive === 'prompt-with-rationale'
      ? await PushNotifications.requestPermissions()
      : existing

    if (permission.receive !== 'granted') return

    // Firebase can retain an FCM token minted by the previous sender project across an APK
    // upgrade. Delete that cached token once, then register again against the current project.
    let needsProjectTokenRefresh = usesNewFirebaseProject
    try {
      needsProjectTokenRefresh = usesNewFirebaseProject
        && window.localStorage.getItem(FCM_PROJECT_STORAGE_KEY) !== FCM_PROJECT_ID
    } catch {
      // Storage may be unavailable in restricted WebViews; refresh once for this app session.
    }
    if (needsProjectTokenRefresh) {
      try {
        await PushNotifications.unregister()
        // The Capacitor Android plugin starts Firebase's asynchronous token deletion and resolves
        // immediately. Give Firebase a moment before register() requests the replacement token.
        await new Promise(resolve => window.setTimeout(resolve, 1000))
      } catch (error) {
        console.warn('[push] could not refresh the cached Firebase token:', error)
      }
    }

    await PushNotifications.register()
  } catch (error) {
    console.warn('[push] initialization failed:', error)
    registrationStarted = false
  }
}

/**
 * Drop this device's token on sign-out.
 *
 * A phone outlives a session: without this, the token row still points at the account that just
 * signed out, so their deposits would keep buzzing a device somebody else is now using. Must run
 * before the session cookie is cleared, or the request is just a 401.
 */
export async function unregisterPushNotifications() {
  const token = registeredToken
  registrationStarted = false
  registeredToken = null

  if (!token || !isAndroidApp()) return

  try {
    await fetch('/api/push-tokens', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch (error) {
    console.warn('[push] could not remove token on sign-out:', error)
  }
}
