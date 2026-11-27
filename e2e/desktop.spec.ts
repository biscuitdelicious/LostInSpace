import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, allowHttpErrors, demoLabels, expectNetworks, networkRows, openScanner, readStaffCredentials, resolveTestApiUrl, runScan, signInStaff, testApiUrl } from './fixtures';
import { completeShoppingList, cancelShoppingList, shoppingListSurvivesReload } from './shopping';
import { reportMovedProduct, reportSearchedProduct } from './reports';
import { aisleNamesStayReadableAroundShopper, forgetTappedLocationOnEndFinishAndAfterHour, setLocationByTapping, tapShopperPoint } from './positioning';
import type { MapPoint } from '../src/route';

test.beforeEach(async ({ page }) => {
  await openScanner(page);
});

test('browse all eight demo networks', async ({ page }) => {
  await expect(page.getByText('Demo environment', { exact: true })).toBeVisible();
  await expect(page.getByText('Sample scan data', { exact: true })).toBeVisible();
  await expectNetworks(page, demoLabels);
  await expect(networkRows(page).first()).toContainText('Connected');
  await expect(networkRows(page).first()).toContainText('74:ac:b9:3e:10:01');
  await expect(networkRows(page).first()).toContainText('Excellent');
  await expect(networkRows(page).last()).toContainText('Weak');
});

for (const { band, indices } of [
  { band: '2.4 GHz', indices: [1, 3, 5, 7] },
  { band: '5 GHz', indices: [0, 2, 4, 6] },
]) {
  test(`filter ${band} networks and combine with search`, async ({ page }) => {
    await page.getByRole('button', { name: band, exact: true }).click();
    await expectNetworks(page, indices.map(index => demoLabels[index]));
    for (const row of await networkRows(page).all()) {
      await expect(row).toContainText(band);
    }
    await page.getByRole('textbox', { name: 'Search networks', exact: true }).fill('hypermarket');
    await expectNetworks(page, indices.filter(index => index < 5).map(index => demoLabels[index]));
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: 'All networks', exact: true }).click();
    await expectNetworks(page, demoLabels);
  });
}

test('search by case-insensitive SSID and BSSID, then clear', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search networks', exact: true });
  await search.fill('hYpErMaRkEt_ZoNe');
  await expectNetworks(page, [demoLabels[1], demoLabels[2], demoLabels[4]]);
  await search.fill('B4:FB:E4:27:21:07');
  await expectNetworks(page, [demoLabels[6]]);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expectNetworks(page, demoLabels);
});

test('secured filter excludes open networks; no results can reset all filters', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter networks', exact: true }).click();
  const secured = page.getByRole('checkbox', { name: 'Secured networks only', exact: true });
  await secured.click();
  await expectNetworks(page, demoLabels.filter((_, index) => index !== 3));
  await page.getByRole('button', { name: '2.4 GHz', exact: true }).click();
  await expectNetworks(page, [demoLabels[1], demoLabels[5], demoLabels[7]]);
  const search = page.getByRole('textbox', { name: 'Search networks', exact: true });
  await search.fill('no-such-network');
  await expectNetworks(page, []);
  await expect(page.getByText('No matching networks', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByText('No matching networks', { exact: true })).toBeHidden();
  await expectNetworks(page, demoLabels);
});

test('sort by weakest and strongest signal', async ({ page }) => {
  await page.getByRole('button', { name: 'Sort signal weakest first', exact: true }).click();
  await expectNetworks(page, [...demoLabels].reverse());
  await page.getByRole('button', { name: 'Sort signal strongest first', exact: true }).click();
  await expectNetworks(page, demoLabels);
});

test('network details show frequency, channel, security, and connection status', async ({ page }) => {
  await page.getByRole('button', { name: demoLabels[0], exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const text of [
    'HyperMarket_Main',
    'Demo access point · 74:ac:b9:3e:10:01',
    '-42 dBm',
    '5180 MHz · 5 GHz',
    '36',
    'WPA2',
    'Connected to this network',
  ]) {
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: demoLabels[3], exact: true }).click();
  await expect(dialog.getByText('Open', { exact: true })).toBeVisible();
  await expect(dialog.getByText('2437 MHz · 2.4 GHz', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Available in your vicinity', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('completed scan creates viewable history and history can be cleared', async ({ page }) => {
  await page.getByRole('button', { name: 'Scan History', exact: true }).click();
  await expect(page.getByText('A fresh start.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go to scanner', exact: true }).click();
  await runScan(page);
  const scannedLabels = await networkRows(page).evaluateAll(rows => rows.map(row => row.getAttribute('aria-label') || ''));
  await page.getByRole('button', { name: 'Scan History', exact: true }).click();
  await expect(page.getByText('8 networks discovered', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/· Demo scan$/)).toBeVisible();
  await page.getByRole('button', { name: 'View scan', exact: true }).click();
  await expectNetworks(page, scannedLabels);
  await page.getByRole('button', { name: 'Scan History', exact: true }).click();
  await page.getByRole('button', { name: 'Clear scan history', exact: true }).click();
  await expect(page.getByText('A fresh start.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View scan', exact: true })).toHaveCount(0);
});

test('save a named fingerprint in a workspace and restore its signals after a scan', async ({ page }) => {
  await page.getByRole('button', { name: 'Ground floor', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Warehouse', exact: true }).click();
  await page.getByRole('button', { name: 'Fingerprints', exact: true }).click();
  await expect(page.getByText('0 saved this session', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save your first fingerprint', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Save fingerprint', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Fingerprint location name', exact: true });
  await expect(save).toBeDisabled();
  await name.fill('   ');
  await expect(save).toBeDisabled();
  await name.fill('  Aisle 3 · Fresh produce  ');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Fingerprint saved to this session.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 saved this session', { exact: true })).toBeVisible();
  await expect(page.getByText('Aisle 3 · Fresh produce', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Warehouse · 8 access points ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true }).click();
  await runScan(page);
  await page.getByRole('button', { name: 'Fingerprints', exact: true }).click();
  await page.getByRole('button', { name: 'View signals', exact: true }).click();
  await expect(page.getByText('Viewing fingerprint: Aisle 3 · Fresh produce', { exact: true })).toBeVisible();
  await expectNetworks(page, demoLabels);
});

test('CSV download contains the complete eight-network demo scan', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^lis-networks-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error('CSV download did not provide a readable stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const lines = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/);
  expect(lines).toHaveLength(9);
  expect(lines[0]).toBe('SSID,BSSID,RSSI (dBm),Band,Channel,Security,Mode');
  expect(lines.slice(1)).toEqual([
    '"HyperMarket_Main","74:ac:b9:3e:10:01","-42","5 GHz","36","WPA2","Demo"',
    '"HyperMarket_Zone_A","74:ac:b9:3e:11:02","-51","2.4 GHz","1","WPA2","Demo"',
    '"HyperMarket_Zone_B","74:ac:b9:3e:12:03","-58","5 GHz","44","WPA2","Demo"',
    '"HyperMarket_Guest","76:ac:b9:3e:10:04","-64","2.4 GHz","6","Open","Demo"',
    '"HyperMarket_Zone_C","74:ac:b9:3e:13:05","-67","5 GHz","48","WPA2","Demo"',
    '"POS_Network","b4:fb:e4:27:20:06","-72","2.4 GHz","11","WPA2","Demo"',
    '"Staff_Network","b4:fb:e4:27:21:07","-78","5 GHz","40","WPA2","Demo"',
    '"Warehouse_AP","f0:9f:c2:6a:30:08","-85","2.4 GHz","2","WPA2","Demo"',
  ]);
  await expect(page.getByText('Scan data exported.', { exact: true })).toBeVisible();
});

test('settings keep web in demo mode and synchronize automatic scanning', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Scanner preferences', { exact: true })).toBeVisible();
  const demo = page.getByRole('switch', { name: 'Demo environment', exact: true });
  await expect(demo).toBeChecked();
  await expect(demo).toBeDisabled();
  const automatic = page.getByRole('switch', { name: 'Automatic scanning', exact: true });
  await expect(automatic).not.toBeChecked();
  await automatic.check();
  await expect(automatic).toBeChecked();
  await page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true }).click();
  const scannerAutomatic = page.getByRole('switch', { name: 'Auto-scan every 35 seconds', exact: true });
  await scannerAutomatic.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(automatic).not.toBeChecked();
});

test('secured network checkbox exposes its checked state to assistive technology', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter networks', exact: true }).click();
  const secured = page.getByRole('checkbox', { name: 'Secured networks only', exact: true });
  await secured.click();
  await expectNetworks(page, demoLabels.filter((_, index) => index !== 3));
  await expect(secured).toHaveAttribute('aria-checked', 'true');
  await secured.click();
  await expectNetworks(page, demoLabels);
  await expect(secured).toHaveAttribute('aria-checked', 'false');
});

test('scanner auto-scan switch exposes its checked state to assistive technology', async ({ page }) => {
  const automatic = page.getByRole('switch', { name: 'Auto-scan every 35 seconds', exact: true });
  await automatic.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Automatic scanning', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true }).click();
  await expect(automatic).toHaveAttribute('aria-checked', 'true');
  await automatic.click();
  await expect(automatic).toHaveAttribute('aria-checked', 'false');
});

test('help and notifications open and close', async ({ page }) => {
  await page.getByRole('button', { name: 'Help & getting started', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('A smarter sense of place.', { exact: true })).toBeVisible();
  for (const text of ['Discover your surroundings', 'Get to know your signals', 'Build a location fingerprint']) {
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(dialog.getByText('You’re all caught up.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to exploring', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('workspace selection updates scanner and indoor map', async ({ page }) => {
  await page.getByRole('button', { name: 'Workspace profile', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Your hypermarket workspace', { exact: true })).toBeVisible();
  for (const zone of ['Ground floor', 'First floor', 'Warehouse']) {
    await expect(dialog.getByRole('button', { name: zone, exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'First floor', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'First floor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Indoor Map', exact: true }).click();
  await expect(page.getByText('Hypermarket · First floor', { exact: true })).toBeVisible();
  await expect(page.getByText('Illustrative floor plan · access point positions are not measured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View fingerprints', exact: true }).click();
  await expect(page.getByText('Your signal library', { exact: true })).toBeVisible();
});

test('search product from backend, start a Waze-style route, and end it', async ({ page }) => {
  await page.getByRole('button', { name: 'Indoor Map', exact: true }).click();
  await expect(page.getByText('POSTGRES API', { exact: true })).toBeVisible();
  const productSearch = page.getByRole('textbox', { name: 'Search store products', exact: true });
  await productSearch.fill('milk');
  const milkButton = page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true });
  await expect(milkButton).toBeVisible();
  await milkButton.click();

  // Big next-step banner at the top, like a turn instruction, pointing left for a left-side shelf.
  const banner = page.getByLabel('Route banner', { exact: true });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Turn into aisle 7, left side, middle shelf', { exact: true })).toBeVisible();
  await expect(banner.getByLabel('Turn left', { exact: true })).toBeVisible();
  const leftIconSvg = await banner.getByLabel('Turn left', { exact: true }).locator('svg').innerHTML();

  // Distance and an End button in the bottom bar.
  const bar = page.getByLabel('Route progress bar', { exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.getByText('Aisle 7, left, middle shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();

  // The bottom bar never covers the aisles: the map is inset above it.
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  for (const aisleText of ['AISLE 7', 'AISLE 8']) {
    const box = await page.getByText(aisleText, { exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(barBox!.y);
  }

  // The START marker sits clear of the entrance label.
  const startBox = await page.getByText('START', { exact: true }).boundingBox();
  const entranceBox = await page.getByText('ENTRANCE / CHECKOUT', { exact: true }).boundingBox();
  expect(startBox).not.toBeNull();
  expect(entranceBox).not.toBeNull();
  expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(entranceBox!.y + 1);

  await page.getByRole('button', { name: 'End route', exact: true }).click();
  await expect(bar).toBeHidden();
  await expect(banner).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Search store products', exact: true })).toBeVisible();

  // Right-side shelves flip the banner arrow to up-right.
  await productSearch.fill('bread');
  await page.getByRole('button', { name: 'Select product Sourdough Bread, Aisle 1, right, top shelf', exact: true }).click();
  await expect(banner.getByLabel('Turn right', { exact: true })).toBeVisible();
  const rightIconSvg = await banner.getByLabel('Turn right', { exact: true }).locator('svg').innerHTML();
  expect(rightIconSvg).not.toEqual(leftIconSvg);
  await page.getByRole('button', { name: 'End route', exact: true }).click();
});

test('search results slide up over the map, then give way to the route view', async ({ page }) => {
  await page.getByRole('button', { name: 'Indoor Map', exact: true }).click();
  await expect(page.getByText('POSTGRES API', { exact: true })).toBeVisible();
  const sheet = page.getByLabel('Product finder sheet', { exact: true });
  // With no query the map is completely unobstructed.
  await expect(sheet).toBeHidden();

  const productSearch = page.getByRole('textbox', { name: 'Search store products', exact: true });
  await productSearch.fill('milk');
  const milkButton = page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true });
  await expect(milkButton).toBeVisible();
  await expect(sheet).toBeVisible();
  // The sheet slides up, but the map above it stays visible.
  await expect.poll(async () => (await sheet.boundingBox())?.y ?? Infinity).toBeLessThan(700);
  const openBox = await sheet.boundingBox();
  if (!openBox) throw new Error('Product finder sheet has no bounding box');
  const aisle7 = await page.getByText('AISLE 7', { exact: true }).boundingBox();
  expect(aisle7).not.toBeNull();
  expect(aisle7!.y).toBeLessThan(openBox.y);

  // Collapsing the sheet back down keeps the results but clears the map.
  await page.getByRole('button', { name: 'Collapse product finder sheet', exact: true }).click();
  await expect.poll(async () => (await sheet.boundingBox())?.y ?? 0).toBeGreaterThan(openBox.y + 40);

  await milkButton.click();
  // Picking a product switches to the route view: banner, bottom bar, no sheet.
  await expect(sheet).toBeHidden();
  await expect(page.getByLabel('Route banner', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Route progress bar', { exact: true })).toBeVisible();
});

test('shoppers see only the map and search, with no dashboard chrome', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('LIS · Store map');
  await expect(page.getByRole('textbox', { name: 'Search store products', exact: true })).toBeVisible();
  await expect(page.getByText('AISLE 4', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Product finder sheet', { exact: true })).toBeHidden();
  // No sidebar/nav, workspace picker, settings, or scanner info for shoppers.
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Fingerprints', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Scan History', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Indoor Map', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Workspace profile', exact: true })).toBeHidden();
  await expect(page.getByText('Hypermarket · Ground floor', { exact: true })).toBeHidden();
  await expect(page.getByText('Illustrative floor plan · access point positions are not measured', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Lock staff area', exact: true })).toBeHidden();
  // The backend/seed debug pill is staff-only too.
  await expect(page.getByText('SEED DATA', { exact: true })).toBeHidden();
  await expect(page.getByText('POSTGRES API', { exact: true })).toBeHidden();
});

test('staff login gates #staff and backend refuses unauthenticated report list, confirm, and reject', async ({ page }) => {
  expect(resolveTestApiUrl({})).toBe('http://127.0.0.1:3000');
  expect(resolveTestApiUrl({ TEST_API_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');

  // Unauthenticated backend requests to staff endpoints are refused with 401.
  const unauthList = await page.request.get(`${testApiUrl}/product-reports`);
  expect(unauthList.status()).toBe(401);
  const unauthConfirm = await page.request.post(`${testApiUrl}/product-reports/1/confirm`);
  expect(unauthConfirm.status()).toBe(401);
  const unauthReject = await page.request.post(`${testApiUrl}/product-reports/1/reject`);
  expect(unauthReject.status()).toBe(401);

  // Shoppers can still send a Not here report and check its decision without an account.
  const shopperCreate = await page.request.post(`${testApiUrl}/product-reports`, {
    data: { productId: 1, aisleNumber: 7, side: 'left', shelf: 'middle', mapY: 138, kind: 'moved' },
  });
  expect(shopperCreate.status()).toBe(201);
  const createdReport = (await shopperCreate.json()) as { id: number; status: string };
  expect(createdReport.status).toBe('pending');
  const shopperDecision = await page.request.get(`${testApiUrl}/product-reports/${createdReport.id}`);
  expect(shopperDecision.status()).toBe(200);

  // Clean up the test report as signed-in staff (reject leaves product untouched).
  const creds = readStaffCredentials();
  const staffLoginResp = await page.request.post(`${testApiUrl}/auth/login`, {
    data: creds,
  });
  expect(staffLoginResp.status()).toBe(200);
  const { token } = (await staffLoginResp.json()) as { token: string };
  const staffReject = await page.request.post(`${testApiUrl}/product-reports/${createdReport.id}/reject`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(staffReject.status()).toBe(201);
  // Tests must not leave rows behind in the real database.
  const staffDelete = await page.request.delete(`${testApiUrl}/product-reports/${createdReport.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(staffDelete.status()).toBe(200);
  const gone = await page.request.get(`${testApiUrl}/product-reports/${createdReport.id}`);
  expect(gone.status()).toBe(404);
  await page.request.post(`${testApiUrl}/auth/logout`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // beforeEach signed in on /#staff: all staff pages and the workspace picker are available.
  await expect(page).toHaveTitle('LIS · Staff');
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fingerprints', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan History', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock staff area', exact: true })).toBeVisible();

  // Locking signs out of the staff session and returns to the shopper map.
  await page.getByRole('button', { name: 'Lock staff area', exact: true }).click();
  await expect(page).toHaveTitle('LIS · Store map');
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Search store products', exact: true })).toBeVisible();

  // Re-opening /#staff requires signing in again; wrong credentials keep staff pages hidden.
  allowHttpErrors(page, { status: 401, urlEndsWith: '/auth/login' });
  await page.goto('/#staff');
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Staff username', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Staff username', exact: true }).fill(creds.username);
  await page.getByLabel('Staff password', { exact: true }).fill(`${creds.password}-wrong`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid username or password', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeHidden();

  await signInStaff(page, creds);
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fingerprints', exact: true })).toBeVisible();
});

test('a second staff decision on an already-decided report is told what counted, and the shelf stays put', async ({ page }) => {
  // A shopper reports Whole Milk moved from aisle 7 to aisle 2.
  const created = await page.request.post(`${testApiUrl}/product-reports`, {
    data: { productId: 1, aisleNumber: 2, side: 'left', shelf: 'middle', kind: 'moved' },
  });
  expect(created.status()).toBe(201);
  const report = (await created.json()) as { id: number };
  const row = page.getByLabel(`Location report ${report.id} for Whole Milk 1L`, { exact: true });

  // Another staff member signs in through the API and decides first.
  const otherLogin = await page.request.post(`${testApiUrl}/auth/login`, { data: readStaffCredentials() });
  expect(otherLogin.status()).toBe(200);
  const { token: otherToken } = (await otherLogin.json()) as { token: string };
  const otherHeaders = { Authorization: `Bearer ${otherToken}` };
  try {
    // This browser (beforeEach signed it in) opens the still-pending report.
    await page.getByRole('button', { name: 'Location reports', exact: true }).click();
    await expect(row.getByText('pending', { exact: true })).toBeVisible();
    const confirmButton = page.getByRole('button', { name: `Confirm report ${report.id}`, exact: true });
    await expect(confirmButton).toBeVisible();

    // The other staff member rejects it while this list is on screen.
    const otherReject = await page.request.post(`${testApiUrl}/product-reports/${report.id}/reject`, { headers: otherHeaders });
    expect(otherReject.status()).toBe(201);

    // Clicking Confirm now must not "succeed": it says what counted and
    // refreshes the list to show the decision.
    allowHttpErrors(page, { status: 409, urlEndsWith: `/product-reports/${report.id}/confirm` });
    await confirmButton.click();
    await expect(page.getByText('This report was already rejected.', { exact: true })).toBeVisible();
    await expect(row.getByText('rejected', { exact: true })).toBeVisible();
    await expect(confirmButton).toBeHidden();

    // The product never moved: the shelf matches the rejected status.
    const products = (await (await page.request.get(`${testApiUrl}/products?q=milk`)).json()) as { id: number; aisleNumber: number }[];
    expect(products.find((product) => product.id === 1)!.aisleNumber).toBe(7);
  } finally {
    await page.request.delete(`${testApiUrl}/product-reports/${report.id}`, { headers: otherHeaders });
    await page.request.post(`${testApiUrl}/auth/logout`, { headers: otherHeaders });
  }
});

test('a guessing script waits whatever device ids it fakes, staff devices that signed in before still get in, and a guessing browser sees its own countdown', async ({ page }) => {
  test.setTimeout(150_000);
  const creds = readStaffCredentials();
  allowHttpErrors(page, { status: 401, urlEndsWith: '/auth/login' });
  allowHttpErrors(page, { status: 429, urlEndsWith: '/auth/login' });
  const apiLogin = (data: { username: string; password: string }, headers: Record<string, string> = {}) =>
    page.request.post(`${testApiUrl}/auth/login`, { headers, data });
  const apiLogout = (token: string) =>
    page.request.post(`${testApiUrl}/auth/logout`, { headers: { Authorization: `Bearer ${token}` } });
  // A made-up token in the right shape, as a script would invent one.
  const fakeDeviceToken = () => `${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;

  // Another staff phone signed in earlier, so it holds a device token.
  const phoneFirstLogin = await apiLogin(creds);
  expect(phoneFirstLogin.status()).toBe(200);
  const phoneFirst = (await phoneFirstLogin.json()) as { token: string; deviceToken: string };
  expect(phoneFirst.deviceToken).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  await apiLogout(phoneFirst.token);
  const phone = { 'X-Device-Token': phoneFirst.deviceToken };

  // beforeEach signed this browser in; lock the area to get back to the sign-in screen.
  await page.getByRole('button', { name: 'Lock staff area', exact: true }).click();
  await page.goto('/#staff');
  const usernameInput = page.getByRole('textbox', { name: 'Staff username', exact: true });
  await expect(usernameInput).toBeVisible();
  const passwordInput = page.getByLabel('Staff password', { exact: true });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });

  // A script guesses 20 times, inventing a new device id and token every
  // time. Only the first five are plain 401s; then it has to wait.
  const statuses: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const guess = await apiLogin(
      { username: creds.username, password: `${creds.password}-wrong-${i}` },
      { 'X-Device-Token': fakeDeviceToken(), 'X-Client-Id': `made-up-device-${Date.now()}-${i}` },
    );
    statuses.push(guess.status());
  }
  expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
  expect(statuses.slice(5)).toEqual(Array(15).fill(429));
  const lockedApi = await apiLogin(creds, { 'X-Device-Token': fakeDeviceToken() });
  expect(lockedApi.status()).toBe(429);
  expect(Number(lockedApi.headers()['retry-after'])).toBeGreaterThan(0);
  const lockedBody = (await lockedApi.json()) as { retryAfterSeconds: number; message: string };
  expect(lockedBody.retryAfterSeconds).toBeGreaterThan(0);
  expect(lockedBody.message).toContain('Try again in');

  // Staff devices that signed in before are not locked out by the script:
  // the other phone and this browser both sign in with the right password.
  const phoneDuringScriptLock = await apiLogin(creds, phone);
  expect(phoneDuringScriptLock.status()).toBe(200);
  await apiLogout(((await phoneDuringScriptLock.json()) as { token: string }).token);
  await signInStaff(page, creds);
  await expect(page.getByRole('button', { name: 'Scan networks', exact: true })).toBeEnabled();
  // ...while the account was (and still is) locked for unknown devices.
  expect((await apiLogin(creds)).status()).toBe(429);

  // Now this browser guesses wrong itself. Five wrong passwords are plain
  // 401s with the normal error message.
  await page.getByRole('button', { name: 'Lock staff area', exact: true }).click();
  await page.goto('/#staff');
  await expect(usernameInput).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await usernameInput.fill(creds.username);
    await passwordInput.fill(`${creds.password}-wrong-${i}`);
    await signInButton.click();
    await expect(page.getByText('Invalid username or password', { exact: false })).toBeVisible();
  }

  // The next try is refused with a wait — even with the correct password —
  // and the screen says how long, with the button disabled while counting.
  await passwordInput.fill(creds.password);
  await signInButton.click();
  const waitBanner = page.getByLabel('Sign-in wait', { exact: true });
  await expect(waitBanner).toBeVisible();
  await expect(waitBanner.getByText(/^Too many failed sign-in attempts\. You can try again in \d+s\.$/)).toBeVisible();
  await expect(signInButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Wi-Fi Scanner', exact: true })).toBeHidden();

  // The countdown ticks down instead of freezing at its first value.
  const secondsLeft = async () => {
    const text = (await waitBanner.textContent()) ?? '';
    return Number.parseInt(text.match(/in (\d+)s/)?.[1] ?? '0', 10);
  };
  const first = await secondsLeft();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(30);
  await expect.poll(secondsLeft, { timeout: 6_000 }).toBeLessThan(first);

  // The browser's own guessing does not make the other phone wait.
  const phoneDuringBrowserLock = await apiLogin(creds, phone);
  expect(phoneDuringBrowserLock.status()).toBe(200);
  await apiLogout(((await phoneDuringBrowserLock.json()) as { token: string }).token);

  // Once the wait passes the banner clears, the button re-enables, and the
  // correct password signs in and resets this browser's counters.
  await expect(waitBanner).toBeHidden({ timeout: 40_000 });
  await expect(signInButton).toBeEnabled();
  await signInStaff(page, creds);
  await expect(page.getByRole('button', { name: 'Scan networks', exact: true })).toBeEnabled();

  // The script's wait is over by now too: a new device signs in again, which
  // clears the account's counter for later tests.
  await expect.poll(async () => {
    const attempt = await apiLogin(creds);
    if (attempt.status() === 200) await apiLogout(((await attempt.json()) as { token: string }).token);
    return attempt.status();
  }, { timeout: 40_000, intervals: [1_000, 2_000] }).toBe(200);
  const afterReset = await apiLogin({ username: creds.username, password: `${creds.password}-wrong` });
  expect(afterReset.status()).toBe(401);
});

test('shopper completes an ordered shopping-list route on desktop', async ({ page }) => {
  await completeShoppingList(page);
});

test('shopper edits a list, finds a same-aisle product, and End keeps the rest on desktop', async ({ page }) => {
  await cancelShoppingList(page);
});

test('shopping list stays on the phone after a refresh', async ({ page }) => {
  await shoppingListSurvivesReload(page);
});

test('shopper taps the map to set, save, update, and reset the route start', async ({ page }) => {
  await setLocationByTapping(page);
});

test('tapped spot is forgotten when a trip ends or finishes or after over an hour away', async ({ page }) => {
  await forgetTappedLocationOnEndFinishAndAfterHour(page);
});

test('aisle names stay readable wherever the YOU dot lands, including the corridor at aisle 6', async ({ page }) => {
  test.setTimeout(120_000);
  await aisleNamesStayReadableAroundShopper(page);
});

test('a mid-trip tap replans the current list leg from that spot without changing its target', async ({ page }) => {
  const requests: { start: MapPoint; keepFirst?: boolean }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/walk/route') {
      requests.push(request.postDataJSON() as { start: MapPoint; keepFirst?: boolean });
    }
  });
  await page.goto('/');
  for (const [query, name] of [['milk', 'Whole Milk 1L'], ['bread', 'Sourdough Bread']] as const) {
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill(query);
    await page.getByRole('button', { name: `Add ${name} to shopping list`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  const banner = page.getByLabel('Route banner', { exact: true });
  await expect(banner.getByText('Stop 1 of 2 · Whole Milk 1L', { exact: true })).toBeVisible();
  await expect.poll(() => requests.at(-1)?.start).toEqual({ x: 345, y: 268 });

  await tapShopperPoint(page, { x: 79, y: 240 });
  await expect.poll(() => {
    const start = requests.at(-1)?.start;
    return !!start && Math.abs(start.x - 79) < 1 && Math.abs(start.y - 240) < 1;
  }).toBe(true);
  await expect.poll(() => requests.at(-1)?.keepFirst).toBe(true);
  await expect(banner.getByText('Stop 1 of 2 · Whole Milk 1L', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Route progress bar', { exact: true }).getByText(/^\d+\.\d m remaining$/)).toBeVisible();

  // Once the milk is found, the next backend leg starts at the milk shelf,
  // not at the older manual point or the entrance.
  await page.getByRole('button', { name: 'Found it', exact: true }).click();
  await expect(banner.getByText('Stop 2 of 2 · Sourdough Bread', { exact: true })).toBeVisible();
  await expect.poll(() => requests.at(-1)).toMatchObject({ start: { x: 525, y: 138 }, keepFirst: true });
});

test('Not here: pick aisle, side, and shelf; the route and saved lists follow the move on desktop', async ({ page }) => {
  await reportMovedProduct(page);
});

test('Not here on a searched product refreshes the route once for the new shelf, without a request flood', async ({ page }) => {
  await reportSearchedProduct(page);
});

type WalkNodePayload = { id: number; mapX: number; mapY: number; label: string };
type WalkEdgePayload = { id: number; fromNodeId: number; toNodeId: number; blocked: boolean; name: string };
type WalkGraphPayload = { nodes: WalkNodePayload[]; edges: WalkEdgePayload[] };

/** Route polyline(s) currently drawn on the store map ("M x y L …"). */
async function routePathData(page: Page): Promise<string> {
  const paths = await page.evaluate(() =>
    Array.from(document.querySelectorAll('svg path'))
      .map((path) => path.getAttribute('d') ?? '')
      .filter((d) => /^M [-\d.]+ [-\d.]+ L /.test(d)),
  );
  return paths.join(' ');
}

/**
 * Switch between the shopper map and the staff area in place. `goto` would
 * reload the document and drop the running route; the app reads the hash
 * change itself, exactly like a shopper opening `#staff` in the tab bar.
 */
async function setStaffHash(page: Page, hash: '#staff' | ''): Promise<void> {
  await page.evaluate((value) => { window.location.hash = value; }, hash);
}

test('walk edits replan open shopper routes and closed shelves never get a fallback path', async ({ page }) => {
  test.setTimeout(150_000); // two assertions wait for the real 20-second path poll
  const initialResponse = await page.request.get(`${testApiUrl}/walk-graph`);
  expect(initialResponse.status()).toBe(200);
  const initial = (await initialResponse.json()) as WalkGraphPayload;
  expect(initial.nodes.length).toBeGreaterThan(20);
  expect(initial.edges.length).toBeGreaterThan(20);
  expect((await page.request.post(`${testApiUrl}/walk/edges`, { data: { fromNodeId: 1, toNodeId: 2 } })).status()).toBe(401);
  expect((await page.request.post(`${testApiUrl}/walk/edges/1/blocked`, { data: { blocked: true } })).status()).toBe(401);
  expect((await page.request.delete(`${testApiUrl}/walk/edges/1`)).status()).toBe(401);

  const nodeAt = (x: number, y: number): WalkNodePayload => {
    const node = initial.nodes.find(candidate => candidate.mapX === x && candidate.mapY === y);
    expect(node, `junction at ${x},${y}`).toBeTruthy();
    return node!;
  };
  const edgeBetween = (a: WalkNodePayload, b: WalkNodePayload): WalkEdgePayload => {
    const edge = initial.edges.find(candidate =>
      (candidate.fromNodeId === a.id && candidate.toNodeId === b.id)
      || (candidate.fromNodeId === b.id && candidate.toNodeId === a.id));
    expect(edge, `connection ${a.label} to ${b.label}`).toBeTruthy();
    return edge!;
  };
  const corridor = edgeBetween(nodeAt(345, 240), nodeAt(387, 240));
  const milkSection = edgeBetween(nodeAt(541, 151), nodeAt(541, 88));
  const aisle1Entrance = edgeBetween(nodeAt(79, 240), nodeAt(79, 215));
  const aisle1BackLink = edgeBetween(nodeAt(79, 55), nodeAt(156, 55));
  const addFrom = nodeAt(79, 55);
  const addTo = nodeAt(233, 55);

  const login = await page.request.post(`${testApiUrl}/auth/login`, { data: readStaffCredentials() });
  expect(login.status()).toBe(200);
  const { token: staffToken } = await login.json() as { token: string };
  const staffHeaders = { Authorization: `Bearer ${staffToken}` };
  const setBlocked = (id: number, blocked: boolean) => page.request.post(`${testApiUrl}/walk/edges/${id}/blocked`, { headers: staffHeaders, data: { blocked } });
  const restoreWalkPaths = async () => {
    await setBlocked(corridor.id, false);
    await setBlocked(milkSection.id, false);
    await setBlocked(aisle1Entrance.id, false);
    await setBlocked(aisle1BackLink.id, false);
    const current = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as WalkGraphPayload;
    const leftover = current.edges.find(edge =>
      (edge.fromNodeId === addFrom.id && edge.toNodeId === addTo.id)
      || (edge.fromNodeId === addTo.id && edge.toNodeId === addFrom.id));
    if (leftover) await page.request.delete(`${testApiUrl}/walk/edges/${leftover.id}`, { headers: staffHeaders });
  };
  await restoreWalkPaths();

  try {
    // The public backend endpoint, not app code, supplies points and distance.
    const direct = await page.request.post(`${testApiUrl}/walk/route`, {
      data: { start: { x: 345, y: 268 }, products: [{ id: 1, mapX: 525, mapY: 138 }] },
    });
    expect(direct.status()).toBe(201);
    const directBody = await direct.json() as { stops: { productId: number; route: { meters: number } | null }[] };
    expect(directBody.stops[0].route?.meters).toBe(34.2);

    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
    await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).click();
    const banner = page.getByLabel('Route banner', { exact: true });
    const bar = page.getByLabel('Route progress bar', { exact: true });
    await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
    await expect.poll(() => routePathData(page)).not.toBe('');
    const openPath = await routePathData(page);
    expect(openPath).not.toMatch(/(^| )\d+ 55( |$)/);

    // Change the path outside this browser, like another staff device would.
    // No reload and no staff UI here: the shopper's 20-second poll must see it.
    const blockedResponse = await setBlocked(corridor.id, true);
    expect(blockedResponse.status()).toBe(201);
    await expect(blockedResponse.json()).resolves.toMatchObject({
      id: corridor.id,
      blocked: true,
      name: 'Corridor · entrance to aisle 5',
    });
    await expect(bar.getByText('57.8 m from entrance', { exact: true })).toBeVisible({ timeout: 35_000 });
    await expect(banner.getByText('Turn into aisle 4, via back walkway to aisle 7', { exact: true })).toBeVisible();
    await expect(banner.getByText('Front corridor closed · 57.8 m to Whole Milk 1L', { exact: true })).toBeVisible();
    await expect(banner.getByLabel('Walk left', { exact: true })).toBeVisible();
    await expect.poll(() => routePathData(page)).toMatch(/(^| )\d+ 55( |$)/);
    const shopperMap = page.getByRole('img', { name: 'Store map', exact: true });
    await expect(shopperMap.getByLabel('Closed walkway: Corridor · entrance to aisle 5', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel(/^Open walkway:/)).toHaveCount(0);

    // Staff see every walkway drawn on the Walk paths map and can click one directly to reopen or block it.
    await setStaffHash(page, '#staff');
    await page.getByRole('button', { name: 'Walk paths', exact: true }).click();
    const list = page.getByLabel('Walk paths list', { exact: true });
    const staffWalkMap = page.getByLabel('Walk paths map', { exact: true });
    const staffWalkSvg = page.getByRole('img', { name: 'Walk paths store map', exact: true });
    await expect(staffWalkMap).toBeVisible();
    await expect(staffWalkSvg.getByLabel('Closed walkway: Corridor · entrance to aisle 5', { exact: true })).toBeVisible();
    await expect(staffWalkSvg.getByLabel(/^Open walkway:/)).toHaveCount(initial.edges.length - 1);
    await expect(list.getByText('Corridor · entrance to aisle 5', { exact: true })).toBeVisible();
    await staffWalkMap.getByRole('button', { name: 'Reopen walkway: Corridor · entrance to aisle 5', exact: true }).click();
    await expect(staffWalkMap.getByRole('button', { name: 'Block walkway: Corridor · entrance to aisle 5', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Block connection ${corridor.id}`, exact: true })).toBeVisible();
    await setStaffHash(page, '');
    await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
    await expect(banner.getByText('Turn into aisle 7, left side, middle shelf', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel(/^Closed walkway:/)).toHaveCount(0);

    // Close the exact section containing the milk by clicking it on the Walk paths map.
    // No route or normal turn instruction may survive, and the closed section is drawn on the shopper map.
    await setStaffHash(page, '#staff');
    await page.getByRole('button', { name: 'Walk paths', exact: true }).click();
    await expect(list.getByText('Aisle 7 · middle to back end', { exact: true })).toBeVisible();
    await staffWalkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · middle to back end', exact: true }).click();
    await expect(staffWalkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · middle to back end', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Reopen connection ${milkSection.id}`, exact: true })).toBeVisible();
    await setStaffHash(page, '');
    await expect(banner.getByText('Aisle 7 is closed right now', { exact: true })).toBeVisible();
    await expect(bar.getByText('Aisle 7 closed · no open walk to this shelf', { exact: true })).toBeVisible();
    await expect(banner.getByText('Turn into aisle 7, left side, middle shelf', { exact: true })).toBeHidden();
    await expect.poll(() => routePathData(page)).toBe('');
    const closedMilkWalkway = shopperMap.getByLabel('Closed walkway: Aisle 7 · middle to back end', { exact: true });
    await expect(closedMilkWalkway).toBeVisible();
    const closedBox = await closedMilkWalkway.boundingBox();
    const milkChipBox = await shopperMap.getByText('Whole Milk 1L', { exact: true }).boundingBox();
    expect(closedBox).not.toBeNull();
    expect(milkChipBox).not.toBeNull();
    // On desktop, the Milk chip flips below the pin so the closed middle-to-back section stays uncovered.
    expect(milkChipBox!.y).toBeGreaterThan(closedBox!.y + closedBox!.height - 4);

    await setStaffHash(page, '#staff');
    await page.getByRole('button', { name: 'Walk paths', exact: true }).click();
    await staffWalkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · middle to back end', exact: true }).click();
    await expect(staffWalkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · middle to back end', exact: true })).toBeVisible();
    await setStaffHash(page, '');
    await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel(/^Closed walkway:/)).toHaveCount(0);

    // The reported junction case: close the walkway between the corridor
    // junction below aisle 1 and the aisle entrance. A shopper standing
    // right at that junction must get the open detour, never a straight
    // step up the closed strip; with the back detour sealed, no route.
    const breadProducts = (await (await page.request.get(`${testApiUrl}/products?q=sourdough`)).json()) as { id: number; mapX: number; mapY: number }[];
    expect(breadProducts.length).toBeGreaterThan(0);
    const breadPin = breadProducts[0];
    const routeFromJunction = async () => {
      const response = await page.request.post(`${testApiUrl}/walk/route`, {
        data: { start: { x: 79, y: 240 }, products: [{ id: breadPin.id, mapX: breadPin.mapX, mapY: breadPin.mapY }] },
      });
      const body = await response.json() as { stops: { route: { points: { x: number; y: number }[]; meters: number } | null }[] };
      return body.stops[0].route;
    };
    const openLeg = await routeFromJunction();
    expect(openLeg).not.toBeNull();
    await setBlocked(aisle1Entrance.id, true);
    const junctionLeg = await routeFromJunction();
    expect(junctionLeg).not.toBeNull();
    expect(junctionLeg!.meters).toBeGreaterThan(openLeg!.meters);
    expect(junctionLeg!.points.some(point => point.y === 55)).toBe(true);
    const walksClosedStrip = junctionLeg!.points.some((point, index) => {
      if (index === 0) return false;
      const previous = junctionLeg!.points[index - 1];
      if (Math.abs(previous.x - 79) > 0.01 || Math.abs(point.x - 79) > 0.01) return false;
      const lo = Math.max(Math.min(previous.y, point.y), 215);
      const hi = Math.min(Math.max(previous.y, point.y), 240);
      return hi - lo > 0.01 && lo < 239.99 && hi > 215.01;
    });
    expect(walksClosedStrip).toBe(false);

    // In the shopper UI: tap the junction with the bread route open. The
    // bar shows the detour distance, and the drawn path uses the back walkway.
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('sourdough');
    await page.getByRole('button', { name: /^Select product Sourdough Bread/ }).click();
    await expect(banner.getByText('Turn into aisle 4, via back walkway to aisle 1', { exact: true })).toBeVisible();
    const fromEntranceIcon = banner.getByLabel('Walk left', { exact: true }).locator('svg');
    await expect(fromEntranceIcon).toBeVisible();
    const leftGlyph = await fromEntranceIcon.innerHTML();
    await tapShopperPoint(page, { x: 79, y: 240 });
    const spotMeters = async () => {
      const text = (await bar.textContent()) ?? '';
      return Number.parseFloat(text.match(/([\d.]+) m from your spot/)?.[1] ?? 'NaN');
    };
    await expect.poll(async () => Math.abs((await spotMeters()) - junctionLeg!.meters)).toBeLessThanOrEqual(0.15);
    await expect.poll(() => routePathData(page)).toMatch(/(^| )\d+ 55( |$)/);
    await expect(banner.getByText('Turn into aisle 2, via back walkway to aisle 1', { exact: true })).toBeVisible();
    await expect(banner.getByText(/^Aisle 1 entrance closed · [\d.]+ m to Sourdough Bread$/)).toBeVisible();
    const fromJunctionIcon = banner.getByLabel('Walk right', { exact: true }).locator('svg');
    await expect(fromJunctionIcon).toBeVisible();
    expect(await fromJunctionIcon.innerHTML()).not.toEqual(leftGlyph);
    await expect(banner.getByText('Turn into aisle 1, right side, top shelf', { exact: true })).toBeHidden();

    // Seal aisle 1's only other entrance: the shopper is told it is closed.
    await setBlocked(aisle1BackLink.id, true);
    await expect(banner.getByText('Aisle 1 is closed right now', { exact: true })).toBeVisible({ timeout: 35_000 });
    await expect(bar.getByText('Aisle 1 closed · no open walk to this shelf', { exact: true })).toBeVisible();
    await expect.poll(() => routePathData(page)).toBe('');
    await setBlocked(aisle1BackLink.id, false);
    await setBlocked(aisle1Entrance.id, false);
    // Reopened: the short walk through the aisle entrance is legal again.
    await expect.poll(async () => Math.abs((await spotMeters()) - openLeg!.meters), { timeout: 35_000 }).toBeLessThanOrEqual(0.15);
    await expect(banner.getByText('Turn into aisle 1, right side, top shelf', { exact: true })).toBeVisible();

    // Add, then verify Remove asks first and Keep leaves the graph untouched.
    await setStaffHash(page, '#staff');
    await page.getByRole('button', { name: 'Walk paths', exact: true }).click();
    const beforeAdd = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as WalkGraphPayload;
    await list.getByRole('button', { name: 'From junction: Back walkway · aisle 1', exact: true }).click();
    await list.getByRole('button', { name: 'To junction: Back walkway · aisle 3', exact: true }).click();
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    const afterAdd = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as WalkGraphPayload;
    expect(afterAdd.edges).toHaveLength(beforeAdd.edges.length + 1);
    const created = afterAdd.edges.find(edge =>
      (edge.fromNodeId === addFrom.id && edge.toNodeId === addTo.id)
      || (edge.fromNodeId === addTo.id && edge.toNodeId === addFrom.id));
    expect(created).toBeTruthy();
    await page.getByRole('button', { name: `Remove connection ${created!.id}`, exact: true }).click();
    const confirmation = page.getByLabel('Confirm walk path removal', { exact: true });
    await expect(confirmation).toBeVisible();
    let current = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as WalkGraphPayload;
    expect(current.edges.some(edge => edge.id === created!.id)).toBe(true);
    await page.getByRole('button', { name: 'Keep connection', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await page.getByRole('button', { name: `Remove connection ${created!.id}`, exact: true }).click();
    await page.getByRole('button', { name: `Confirm remove connection ${created!.id}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Remove connection ${created!.id}`, exact: true })).toBeHidden();
    current = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as WalkGraphPayload;
    expect(current.edges).toHaveLength(beforeAdd.edges.length);
  } finally {
    await restoreWalkPaths();
    await page.request.post(`${testApiUrl}/auth/logout`, { headers: staffHeaders });
  }
});

test('product search debounces backend requests while typing', async ({ page }) => {
  // Staff map view: the POSTGRES API pill confirms the backend is live.
  await page.getByRole('button', { name: 'Indoor Map', exact: true }).click();
  await expect(page.getByText('POSTGRES API', { exact: true })).toBeVisible();
  let productRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/products') productRequests += 1;
  });
  const productSearch = page.getByRole('textbox', { name: 'Search store products', exact: true });
  await productSearch.pressSequentially('milk', { delay: 60 });
  expect(productRequests).toBe(0);
  const milkButton = page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true });
  await expect(milkButton).toBeVisible();
  await expect.poll(() => productRequests).toBe(1);
});
