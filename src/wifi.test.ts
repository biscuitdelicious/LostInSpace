import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanNetworks, supportsNativeScan } from './scanner';
import { getBand, getChannel, initialDemoNetworks, signalQuality } from './wifi';

test('demo seed contains the eight specified networks with unique BSSIDs', () => {
  assert.deepEqual(
    initialDemoNetworks.map(({ ssid, rssi, frequency, security, connected }) => [
      ssid, rssi, frequency, security, connected === true,
    ]),
    [
      ['HyperMarket_Main', -42, 5180, 'WPA2', true],
      ['HyperMarket_Zone_A', -51, 2412, 'WPA2', false],
      ['HyperMarket_Zone_B', -58, 5220, 'WPA2', false],
      ['HyperMarket_Guest', -64, 2437, 'Open', false],
      ['HyperMarket_Zone_C', -67, 5240, 'WPA2', false],
      ['POS_Network', -72, 2462, 'WPA2', false],
      ['Staff_Network', -78, 5200, 'WPA2', false],
      ['Warehouse_AP', -85, 2417, 'WPA2', false],
    ],
  );
  assert.equal(new Set(initialDemoNetworks.map(({ bssid }) => bssid)).size, 8);
  for (const { bssid } of initialDemoNetworks) {
    assert.match(bssid, /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
  }
});

test('frequency bands include 4.9 GHz and the special 6 GHz channel', () => {
  for (const frequency of [2412, 2417, 2437, 2462, 2472, 2484]) {
    assert.equal(getBand(frequency), '2.4 GHz');
  }
  for (const frequency of [4910, 4980, 5180, 5200, 5220, 5240, 5825, 5920]) {
    assert.equal(getBand(frequency), '5 GHz');
  }
  for (const frequency of [5925, 5935, 5955, 5975, 6115, 7115]) {
    assert.equal(getBand(frequency), '6 GHz');
  }
});

test('frequencies map to channels, including channel 14 and 6 GHz channel 2', () => {
  const channels = [
    [2412, 1], [2417, 2], [2437, 6], [2462, 11], [2472, 13], [2484, 14],
    [4910, 182], [4980, 196], [5180, 36], [5200, 40], [5220, 44], [5240, 48],
    [5745, 149], [5825, 165], [5935, 2], [5955, 1], [5975, 5], [6115, 33], [7115, 233],
  ];
  for (const [frequency, channel] of channels) {
    assert.equal(getChannel(frequency), channel, `${frequency} MHz`);
  }
});

test('unsupported or malformed channel frequencies return zero', () => {
  for (const frequency of [0, -2412, 2400, 2413, 2480, 2500, 4900, 5925, 5940, 7120, 2412.5, NaN, Infinity]) {
    assert.equal(getChannel(frequency), 0, `${frequency} MHz`);
  }
});

test('signal quality uses inclusive -50, -60, and -70 dBm boundaries', () => {
  assert.equal(signalQuality(-30), 'Excellent');
  assert.equal(signalQuality(-42), 'Excellent');
  assert.equal(signalQuality(-50), 'Excellent');
  assert.equal(signalQuality(-51), 'Good');
  assert.equal(signalQuality(-60), 'Good');
  assert.equal(signalQuality(-61), 'Fair');
  assert.equal(signalQuality(-70), 'Fair');
  assert.equal(signalQuality(-71), 'Weak');
  assert.equal(signalQuality(-100), 'Weak');
});

test('web/iOS adapter reports unsupported native scans without falling back to demo', async () => {
  assert.equal(supportsNativeScan, false);
  await assert.rejects(scanNetworks(false), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /not supported on web or iOS/);
    assert.match(error.message, /demo mode/);
    assert.match(error.message, /Android development build/);
    return true;
  });
});

test('demo scan takes 1600 ms and returns fresh networks without mutating the seed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  const seed = initialDemoNetworks.map((network) => ({ ...network }));
  let resolved = false;
  const pending = scanNetworks(true).then((networks) => {
    resolved = true;
    return networks;
  });

  t.mock.timers.tick(1599);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  t.mock.timers.tick(1);
  const networks = await pending;
  assert.equal(resolved, true);
  assert.deepEqual(networks, seed);
  assert.notEqual(networks, initialDemoNetworks);
  networks.forEach((network, index) => assert.notEqual(network, initialDemoNetworks[index]));
  networks[0].rssi = -99;
  networks[0].ssid = 'Changed';
  assert.deepEqual(initialDemoNetworks, seed);
});

test('repeated demo scans have bounded RSSI jitter without cumulative drift', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  const seed = initialDemoNetworks.map((network) => ({ ...network }));

  for (const sample of [0, 1 - Number.EPSILON, 0.25, 0.75, 0]) {
    random = sample;
    const pending = scanNetworks(true);
    t.mock.timers.tick(1600);
    const networks = await pending;
    assert.equal(networks.length, 8);
    networks.forEach((network, index) => {
      const original = seed[index];
      assert.ok(Number.isInteger(network.rssi));
      assert.ok(Math.abs(network.rssi - original.rssi) <= 3);
      assert.equal(network.rssi, original.rssi + Math.floor(sample * 7) - 3);
      assert.deepEqual({ ...network, rssi: original.rssi }, original);
    });
  }
  assert.deepEqual(initialDemoNetworks, seed);
});
