import { scanDemoNetworks } from './scanner.demo';
import type { WifiNetwork } from './wifi';

export const supportsNativeScan = false;

export async function scanNetworks(demo: boolean): Promise<WifiNetwork[]> {
  if (demo === true) return scanDemoNetworks();
  throw new Error(
    'Native Wi-Fi scanning is not supported on web or iOS. Enable demo mode, or use an Android development build with react-native-wifi-reborn. Expo Go cannot perform native Wi-Fi scans.',
  );
}
