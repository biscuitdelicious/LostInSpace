export type WifiNetwork = {
  ssid: string;
  bssid: string;
  rssi: number;
  frequency: number;
  security: string;
  connected?: boolean;
};

export const initialDemoNetworks: WifiNetwork[] = [
  {
    ssid: 'HyperMarket_Main',
    bssid: '74:ac:b9:3e:10:01',
    rssi: -42,
    frequency: 5180,
    security: 'WPA2',
    connected: true,
  },
  {
    ssid: 'HyperMarket_Zone_A',
    bssid: '74:ac:b9:3e:11:02',
    rssi: -51,
    frequency: 2412,
    security: 'WPA2',
  },
  {
    ssid: 'HyperMarket_Zone_B',
    bssid: '74:ac:b9:3e:12:03',
    rssi: -58,
    frequency: 5220,
    security: 'WPA2',
  },
  {
    ssid: 'HyperMarket_Guest',
    bssid: '76:ac:b9:3e:10:04',
    rssi: -64,
    frequency: 2437,
    security: 'Open',
  },
  {
    ssid: 'HyperMarket_Zone_C',
    bssid: '74:ac:b9:3e:13:05',
    rssi: -67,
    frequency: 5240,
    security: 'WPA2',
  },
  {
    ssid: 'POS_Network',
    bssid: 'b4:fb:e4:27:20:06',
    rssi: -72,
    frequency: 2462,
    security: 'WPA2',
  },
  {
    ssid: 'Staff_Network',
    bssid: 'b4:fb:e4:27:21:07',
    rssi: -78,
    frequency: 5200,
    security: 'WPA2',
  },
  {
    ssid: 'Warehouse_AP',
    bssid: 'f0:9f:c2:6a:30:08',
    rssi: -85,
    frequency: 2417,
    security: 'WPA2',
  },
];

export function getBand(frequency: number): '2.4 GHz' | '5 GHz' | '6 GHz' {
  if (frequency >= 5925) return '6 GHz';
  if (frequency >= 4900) return '5 GHz';
  return '2.4 GHz';
}

export function getChannel(frequency: number): number {
  if (!Number.isInteger(frequency)) return 0;
  if (frequency === 2484) return 14;
  if (frequency === 5935) return 2;

  let channel = 0;
  if (frequency >= 2412 && frequency <= 2472) {
    channel = (frequency - 2407) / 5;
  } else if (frequency >= 4910 && frequency <= 4980) {
    channel = (frequency - 4000) / 5;
  } else if (frequency >= 5005 && frequency < 5925) {
    channel = (frequency - 5000) / 5;
  } else if (frequency >= 5955 && frequency <= 7115) {
    channel = (frequency - 5950) / 5;
  }
  return Number.isInteger(channel) ? channel : 0;
}

export function signalQuality(rssi: number): 'Excellent' | 'Good' | 'Fair' | 'Weak' {
  if (rssi >= -50) return 'Excellent';
  if (rssi >= -60) return 'Good';
  if (rssi >= -70) return 'Fair';
  return 'Weak';
}
