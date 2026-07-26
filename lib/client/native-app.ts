import { Capacitor } from '@capacitor/core'

export function isNativeApp() {
  return Capacitor.isNativePlatform()
}

export function getNativePlatform() {
  return Capacitor.getPlatform()
}

export function isAndroidApp() {
  return Capacitor.getPlatform() === 'android'
}

export function isIosApp() {
  return Capacitor.getPlatform() === 'ios'
}