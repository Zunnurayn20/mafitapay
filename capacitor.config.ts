import type { CapacitorConfig } from '@capacitor/cli'

const productionServerUrl = 'https://mafitapay.com'
const serverUrl = process.env.MAFITAPAY_MOBILE_SERVER_URL?.trim() || productionServerUrl

const config: CapacitorConfig = {
  appId: 'ng.mafitapay.app',
  appName: 'MafitaPay',
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3200,
      launchAutoHide: true,
      launchFadeOutDuration: 420,
      backgroundColor: '#0c0907',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      spinnerColor: '#e0c48a',
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