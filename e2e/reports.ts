import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { LocationReport } from '../src/location-reports';
import { FALLBACK_PRODUCTS, type StoreProduct } from '../src/products';
import { aisleCenterX } from '../src/route';
import { shelfLocation, storePointToLocal } from '../src/shelf-location';
import { SHOPPING_STORAGE_KEY } from '../src/shopping-storage';
import { STAFF_AUTH_STORAGE_KEY } from '../src/staff-auth';
import { readStaffCredentials, signInStaff, testApiUrl } from './fixtures';

const COFFEE = 'Roasted Arabica Coffee';

/**
 * An in-memory stand-in for the store backend, so confirming a move in
 * this test never moves a product in the real database. It follows the
 * same rules as backend/src/reports and backend/src/auth.
 */
async function fakeStore(page: Page) {
  const credentials = readStaffCredentials();
  const validTokens = new Set<string>();
  const products: StoreProduct[] = FALLBACK_PRODUCTS.map((product) => ({ ...product }));
  const reports: LocationReport[] = [];
  const reply = (route: Route, status: number, body: unknown) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
  const isStaffAuthorized = (authHeader: string | undefined) => {
    const match = authHeader ? /^Bearer\s+(\S+)$/i.exec(authHeader.trim()) : null;
    return !!match && validTokens.has(match[1]);
  };
  await page.route((url) => url.pathname === '/products' || url.pathname.startsWith('/product-reports') || url.pathname.startsWith('/auth/') || url.pathname === '/walk-graph' || url.pathname.startsWith('/walk/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE' } });
      return;
    }
    if (url.pathname === '/walk-graph') {
      await reply(route, 200, { nodes: [], edges: [] });
      return;
    }
    // Deterministic route fixture for this isolated report store. Production
    // path finding lives only in backend/src/walk/walk-algorithm.ts.
    if (url.pathname === '/walk/route' && method === 'POST') {
      const body = request.postDataJSON() as {
        start: { x: number; y: number };
        products: Pick<StoreProduct, 'id' | 'mapX' | 'mapY'>[];
        keepFirst?: boolean;
      };
      let from = body.start;
      const stops = body.products.map((product) => {
        const catalogueProduct = FALLBACK_PRODUCTS.find(item => item.id === product.id);
        if (!catalogueProduct) throw new Error(`Unknown fixture product ${product.id}`);
        const centre = aisleCenterX(catalogueProduct.aisleNumber);
        const points = [
          from,
          { x: from.x, y: 240 },
          { x: centre, y: 240 },
          { x: centre, y: product.mapY },
          { x: product.mapX, y: product.mapY },
        ].filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
        const units = points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
        from = { x: product.mapX, y: product.mapY };
        return { productId: product.id, route: { points, meters: Math.round(units) / 10 } };
      });
      await reply(route, 200, { stops, totalMeters: stops.reduce((sum, stop) => sum + stop.route.meters, 0) });
      return;
    }
    if (url.pathname === '/auth/login' && method === 'POST') {
      const body = request.postDataJSON() as { username?: string; password?: string } | null;
      if (body?.username?.trim() === credentials.username && body?.password === credentials.password) {
        const token = `fake_staff_token_${validTokens.size + 1}`;
        validTokens.add(token);
        await reply(route, 200, { token, user: { id: 1, username: credentials.username } });
      } else {
        await reply(route, 401, { message: 'Invalid username or password' });
      }
      return;
    }
    if (url.pathname === '/auth/me' && method === 'GET') {
      if (!isStaffAuthorized(request.headers().authorization)) {
        await reply(route, 401, { message: 'Staff sign-in required' });
        return;
      }
      await reply(route, 200, { user: { id: 1, username: credentials.username } });
      return;
    }
    if (url.pathname === '/auth/logout' && method === 'POST') {
      const match = /^Bearer\s+(\S+)$/i.exec((request.headers().authorization ?? '').trim());
      if (match) validTokens.delete(match[1]);
      await reply(route, 200, { ok: true });
      return;
    }
    if (url.pathname === '/products') {
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      await reply(route, 200, products.filter((product) => !query || product.name.toLowerCase().includes(query)));
      return;
    }
    const [, , id, action] = url.pathname.split('/');
    if (!id && method === 'GET') {
      if (!isStaffAuthorized(request.headers().authorization)) {
        await reply(route, 401, { message: 'Staff sign-in required' });
        return;
      }
      await reply(route, 200, [...reports].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.id - a.id));
      return;
    }
    if (!id && method === 'POST') {
      const body = request.postDataJSON() as { productId: number; aisleNumber: number; side: 'left' | 'right'; shelf: 'top' | 'middle' | 'bottom'; mapY: number };
      const product = products.find((item) => item.id === body.productId);
      if (!product) { await reply(route, 404, { message: 'Product not found' }); return; }
      const place = shelfLocation(body);
      const report: LocationReport = {
        id: reports.length + 1,
        productId: product.id,
        productName: product.name,
        kind: 'moved',
        status: 'pending',
        originalAisleLocation: product.aisleLocation,
        originalAisleNumber: product.aisleNumber,
        originalMapX: product.mapX,
        originalMapY: product.mapY,
        reportedAisleLocation: place.aisleLocation,
        reportedAisleNumber: place.aisleNumber,
        reportedMapX: place.mapX,
        reportedMapY: place.mapY,
        createdAt: new Date().toISOString(),
      };
      reports.push(report);
      await reply(route, 201, report);
      return;
    }
    const report = reports.find((item) => item.id === Number(id));
    if (!report) { await reply(route, 404, { message: 'Report not found' }); return; }
    if (method === 'DELETE' && !action) {
      if (!isStaffAuthorized(request.headers().authorization)) {
        await reply(route, 401, { message: 'Staff sign-in required' });
        return;
      }
      reports.splice(reports.indexOf(report), 1);
      await reply(route, 200, { ok: true });
      return;
    }
    if (method === 'POST' && (action === 'confirm' || action === 'reject')) {
      if (!isStaffAuthorized(request.headers().authorization)) {
        await reply(route, 401, { message: 'Staff sign-in required' });
        return;
      }
      report.status = action === 'confirm' ? 'confirmed' : 'rejected';
      if (action === 'confirm') {
        const product = products.find((item) => item.id === report.productId);
        if (product) {
          Object.assign(product, {
            aisleLocation: report.reportedAisleLocation,
            aisleNumber: report.reportedAisleNumber,
            mapX: report.reportedMapX,
            mapY: report.reportedMapY,
          });
        }
      }
    }
    await reply(route, 200, report);
  });
  return { products, reports };
}

function isPortrait(page: Page): boolean {
  const viewport = page.viewportSize();
  return !!viewport && viewport.height > viewport.width;
}

async function add(page: Page, query: string, name: string) {
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill(query);
  await page.getByRole('button', { name: `Add ${name} to shopping list`, exact: true }).click();
  await expect(page.getByRole('button', { name: `${name} is in shopping list`, exact: true })).toBeDisabled();
}

/** Tap a store-plan point (aisle number and how far along it) on the map. */
async function tapStorePoint(page: Page, point: { x: number; y: number }) {
  const overlay = page.getByRole('button', { name: 'Tap the aisle where you saw this product', exact: true });
  // The map settles after the side and shelf buttons appear.
  await expect.poll(async () => {
    const first = await overlay.boundingBox();
    await page.waitForTimeout(120);
    const second = await overlay.boundingBox();
    return !!first && !!second && first.height === second.height && first.y === second.y;
  }).toBe(true);
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  await overlay.click({ position: storePointToLocal(point, box!.width, box!.height, isPortrait(page)) });
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function reportCoffeeInAisle3(page: Page, banner: Locator) {
  const send = page.getByRole('button', { name: 'Send location report', exact: true });
  await page.getByRole('button', { name: 'Not here', exact: true }).click();
  await expect(banner.getByText(`${COFFEE} is not here`, { exact: true })).toBeVisible();
  await expect(banner.getByText('Tap the aisle where you saw it', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();

  // The entrance walkway is not an aisle.
  await tapStorePoint(page, { x: 345, y: 290 });
  await expect(banner.getByText('That is a walkway. Tap one of the aisles.', { exact: true })).toBeVisible();

  // Tap the far right edge of aisle 3, at the entrance end. The tap only
  // picks the aisle: it must not decide "right" or "bottom".
  await tapStorePoint(page, { x: aisleCenterX(3) + 34, y: 205 });
  await expect(banner.getByText('Aisle 3', { exact: true })).toBeVisible();
  await expect(banner.getByText('Now pick the side below.', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();

  // Each button is a full finger-sized target, even on a phone.
  for (const name of ['Left side', 'Right side', 'Top shelf', 'Middle shelf', 'Bottom shelf']) {
    const box = await page.getByRole('radio', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(80);
  }
  await page.getByRole('radio', { name: 'Right side', exact: true }).click();
  await expect(banner.getByLabel('Turn right', { exact: true })).toBeVisible();
  await expect(banner.getByText('Now pick the shelf below.', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByRole('radio', { name: 'Bottom shelf', exact: true }).click();
  await expect(banner.getByText('Aisle 3, right, bottom shelf', { exact: true })).toBeVisible();
  // Changing your mind is one tap.
  await page.getByRole('radio', { name: 'Left side', exact: true }).click();
  await expect(banner.getByLabel('Turn left', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Top shelf', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Left side', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Right side', exact: true })).not.toBeChecked();
  await expect(banner.getByText('Aisle 3, left, top shelf', { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await send.click();
}

async function openStaffReports(page: Page) {
  await page.goto('/#staff');
  await expect(page).toHaveTitle('LIS · Staff');
  const usernameInput = page.getByRole('textbox', { name: 'Staff username', exact: true });
  const navMenu = page.getByRole('button', { name: 'Open navigation', exact: true });
  const reportsNav = page.getByRole('button', { name: 'Location reports', exact: true });
  await expect(usernameInput.or(navMenu).or(reportsNav)).toBeVisible();
  if (await usernameInput.isVisible()) {
    await signInStaff(page);
  }
  await expect(navMenu.or(reportsNav)).toBeVisible();
  if (await navMenu.isVisible()) await navMenu.click();
  await reportsNav.click();
  await expect(page.getByLabel('Location reports list', { exact: true })).toBeVisible();
}

/** Log out the real backend session beforeEach created, without leaking its row. */
async function dropRealStaffSession(page: Page) {
  const realToken = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return (JSON.parse(raw) as { token?: unknown }).token ?? null; } catch { return null; }
  }, STAFF_AUTH_STORAGE_KEY);
  if (typeof realToken === 'string' && realToken) {
    await page.request.post(`${testApiUrl}/auth/logout`, {
      headers: { Authorization: `Bearer ${realToken}` },
    });
  }
  // Start as a shopper with no staff session in storage.
  await page.evaluate((key) => localStorage.removeItem(key), STAFF_AUTH_STORAGE_KEY);
}

/** Shared on desktop and iPhone-sized browser viewports. */
export async function reportMovedProduct(page: Page) {
  // beforeEach signed into the real backend. Log that session out before
  // replacing the store; merely removing its token would leak a session row.
  await dropRealStaffSession(page);
  const store = await fakeStore(page);
  await page.goto('/');
  await page.reload(); // load products from the stand-in store
  const coffee = () => store.products.find((product) => product.name === COFFEE)!;
  const banner = page.getByLabel('Route banner', { exact: true });
  const bar = page.getByLabel('Route progress bar', { exact: true });
  const reportedNote = bar.getByText('Where you saw it · staff will check', { exact: true });

  await add(page, 'coffee', COFFEE);
  await add(page, 'bread', 'Sourdough Bread');
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect(banner.getByText(`Stop 1 of 2 · ${COFFEE}`, { exact: true })).toBeVisible();
  await expect(banner.getByText('Turn into aisle 5, left side, top shelf', { exact: true })).toBeVisible();

  await reportCoffeeInAisle3(page, banner);

  // The confirmation sits over the map, clear of every route button.
  const notice = page.getByLabel('Map notice', { exact: true });
  await expect(notice.getByText('Thanks. Your route is being updated. Staff will check the shelf.', { exact: true })).toBeVisible();
  const foundIt = page.getByRole('button', { name: 'Found it', exact: true });
  await expect(foundIt).toBeVisible();
  const noticeBox = await notice.boundingBox();
  expect(noticeBox).not.toBeNull();
  for (const name of ['Found it', 'Not here', 'End route']) {
    const button = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(button).not.toBeNull();
    expect(overlaps(noticeBox!, button!)).toBe(false);
  }
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  expect(overlaps(noticeBox!, barBox!)).toBe(false);

  // The route goes to the reported aisle at once, without waiting for staff.
  await expect(banner.getByText(`Stop 1 of 2 · ${COFFEE}`, { exact: true })).toBeVisible();
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('Aisle 3, left, top shelf', { exact: true })).toBeVisible();
  await expect(reportedNote).toBeVisible();
  expect(store.reports).toHaveLength(1);
  expect(store.reports[0]).toMatchObject({ status: 'pending', reportedAisleLocation: 'Aisle 3, left, top shelf', reportedAisleNumber: 3, reportedMapX: aisleCenterX(3) - 14 });
  // Nothing moves in the store until staff confirm.
  expect(coffee().aisleNumber).toBe(5);
  await page.reload();
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();
  await expect(reportedNote).toBeVisible();

  // Staff reject it: the shopper is sent back to the store's shelf.
  await openStaffReports(page);
  const firstReport = page.getByLabel(`Location report 1 for ${COFFEE}`, { exact: true });
  await expect(firstReport.getByText('Was: Aisle 5, left, top shelf', { exact: true })).toBeVisible();
  await expect(firstReport.getByText('Reported: Aisle 3, left, top shelf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject report 1', exact: true }).click();
  await expect(page.getByText('Location report rejected.', { exact: true })).toBeVisible();
  expect(coffee().aisleNumber).toBe(5);
  await page.goto('/');
  await expect(banner.getByText('Turn into aisle 5, left side, top shelf', { exact: true })).toBeVisible();
  await expect(reportedNote).toBeHidden();

  // Report it again; this time staff confirm and the product really moves.
  await reportCoffeeInAisle3(page, banner);
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();
  await openStaffReports(page);
  await page.getByRole('button', { name: 'Confirm report 2', exact: true }).click();
  await expect(page.getByText('Product moved to the reported shelf.', { exact: true })).toBeVisible();
  expect(coffee()).toMatchObject({ aisleLocation: 'Aisle 3, left, top shelf', aisleNumber: 3 });
  await page.goto('/');
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();
  await expect(reportedNote).toBeHidden();

  // Another shopper saved their list while the coffee was still in aisle 5.
  // After a refresh their list and route follow the confirmed move.
  const stale = FALLBACK_PRODUCTS.find((product) => product.name === COFFEE)!;
  expect(stale.aisleNumber).toBe(5);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    SHOPPING_STORAGE_KEY,
    JSON.stringify({ items: [stale], trip: null, completedCount: null }),
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'Shopping list (1 item)', exact: true }).click();
  const list = page.getByLabel('Shopping list items', { exact: true });
  await expect(list.getByText('Aisle 3, left, top shelf', { exact: true })).toBeVisible();
  await expect(list.getByText('Aisle 5, left, top shelf', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect(banner.getByText(`Stop 1 of 1 · ${COFFEE}`, { exact: true })).toBeVisible();
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();

  // The same holds for a route that was already running when it was saved.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    SHOPPING_STORAGE_KEY,
    JSON.stringify({ items: [stale], trip: { products: [stale], currentIndex: 0 }, completedCount: null }),
  ]);
  await page.reload();
  await expect(banner.getByText('Turn into aisle 3, left side, top shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('Aisle 3, left, top shelf', { exact: true })).toBeVisible();
}

/**
 * A product found through search (no shopping list): reporting a new shelf
 * must refresh the route once for the reported spot and then show it. A
 * pending report used to hand the route effect a fresh product object on
 * every render, so it cancelled and refetched forever ("Updating your
 * route…" never finished and hundreds of /walk/route calls went out).
 */
export async function reportSearchedProduct(page: Page) {
  await dropRealStaffSession(page);
  const store = await fakeStore(page);
  let routeCalls = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/walk/route' && request.method() === 'POST') routeCalls += 1;
  });
  await page.goto('/');
  await page.reload(); // load products from the stand-in store
  const banner = page.getByLabel('Route banner', { exact: true });
  const bar = page.getByLabel('Route progress bar', { exact: true });

  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
  await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).click();
  await expect(banner.getByText('Turn into aisle 7, left side, middle shelf', { exact: true })).toBeVisible();
  await expect(page.getByText('Updating your route…', { exact: true })).toBeHidden();
  const callsBeforeReport = routeCalls;
  expect(callsBeforeReport).toBeGreaterThan(0);

  // Report it in aisle 2, left side, top shelf.
  await page.getByRole('button', { name: 'Not here', exact: true }).click();
  await expect(banner.getByText('Whole Milk 1L is not here', { exact: true })).toBeVisible();
  await tapStorePoint(page, { x: aisleCenterX(2), y: 150 });
  await expect(banner.getByText('Aisle 2', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Left side', exact: true }).click();
  await page.getByRole('radio', { name: 'Top shelf', exact: true }).click();
  await page.getByRole('button', { name: 'Send location report', exact: true }).click();

  // The route goes to the reported shelf and settles there.
  await expect(banner.getByText('Turn into aisle 2, left side, top shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('Aisle 2, left, top shelf', { exact: true })).toBeVisible();
  await expect(bar.getByText('Where you saw it · staff will check', { exact: true })).toBeVisible();
  await expect(bar.getByText(/^\d+(\.\d+)? m from entrance$/)).toBeVisible();
  await expect(page.getByText('Updating your route…', { exact: true })).toBeHidden();
  expect(store.reports).toHaveLength(1);

  // One refresh for the new spot, then quiet: no request flood, and the
  // card keeps showing the route instead of spinning.
  await page.waitForTimeout(2_500);
  expect(routeCalls - callsBeforeReport).toBeLessThanOrEqual(2);
  await expect(banner.getByText('Turn into aisle 2, left side, top shelf', { exact: true })).toBeVisible();
  await expect(page.getByText('Updating your route…', { exact: true })).toBeHidden();
}
