import { test, expect, allowHttpErrors, networkRows, openScanner, readStaffCredentials, runScan, signInStaff, testApiUrl } from './fixtures';
import { chipOverRoute, completeShoppingList, cancelShoppingList, shoppingListSurvivesReload } from './shopping';
import { reportMovedProduct, reportSearchedProduct } from './reports';
import { aisleNamesStayReadableAroundShopper, forgetTappedLocationOnEndFinishAndAfterHour, setLocationByTapping } from './positioning';

test.beforeEach(async ({ page }) => {
  await openScanner(page);
});

test('390x844 navigation opens, closes, and navigates between pages', async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(open).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await open.tap();
  const navigation = page.getByRole('dialog');
  for (const name of ['Wi-Fi Scanner', 'Indoor Map', 'Fingerprints', 'Scan History', 'Location reports', 'Walk paths', 'Settings']) {
    await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // The walk-paths editor is usable on the phone: rows wrap, buttons stay tappable.
  await navigation.getByRole('button', { name: 'Walk paths', exact: true }).tap();
  await expect(navigation).toBeHidden();
  await expect(page.getByLabel('Walk paths list', { exact: true })).toBeVisible();
  await expect(page.getByText('Walkable paths', { exact: true })).toBeVisible();
  const firstBlock = page.getByRole('button', { name: /^Block connection \d+$/ }).first();
  const blockBox = await firstBlock.boundingBox();
  expect(blockBox).not.toBeNull();
  expect(blockBox!.height).toBeGreaterThanOrEqual(34);
  const firstRow = page.getByLabel(/^Walk connection \d+:/).first();
  const connectionName = (await firstRow.getAttribute('aria-label')) ?? '';
  await firstRow.getByRole('button', { name: /^Remove connection \d+$/, exact: true }).tap();
  const confirmation = page.getByLabel('Confirm walk path removal', { exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText('Remove this connection?', { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep connection', exact: true }).tap();
  await expect(confirmation).toBeHidden();
  await expect(page.getByLabel(connectionName, { exact: true })).toBeVisible();
  await open.tap();
  await navigation.getByRole('button', { name: 'Wi-Fi Scanner', exact: true }).tap();
  await expect(navigation).toBeHidden();
  await expect(page.getByRole('button', { name: 'Scan networks', exact: true })).toBeVisible();
  await expect(networkRows(page)).toHaveCount(8);

  // Mobile staff drawer can sign out and lock the staff area; #staff then asks to sign in again.
  await open.tap();
  await navigation.getByRole('button', { name: 'Lock staff area', exact: true }).tap();
  await expect(page).toHaveTitle('LIS · Store map');
  await page.goto('/#staff');
  await expect(open).toBeHidden();
  await signInStaff(page);
  await expect(open).toBeVisible();
});

test('shopper mobile map has no dashboard, menu, workspace, or settings', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('LIS · Store map');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Workspace profile', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Search store products', exact: true })).toBeVisible();
  await expect(page.getByText('Hypermarket · Ground floor', { exact: true })).toBeHidden();
  await expect(page.getByText('SEED DATA', { exact: true })).toBeHidden();
  await expect(page.getByText('POSTGRES API', { exact: true })).toBeHidden();
});

test('390x844 shopper map fills the portrait screen, stays clear of search, and does not duplicate the selected product', async ({ page }) => {
  await page.goto('/');
  const searchBox = page.getByRole('textbox', { name: 'Search store products', exact: true });
  await expect(searchBox).toBeVisible();
  const searchBounds = await searchBox.boundingBox();
  expect(searchBounds).not.toBeNull();

  // The portrait floor plan fills the tall screen: aisle labels sit well
  // below the floating search box and are rendered at a readable size.
  const aisle = page.getByText('AISLE 7', { exact: true });
  await expect(aisle).toBeVisible();
  const aisleBounds = await aisle.boundingBox();
  expect(aisleBounds).not.toBeNull();
  expect(aisleBounds!.y).toBeGreaterThan(searchBounds!.y + searchBounds!.height);
  expect(aisleBounds!.height).toBeGreaterThanOrEqual(10);
  const entranceBounds = await page.getByText('ENTRANCE / CHECKOUT', { exact: true }).boundingBox();
  expect(entranceBounds).not.toBeNull();
  // Drawn map content reaches into the lower half of the phone screen.
  expect(entranceBounds!.y).toBeGreaterThan(844 * 0.35);

  await searchBox.fill('milk');
  const milkButton = page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true });
  await expect(milkButton).toBeVisible();
  await milkButton.click();

  const bar = page.getByLabel('Route progress bar', { exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.getByText('Aisle 7, left, middle shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
  const banner = page.getByLabel('Route banner', { exact: true });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Turn into aisle 7, left side, middle shelf', { exact: true })).toBeVisible();
  await expect(banner.getByLabel('Turn left', { exact: true })).toBeVisible();
  // The selected product is no longer repeated as a result row.
  await expect(milkButton).toBeHidden();

  // No aisle is hidden under the bottom bar, so any product stays visible.
  const barBounds = await bar.boundingBox();
  expect(barBounds).not.toBeNull();
  for (const aisleText of ['AISLE 7', 'AISLE 8']) {
    const box = await page.getByText(aisleText, { exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(barBounds!.y);
  }

  // The pin label stays on the visible map, between the banner and the bar.
  const pinLabel = page.getByText('Whole Milk 1L', { exact: true }).first();
  const pinBounds = await pinLabel.boundingBox();
  const bannerBounds = await banner.boundingBox();
  expect(pinBounds).not.toBeNull();
  expect(bannerBounds).not.toBeNull();
  expect(pinBounds!.y).toBeGreaterThan(bannerBounds!.y + bannerBounds!.height);
  expect(pinBounds!.y + pinBounds!.height).toBeLessThan(barBounds!.y);

  // End stops the route and brings the search box back.
  await page.getByRole('button', { name: 'End route', exact: true }).click();
  await expect(bar).toBeHidden();
  await expect(searchBox).toBeVisible();
});

test('product search preserves typed names and the sheet fits a short usable viewport', async ({ page }) => {
  await page.goto('/');
  const searchBox = page.getByRole('textbox', { name: 'Search store products', exact: true });
  await expect(searchBox).toHaveAttribute('autocapitalize', 'none');
  await expect(searchBox).toHaveAttribute('autocorrect', 'off');
  await expect(searchBox).toHaveAttribute('spellcheck', 'false');
  await expect(searchBox).toHaveAttribute('autocomplete', 'off');

  // Exercise the sizing path used when a keyboard shrinks the map container.
  // Actual iOS keyboard coverage is tested separately in e2e/native.
  await page.setViewportSize({ width: 390, height: 380 });
  await searchBox.fill('milk');
  await expect(searchBox).toHaveValue('milk');
  const row = page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true });
  await expect(row).toBeVisible();
  const sheet = page.getByLabel('Product finder sheet', { exact: true });
  await expect.poll(async () => {
    const searchBounds = await searchBox.boundingBox();
    const sheetBounds = await sheet.boundingBox();
    if (!searchBounds || !sheetBounds) return false;
    return sheetBounds.y >= searchBounds.y + searchBounds.height + 12
      && sheetBounds.y + sheetBounds.height <= 380;
  }).toBe(true);
  await row.tap();
  await expect(page.getByLabel('Route progress bar', { exact: true })).toBeVisible();
});

test('the Sourdough Bread label sits below its pin, so the route into aisle 1 and up to the pin stays visible on the phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('bread');
  await page.getByRole('button', { name: 'Select product Sourdough Bread, Aisle 1, right, top shelf', exact: true }).tap();
  const bar = page.getByLabel('Route progress bar', { exact: true });
  await expect(bar.getByText(/^\d+\.\d m from entrance$/)).toBeVisible();
  // Bread is on the right of aisle 1, so the walkway (and the line) runs
  // just above the pin: the label has to go on the other side.
  await expect.poll(() => chipOverRoute(page, 'Sourdough Bread')).toEqual({ hidden: 0, belowPin: true });
  const map = page.getByRole('img', { name: 'Store map', exact: true });
  const label = await map.getByText('Sourdough Bread', { exact: true }).boundingBox();
  const banner = await page.getByLabel('Route banner', { exact: true }).boundingBox();
  const barBounds = await bar.boundingBox();
  const aisleName = await map.getByText('AISLE 1', { exact: true }).boundingBox();
  expect(label).not.toBeNull();
  expect(banner).not.toBeNull();
  expect(barBounds).not.toBeNull();
  expect(aisleName).not.toBeNull();
  // Moving it did not push it under the banner, the bar, or the aisle name.
  expect(label!.y).toBeGreaterThan(banner!.y + banner!.height);
  expect(label!.y + label!.height).toBeLessThan(barBounds!.y);
  expect(label!.x + label!.width).toBeLessThan(aisleName!.x);
});

test('shopper completes an ordered shopping-list route on iPhone', async ({ page }) => {
  await completeShoppingList(page);
});

test('shopper edits a list, finds a same-aisle product, and End keeps the rest on iPhone', async ({ page }) => {
  await cancelShoppingList(page);
});

test('shopping list stays on the phone after a refresh', async ({ page }) => {
  await shoppingListSurvivesReload(page);
});

test('iPhone shopper taps the map to set, save, update, and reset the route start', async ({ page }) => {
  await setLocationByTapping(page);
});

test('iPhone shopper tapped spot is forgotten when a trip ends or finishes or after over an hour away', async ({ page }) => {
  await forgetTappedLocationOnEndFinishAndAfterHour(page);
});

test('iPhone aisle names stay readable wherever the YOU dot lands, including the back walkway at aisle 6', async ({ page }) => {
  test.setTimeout(120_000);
  await aisleNamesStayReadableAroundShopper(page);
});

test('a second iPhone signs in while another device is locked out on the same store Wi-Fi', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const creds = readStaffCredentials();
  allowHttpErrors(page, { status: 401, urlEndsWith: '/auth/login' });
  allowHttpErrors(page, { status: 429, urlEndsWith: '/auth/login' });

  // This phone guesses wrong five times and is told to wait.
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: 'Lock staff area', exact: true }).tap();
  await page.goto('/#staff');
  const usernameInput = page.getByRole('textbox', { name: 'Staff username', exact: true });
  await expect(usernameInput).toBeVisible();
  const passwordInput = page.getByLabel('Staff password', { exact: true });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  for (let i = 0; i < 5; i += 1) {
    await usernameInput.fill(creds.username);
    await passwordInput.fill(`${creds.password}-wrong-${i}`);
    await signInButton.click();
    await expect(page.getByText('Invalid username or password', { exact: false })).toBeVisible();
  }
  await passwordInput.fill(creds.password);
  await signInButton.click();
  await expect(page.getByLabel('Sign-in wait', { exact: true })).toBeVisible();
  await expect(signInButton).toBeDisabled();

  // A different phone on the same network (one that has never signed in
  // here) is not locked by this phone's guessing: a wrong try with another
  // username is a plain error with no wait, and the right password for
  // "staff" signs straight in.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript((url: string) => {
    (window as unknown as { __LIS_API_URL__: string }).__LIS_API_URL__ = url;
  }, testApiUrl);
  const phone = await context.newPage();
  try {
    await phone.goto('/#staff');
    const otherUser = phone.getByRole('textbox', { name: 'Staff username', exact: true });
    await expect(otherUser).toBeVisible();
    const otherPass = phone.getByLabel('Staff password', { exact: true });
    const otherButton = phone.getByRole('button', { name: 'Sign in', exact: true });
    await otherUser.fill('someone-else');
    await otherPass.fill('not-the-password');
    await otherButton.click();
    await expect(phone.getByText('Invalid username or password', { exact: false })).toBeVisible();
    await expect(phone.getByLabel('Sign-in wait', { exact: true })).toBeHidden();

    await otherUser.fill(creds.username);
    await otherPass.fill(creds.password);
    await otherButton.click();
    await expect(otherUser).toBeHidden();
    await expect(phone.getByRole('button', { name: 'Scan networks', exact: true })).toBeEnabled();
  } finally {
    const saved = await phone.evaluate((key) => localStorage.getItem(key), 'lis.staff-session').catch(() => null);
    const token = saved ? (JSON.parse(saved) as { token?: unknown }).token : null;
    if (typeof token === 'string' && token) {
      await phone.request.post(`${testApiUrl}/auth/logout`, { headers: { Authorization: `Bearer ${token}` } });
    }
    await context.close();
  }

  // The guessing phone keeps its own wait; the other phone's sign-in did not clear it.
  await expect(page.getByLabel('Sign-in wait', { exact: true })).toBeVisible();
});

test('Not here: pick aisle, side, and shelf; the route and saved lists follow the move on iPhone', async ({ page }) => {
  await reportMovedProduct(page);
});

test('Not here on a searched product refreshes the route once for the new shelf on iPhone, without a request flood', async ({ page }) => {
  await reportSearchedProduct(page);
});

test('scanner heading and cards stay within mobile and tablet viewports', async ({ page }) => {
  for (const width of [360, 390, 760, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const text of [
      'Discover nearby networks. Understand your signal landscape.',
      'Frequency bands',
      'Nearby networks',
    ]) {
      const bounds = await page.getByText(text, { exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
});

test('390x844 scan completes and its history can be viewed from the menu', async ({ page }) => {
  await runScan(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  const navigation = page.getByRole('dialog');
  await navigation.getByRole('button', { name: 'Scan History', exact: true }).tap();
  await expect(navigation).toBeHidden();
  await expect(page.getByText('8 networks discovered', { exact: true })).toBeVisible();
  await expect(page.getByText(/· Demo scan$/)).toBeVisible();
  await page.getByRole('button', { name: 'View scan', exact: true }).tap();
  await expect(networkRows(page)).toHaveCount(8);
  await expect(page.getByText('Showing 8 of 8 networks', { exact: true })).toBeVisible();
  await networkRows(page).first().tap();
  const details = page.getByRole('dialog');
  await expect(details.getByText('HyperMarket_Main', { exact: true })).toBeVisible();
  await expect(details.getByText('Connected to this network', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Close dialog', exact: true }).tap();
  await expect(details).toBeHidden();
});

test('390x844 staff taps walkways on the Walk paths map without scrolling and shoppers see closed walkways on the map', async ({ page }) => {
  const login = await page.request.post(`${testApiUrl}/auth/login`, { data: readStaffCredentials() });
  expect(login.status()).toBe(200);
  const { token } = (await login.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const initial = (await (await page.request.get(`${testApiUrl}/walk-graph`)).json()) as {
    edges: { id: number; name: string; blocked: boolean }[];
  };
  const frontAisle7 = initial.edges.find((edge) => edge.name === 'Aisle 7 · entrance end to middle');
  const backAisle7 = initial.edges.find((edge) => edge.name === 'Aisle 7 · middle to back end');
  expect(frontAisle7).toBeTruthy();
  expect(backAisle7).toBeTruthy();

  const restore = async () => {
    await page.request.post(`${testApiUrl}/walk/edges/${frontAisle7!.id}/blocked`, { headers, data: { blocked: false } });
    await page.request.post(`${testApiUrl}/walk/edges/${backAisle7!.id}/blocked`, { headers, data: { blocked: false } });
  };
  await restore();

  try {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
    const navigation = page.getByRole('dialog');
    await navigation.getByRole('button', { name: 'Walk paths', exact: true }).tap();
    await expect(navigation).toBeHidden();

    const walkMap = page.getByLabel('Walk paths map', { exact: true });
    const walkSvg = page.getByRole('img', { name: 'Walk paths store map', exact: true });
    await expect(walkMap).toBeVisible();
    const mapBox = await walkMap.boundingBox();
    expect(mapBox).not.toBeNull();
    // The interactive map sits right near the top of Walk paths so staff do not scroll 48 rows first.
    expect(mapBox!.y).toBeLessThan(420);
    expect(mapBox!.x).toBeGreaterThanOrEqual(0);
    expect(mapBox!.x + mapBox!.width).toBeLessThanOrEqual(390);
    await expect(walkSvg.getByLabel(/^Open walkway:/)).toHaveCount(initial.edges.length);

    // Tap the entrance-to-middle stretch of aisle 7 right on the phone map.
    await walkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · entrance end to middle', exact: true }).tap();
    await expect(walkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · entrance end to middle', exact: true })).toBeVisible();
    await expect(walkSvg.getByLabel('Closed walkway: Aisle 7 · entrance end to middle', { exact: true })).toBeVisible();

    // Switch to the shopper phone map: the closed half of aisle 7 is drawn and the route detours via the back walkway.
    await page.evaluate(() => { window.location.hash = ''; });
    const shopperMap = page.getByRole('img', { name: 'Store map', exact: true });
    await expect(shopperMap.getByLabel('Closed walkway: Aisle 7 · entrance end to middle', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
    await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).tap();
    const bar = page.getByLabel('Route progress bar', { exact: true });
    await expect(bar.getByText(/^\d+\.\d m from entrance$/)).toBeVisible();
    const detouredText = await bar.getByText(/^\d+\.\d m from entrance$/).textContent();
    expect(Number.parseFloat(detouredText ?? '0')).toBeGreaterThan(34.2);
    await expect.poll(() => chipOverRoute(page, 'Whole Milk 1L')).toEqual({ hidden: 0, belowPin: false });

    const closedBounds = await shopperMap.getByLabel('Closed walkway: Aisle 7 · entrance end to middle', { exact: true }).boundingBox();
    const bannerBounds = await page.getByLabel('Route banner', { exact: true }).boundingBox();
    const barBounds = await bar.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(bannerBounds).not.toBeNull();
    expect(barBounds).not.toBeNull();
    expect(closedBounds!.y).toBeGreaterThan(bannerBounds!.y + bannerBounds!.height);
    expect(closedBounds!.y + closedBounds!.height).toBeLessThan(barBounds!.y);

    // Tap the middle-to-back stretch on Walk paths too; shopper map shows both closed sections and the closed banner.
    await page.evaluate(() => { window.location.hash = '#staff'; });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
    await page.getByRole('dialog').getByRole('button', { name: 'Walk paths', exact: true }).tap();
    await walkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · middle to back end', exact: true }).tap();
    await expect(walkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · middle to back end', exact: true })).toBeVisible();

    await page.evaluate(() => { window.location.hash = ''; });
    await expect(page.getByLabel('Route banner', { exact: true }).getByText('Aisle 7 is closed right now', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel('Closed walkway: Aisle 7 · entrance end to middle', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel('Closed walkway: Aisle 7 · middle to back end', { exact: true })).toBeVisible();

    // Tap both walkways on the phone map to reopen them.
    await page.evaluate(() => { window.location.hash = '#staff'; });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
    await page.getByRole('dialog').getByRole('button', { name: 'Walk paths', exact: true }).tap();
    await walkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · entrance end to middle', exact: true }).tap();
    await expect(walkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · entrance end to middle', exact: true })).toBeVisible();
    await walkMap.getByRole('button', { name: 'Reopen walkway: Aisle 7 · middle to back end', exact: true }).tap();
    await expect(walkMap.getByRole('button', { name: 'Block walkway: Aisle 7 · middle to back end', exact: true })).toBeVisible();

    await page.evaluate(() => { window.location.hash = ''; });
    await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
    await expect(shopperMap.getByLabel(/^Closed walkway:/)).toHaveCount(0);
  } finally {
    await restore();
    await page.request.post(`${testApiUrl}/auth/logout`, { headers });
  }
});
