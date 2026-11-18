import { PermissionsAndroid } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';

import { scanDemoNetworks } from './scanner.demo';
import type { WifiNetwork } from './wifi';

export const supportsNativeScan = true;
let pendingScan: Promise<unknown> | null = null;

async function requestLocationPermission(): Promise<void> {
  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  let status: string;
  try {
    if (await PermissionsAndroid.check(fine)) return;
    const permissions = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      fine,
    ]);
    status = permissions[fine];
  } catch {
    throw new Error(
      'Could not request location permission. Allow precise location for this app in Android Settings, then retry the Wi-Fi scan.',
    );
  }

  if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    throw new Error(
      'Location permission is blocked. Open Android Settings > Apps > this app > Permissions and allow precise location, then retry.',
    );
  }
  if (status !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      'Wi-Fi scanning requires precise location permission (ACCESS_FINE_LOCATION). Allow precise location while using the app, then retry.',
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          'Wi-Fi scan timed out. Check that Wi-Fi and Location services are on. If Android does not finish the pending request, restart the app before scanning again.',
        )), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function getSecurity(capabilities: string): string {
  const flags = capabilities.toUpperCase();
  if (flags.includes('OWE')) return 'Enhanced Open';
  const wpa3 = /WPA3|SAE|SUITE_B_192/.test(flags);
  const wpa2 = /WPA2|RSN/.test(flags) && (!wpa3 || /PSK|WPA2/.test(flags));
  if (wpa3 && wpa2) return 'WPA2/WPA3';
  if (wpa3) return 'WPA3';
  if (wpa2) return 'WPA2';
  if (flags.includes('WPA')) return 'WPA';
  if (flags.includes('WEP')) return 'WEP';
  if (flags.includes('WAPI')) return 'WAPI';
  if (flags.includes('EAP')) return 'Enterprise';
  return flags.replace(/\[(?:ESS|IBSS|WPS)\]/g, '').trim() ? 'Unknown' : 'Open';
}

function normalizeNetworks(result: unknown): WifiNetwork[] {
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      throw new Error(String(result));
    }
  }
  if (!Array.isArray(result)) {
    throw new Error('Android returned an invalid Wi-Fi scan result. Please retry.');
  }
  return result.map((entry: unknown) => {
    if (
      !entry || typeof entry !== 'object'
      || !('SSID' in entry) || typeof entry.SSID !== 'string'
      || !('BSSID' in entry) || typeof entry.BSSID !== 'string'
      || !('level' in entry) || typeof entry.level !== 'number' || !Number.isFinite(entry.level)
      || !('frequency' in entry) || typeof entry.frequency !== 'number' || !Number.isFinite(entry.frequency)
      || !('capabilities' in entry) || typeof entry.capabilities !== 'string'
    ) {
      throw new Error('Android returned a malformed Wi-Fi network. Please retry.');
    }
    const bssid = entry.BSSID.trim().toLowerCase();
    return {
      ssid: entry.SSID || 'Hidden network',
      bssid,
      rssi: entry.level,
      frequency: entry.frequency,
      security: getSecurity(entry.capabilities),
    };
  });
}

function describeScanError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : typeof error === 'string' ? error : '';
  const details = `${code} ${message}`;

  if (/locationServicesOff|location.*(?:turned off|disabled)|location services? (?:is |are )?off/i.test(details)) {
    return new Error('Location services are off. Turn on Location in Android Settings and retry; Android requires it for Wi-Fi scanning.');
  }
  if (/permission|SecurityException|ACCESS_FINE_LOCATION/i.test(details)) {
    return new Error('Wi-Fi scan permission was denied. Allow precise location for this app in Android Settings and retry.');
  }
  if (/couldNotScan|throttl|only allowed to scan|scan.*(?:too often|rejected)/i.test(details)) {
    return new Error('Android could not complete the Wi-Fi scan and may be throttling requests (typically four scans per two minutes). Check Wi-Fi and Location are on, keep the app in the foreground, and wait two minutes before retrying.');
  }
  if (/couldNotEnableWifi/i.test(details)) {
    return new Error('Wi-Fi is disabled. Turn on Wi-Fi in Android Settings, then retry.');
  }
  return new Error(`Wi-Fi scan failed${code ? ` (${code})` : ''}: ${message || 'Unknown native error. Check Wi-Fi and Location settings, then retry.'}`);
}

export async function scanNetworks(demo: boolean): Promise<WifiNetwork[]> {
  if (demo === true) return scanDemoNetworks();
  if (!WifiManager || typeof WifiManager.reScanAndLoadWifiList !== 'function' || typeof WifiManager.isEnabled !== 'function') {
    throw new Error('Native Wi-Fi scanning requires an Android development build with react-native-wifi-reborn linked. It is unavailable in Expo Go. Build the Android app, or explicitly enable demo mode.');
  }

  await requestLocationPermission();
  try {
    if (!(await WifiManager.isEnabled())) {
      throw new Error('Wi-Fi is disabled. Turn on Wi-Fi in Android Settings, then retry.');
    }
    if (pendingScan) {
      throw new Error('Android is still processing the previous scan. Wait for it to finish, or restart the app before scanning again.');
    }
    pendingScan = WifiManager.reScanAndLoadWifiList().finally(() => { pendingScan = null; });
    const result: unknown = await withTimeout(pendingScan, 20000);
    return normalizeNetworks(result);
  } catch (error) {
    throw describeScanError(error);
  }
}
