import type { CapacitorConfig } from '@capacitor/cli'

const productionServerUrl = 'https://mafitapay.com'
const serverUrl = process.env.MAFITAPAY_MOBILE_SERVER_URL?.trim() || productionServerUrl
const serverHost = new URL(serverUrl).hostname

const config: CapacitorConfig = {
  appId: 'ng.mafitapay.app',
  appName: 'MafitaPay',
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    androidScheme: 'https',
    // Branded offline screen instead of the WebView's default error page. Bundled in webDir, so
    // it loads with no network; it gets no Capacitor plugins, hence plain HTML/CSS/JS.
    errorPath: 'offline.html',
    // Keep reconnect navigation to the MafitaPay origin inside the Capacitor WebView.
    allowNavigation: [serverHost, 'mafitapay.com', '*.mafitapay.com'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
  },
  plugins: {
    SplashScreen: {
      // Keep native splash until the web brand splash / app bootstrap hides it
      launchShowDuration: 0,
      launchAutoHide: false,
      launchFadeOutDuration: 320,
      backgroundColor: '#0c0907',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      androidSplashResourceName: 'splash',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0c0907',
    },
  },
}

export default config
