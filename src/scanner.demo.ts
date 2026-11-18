import { initialDemoNetworks, type WifiNetwork } from './wifi';

export async function scanDemoNetworks(): Promise<WifiNetwork[]> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1600));
  return initialDemoNetworks.map((network) => ({
    ...network,
    rssi: Math.max(-100, Math.min(-20, network.rssi + Math.floor(Math.random() * 7) - 3)),
  }));
}
