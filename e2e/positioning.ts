import { expect, type Page } from '@playwright/test';
import type { MapPoint } from '../src/route';
import { storePointToLocal } from '../src/shelf-location';
import { SHOPPER_POSITION_MAX_AGE_MS, SHOPPING_STORAGE_KEY } from '../src/shopping-storage';
import { testApiUrl } from './fixtures';

export async function tapShopperPoint(page: Page, point: MapPoint): Promise<void> {
  const overlay = page.getByRole('button', { name: 'Set your location on the store map', exact: true });
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  const portrait = !!viewport && viewport.height > viewport.width;
  await overlay.click({ position: storePointToLocal(point, box!.width, box!.height, portrait) });
}

async function expectLocationPromptClearOfMap(page: Page): Promise<void> {
  const prompt = page.getByLabel('Location setting', { exact: true });
  const map = page.getByRole('img', { name: 'Store map', exact: true });
  await expect.poll(async () => {
    const promptBox = await prompt.boundingBox();
    const mapBox = await map.boundingBox();
    return !!promptBox && !!mapBox && mapBox.y >= promptBox.y + promptBox.height;
  }).toBe(true);
}

type DrawnRect = { x: number; y: number; width: number; height: number };
type ShopperMapGeometry = {
  viewBox: DrawnRect;
  aisles: { name: string; box: DrawnRect }[];
  you: DrawnRect | null;
  halo: { x: number; y: number; r: number } | null;
};

/** What the browser actually drew, in the map's own units: real text boxes, not estimates. */
async function shopperMapGeometry(page: Page): Promise<ShopperMapGeometry> {
  return page.getByRole('img', { name: 'Store map', exact: true }).evaluate((element) => {
    const svg = (element instanceof SVGSVGElement ? element : element.querySelector('svg')) as SVGSVGElement;
    const rect = (node: SVGGraphicsElement) => {
      const box = node.getBBox();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const texts = Array.from(svg.querySelectorAll('text'));
    const you = texts.find((text) => text.textContent === 'YOU');
    const halo = Array.from(svg.querySelectorAll('circle')).find((circle) => circle.getAttribute('r') === '17');
    const view = svg.viewBox.baseVal;
    return {
      viewBox: { x: view.x, y: view.y, width: view.width, height: view.height },
      aisles: texts
        .filter((text) => /^AISLE \d$/.test(text.textContent ?? ''))
        .map((text) => ({ name: text.textContent ?? '', box: rect(text) })),
      you: you ? rect(you) : null,
      halo: halo
        ? { x: Number(halo.getAttribute('cx')), y: Number(halo.getAttribute('cy')), r: Number(halo.getAttribute('r')) }
        : null,
    };
  });
}

function rectsOverlap(a: DrawnRect, b: DrawnRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Everything wrong with the aisle names around the YOU marker; empty when all are readable. */
function coveredAisleNames(map: ShopperMapGeometry): string[] {
  if (!map.halo || !map.you) return ['the YOU marker is not drawn'];
  const problems: string[] = [];
  for (const aisle of map.aisles) {
    const nearestX = Math.min(Math.max(map.halo.x, aisle.box.x), aisle.box.x + aisle.box.width);
    const nearestY = Math.min(Math.max(map.halo.y, aisle.box.y), aisle.box.y + aisle.box.height);
    // The halo radius also covers the dot and its outline.
    if (Math.hypot(nearestX - map.halo.x, nearestY - map.halo.y) < map.halo.r) problems.push(`${aisle.name} is under the YOU dot`);
    if (rectsOverlap(aisle.box, map.you)) problems.push(`${aisle.name} is under the YOU text`);
    const view = map.viewBox;
    if (
      aisle.box.x < view.x || aisle.box.y < view.y
      || aisle.box.x + aisle.box.width > view.x + view.width
      || aisle.box.y + aisle.box.height > view.y + view.height
    ) problems.push(`${aisle.name} is cut off at the map edge`);
  }
  for (let i = 0; i < map.aisles.length; i += 1) {
    for (let j = i + 1; j < map.aisles.length; j += 1) {
      if (rectsOverlap(map.aisles[i].box, map.aisles[j].box)) problems.push(`${map.aisles[i].name} runs into ${map.aisles[j].name}`);
    }
  }
  return problems;
}

/** Tap a spot, wait for YOU to be drawn there, and require every aisle name to be clear of it. */
async function expectAisleNamesReadableAt(page: Page, point: MapPoint, visibleNames: number | null = 8): Promise<ShopperMapGeometry> {
  await tapShopperPoint(page, point);
  const viewport = page.viewportSize();
  const portrait = !!viewport && viewport.height > viewport.width;
  const drawn = portrait ? { x: 330 - point.y, y: point.x } : point;
  let latest: ShopperMapGeometry | null = null;
  await expect.poll(async () => {
    latest = await shopperMapGeometry(page);
    if (!latest.halo || Math.hypot(latest.halo.x - drawn.x, latest.halo.y - drawn.y) > 3) return ['YOU has not moved to the tapped spot yet'];
    if (visibleNames !== null && latest.aisles.length !== visibleNames) return [`${latest.aisles.length} aisle names are drawn`];
    return coveredAisleNames(latest);
  }, { message: `aisle names around YOU at ${point.x}, ${point.y}` }).toEqual([]);
  return latest!;
}

/**
 * Shared desktop/iPhone coverage: the YOU marker never covers an aisle name.
 * The reported spot is the corridor at aisle 6, where the dot sat on
 * "AISLE 6" on a wide screen; on a phone the back walkway runs through the
 * names instead. Every junction of the live walk graph is tapped in turn.
 */
export async function aisleNamesStayReadableAroundShopper(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const portrait = !!viewport && viewport.height > viewport.width;
  await page.goto('/');
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  const home = await shopperMapGeometry(page);
  expect(home.aisles.map((aisle) => aisle.name)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((aisle) => `AISLE ${aisle}`));
  // Compared by anchor (centre on a wide screen, left edge on a phone): the
  // name of a selected product's aisle turns bold and wider, and text boxes
  // round slightly differently when the map is resized.
  const movedFromHome = (aisle: { name: string; box: DrawnRect }) => {
    const before = home.aisles.find((entry) => entry.name === aisle.name)!.box;
    const left = aisle.box.x - before.x;
    const centre = left + (aisle.box.width - before.width) / 2;
    return {
      x: Math.abs(left) < Math.abs(centre) ? left : centre,
      y: aisle.box.y + aisle.box.height / 2 - (before.y + before.height / 2),
    };
  };

  // The reported spot. The name that would be covered steps aside but stays
  // by its own aisle; the other seven names do not move at all.
  const reported = await expectAisleNamesReadableAt(page, portrait ? { x: 464, y: 55 } : { x: 464, y: 240 });
  for (const aisle of reported.aisles) {
    const moved = movedFromHome(aisle);
    const shift = Math.hypot(moved.x, moved.y);
    if (aisle.name === 'AISLE 6') {
      expect(shift).toBeGreaterThan(5);
      expect(shift).toBeLessThanOrEqual(37);
      // Still lined up with aisle 6: it only drops (wide screen) or slides along the wall (phone).
      expect(Math.abs(moved.x)).toBeLessThan(1);
    } else {
      expect(shift).toBeLessThan(1);
    }
  }
  // The same tap in the other walkway of aisle 6 is covered as well.
  await expectAisleNamesReadableAt(page, portrait ? { x: 464, y: 240 } : { x: 464, y: 55 });

  // "Wherever my dot lands": every junction of the store's walk graph, plus
  // spots between two names and beside the entrance.
  const graph = await (await page.request.get(`${testApiUrl}/walk-graph`)).json() as { nodes: { mapX: number; mapY: number }[] };
  expect(graph.nodes.length).toBeGreaterThanOrEqual(42);
  const spots: MapPoint[] = [
    ...graph.nodes.map((node) => ({ x: node.mapX, y: node.mapY })),
    { x: 502, y: 240 }, { x: 345, y: 254 }, { x: 502, y: 55 }, { x: 464, y: 72 }, { x: 464, y: 228 },
  ];
  for (const spot of spots) await expectAisleNamesReadableAt(page, spot);

  // With a route drawn from the tapped spot the names stay clear of the dot too.
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
  await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).click();
  const bar = page.getByLabel('Route progress bar', { exact: true });
  await expect(bar.getByText(/^\d+\.\d m from your spot$/)).toBeVisible();
  for (const spot of [{ x: 541, y: 240 }, { x: 541, y: 55 }, { x: 464, y: 55 }, { x: 464, y: 240 }]) {
    await expectAisleNamesReadableAt(page, spot);
    await expect(bar.getByText(/^\d+\.\d m from your spot$/)).toBeVisible();
  }

  // Back at the entrance, every name returns to its usual place.
  await page.getByRole('button', { name: 'Use entrance as route start', exact: true }).click();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const map = await shopperMapGeometry(page);
    return map.aisles.filter((aisle) => {
      const moved = movedFromHome(aisle);
      return Math.hypot(moved.x, moved.y) > 1;
    }).map((aisle) => aisle.name);
  }).toEqual([]);
  await page.getByRole('button', { name: 'End route', exact: true }).click();

  // A phone list trip zooms into the current aisle with larger, bold names.
  if (portrait) {
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
    await page.getByRole('button', { name: 'Add Whole Milk 1L to shopping list', exact: true }).click();
    await page.getByRole('button', { name: 'Clear product search', exact: true }).click();
    await tapShopperPoint(page, { x: 541, y: 55 });
    await expect(page.getByText('YOU', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Shopping list (1 item)', exact: true }).click();
    await page.getByRole('button', { name: 'Start list route', exact: true }).click();
    await expect(page.getByLabel('Route banner', { exact: true }).getByText('Stop 1 of 1 · Whole Milk 1L', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const map = await shopperMapGeometry(page);
      if (map.viewBox.height >= 700) return ['the map has not zoomed into the aisle yet'];
      if (!map.aisles.some((aisle) => aisle.name === 'AISLE 7')) return ['AISLE 7 is not drawn'];
      return coveredAisleNames(map);
    }).toEqual([]);
    await page.getByRole('button', { name: 'End route', exact: true }).click();
  }
}

/** Shared desktop/iPhone coverage for a manually positioned single-product route. */
export async function setLocationByTapping(page: Page): Promise<void> {
  const routeStarts: { start: MapPoint; keepFirst?: boolean }[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/walk/route') return;
    routeStarts.push(request.postDataJSON() as { start: MapPoint; keepFirst?: boolean });
  });

  await page.goto('/');
  const location = page.getByLabel('Location setting', { exact: true });
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  const defaultHint = location.getByText('Starting from the entrance for now.', { exact: true });
  await expect(defaultHint).toBeVisible();
  await expect(location).not.toContainText(/snap|walkway/i);
  expect((await defaultHint.boundingBox())!.height).toBeLessThan(24);
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expectLocationPromptClearOfMap(page);

  // The corridor at aisle 6 is a real open backend walkway. The tap must be
  // sent to Dijkstra, not treated as an aisle report or a client-side route.
  await tapShopperPoint(page, { x: 464, y: 240 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  const tappedHint = location.getByText('Tap anywhere else to move it.', { exact: true });
  await expect(tappedHint).toBeVisible();
  await expect(location).not.toContainText(/snap|walkway/i);
  expect((await tappedHint.boundingBox())!.height).toBeLessThan(24);
  await expect(page.getByText('YOU', { exact: true })).toBeVisible();

  // A phone reload keeps the manual fallback alongside the saved list.
  await page.reload();
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
  await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).click();
  const bar = page.getByLabel('Route progress bar', { exact: true });
  await expect(bar.getByText(/^(?:19\.5|19\.6) m from your spot$/)).toBeVisible();
  await expectLocationPromptClearOfMap(page);
  await expect.poll(() => {
    const start = routeStarts.at(-1)?.start;
    return !!start && Math.abs(start.x - 464) < 1 && Math.abs(start.y - 240) < 1;
  }).toBe(true);

  // Tapping again while the route is open immediately replaces its origin.
  await tapShopperPoint(page, { x: 541, y: 151 });
  await expect(bar.getByText(/^(?:2\.9|3\.0) m from your spot$/)).toBeVisible();
  await expect.poll(() => {
    const start = routeStarts.at(-1)?.start;
    return !!start && Math.abs(start.x - 541) < 2 && Math.abs(start.y - 151) < 2;
  }).toBe(true);

  // Shoppers cannot see the open paths, so a tap on plain floor between two
  // shelf rows - 30 map units from the nearest walkway - must snap there
  // instead of showing a "near a walkway" error.
  await tapShopperPoint(page, { x: 203, y: 200 });
  await expect(location.getByText('Tap anywhere else to move it.', { exact: true })).toBeVisible();
  await expect(location).not.toContainText(/snap|walkway/i);
  await expect(bar.getByText(/^\d+\.\d m from your spot$/)).toBeVisible();
  await expect.poll(() => {
    const start = routeStarts.at(-1)?.start;
    return !!start && Math.abs(start.x - 233) < 2 && Math.abs(start.y - 200) < 2;
  }).toBe(true);
  await expect(location.getByText(/^Tap on or near an open walkway/)).toBeHidden();

  // The reported case: open floor right beside the START dot also snaps, to
  // the entrance walkway, and never errors.
  await tapShopperPoint(page, { x: 330, y: 300 });
  await expect(bar.getByText('34.2 m from your spot', { exact: true })).toBeVisible();
  await expect.poll(() => {
    const start = routeStarts.at(-1)?.start;
    return !!start && Math.abs(start.x - 345) < 1 && Math.abs(start.y - 268) < 1;
  }).toBe(true);

  // The entrance remains available as an explicit reset.
  await page.getByRole('button', { name: 'Use entrance as route start', exact: true }).click();
  await expect(bar.getByText('34.2 m from entrance', { exact: true })).toBeVisible();
  await expect.poll(() => routeStarts.at(-1)?.start).toEqual({ x: 345, y: 268 });
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(location.getByText('Starting from the entrance for now.', { exact: true })).toBeVisible();
}

/** Shared desktop/iPhone coverage for forgetting the tapped spot on trip end, trip finish, and >1h away. */
export async function forgetTappedLocationOnEndFinishAndAfterHour(page: Page): Promise<void> {
  const routeStarts: { start: MapPoint; keepFirst?: boolean }[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/walk/route') return;
    routeStarts.push(request.postDataJSON() as { start: MapPoint; keepFirst?: boolean });
  });

  await page.goto('/');
  const location = page.getByLabel('Location setting', { exact: true });
  const bar = page.getByLabel('Route progress bar', { exact: true });
  const banner = page.getByLabel('Route banner', { exact: true });

  // 1. Ending a single-product route forgets the tapped spot and returns to the entrance.
  await tapShopperPoint(page, { x: 156, y: 40 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
  await page.getByRole('button', { name: 'Select product Whole Milk 1L, Aisle 7, left, middle shelf', exact: true }).click();
  await expect(bar.getByText(/^\d+\.\d m from your spot$/)).toBeVisible();
  await expect.poll(() => {
    const start = routeStarts.at(-1)?.start;
    return !!start && Math.abs(start.x - 156) < 2 && Math.abs(start.y - 55) < 2;
  }).toBe(true);

  await page.getByRole('button', { name: 'End route', exact: true }).click();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeHidden();
  await page.reload();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();

  // 2. Ending a list trip forgets the tapped spot while keeping the list; finishing it forgets the spot too.
  for (const [query, name] of [['milk', 'Whole Milk 1L'], ['bread', 'Sourdough Bread']] as const) {
    await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill(query);
    await page.getByRole('button', { name: `Add ${name} to shopping list`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Clear product search', exact: true }).click();
  await tapShopperPoint(page, { x: 156, y: 40 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect(banner.getByText('Stop 1 of 2 · Sourdough Bread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End route', exact: true }).click();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeHidden();

  await tapShopperPoint(page, { x: 156, y: 40 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect(banner.getByText('Stop 1 of 2 · Sourdough Bread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Found it', exact: true }).click();
  await expect(banner.getByText('Stop 2 of 2 · Whole Milk 1L', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Found it', exact: true }).click();
  await expect(page.getByLabel('Shopping complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeHidden();
  await page.reload();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();

  // 3. Reopening the app after more than an hour forgets the tapped spot (while keeping saved list items).
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill('milk');
  await page.getByRole('button', { name: 'Add Whole Milk 1L to shopping list', exact: true }).click();
  await page.getByRole('button', { name: 'Clear product search', exact: true }).click();
  await tapShopperPoint(page, { x: 156, y: 40 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();

  await page.evaluate(
    ([key, staleOffsetMs]) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      saved.lastActiveAt = Date.now() - staleOffsetMs;
      localStorage.setItem(key, JSON.stringify(saved));
    },
    [SHOPPING_STORAGE_KEY, SHOPPER_POSITION_MAX_AGE_MS + 60_000] as const,
  );
  await page.reload();
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Shopping list (1 item)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect.poll(() => routeStarts.at(-1)?.start).toEqual({ x: 345, y: 268 });
  await page.getByRole('button', { name: 'End route', exact: true }).click();

  // Returning to an already-open tab after more than an hour also resets to the entrance without reload.
  await tapShopperPoint(page, { x: 156, y: 40 });
  await expect(location.getByText('Starting from your tapped spot', { exact: true })).toBeVisible();
  await page.evaluate((advanceMs) => {
    const realNow = Date.now.bind(Date);
    const shiftedFrom = realNow();
    Date.now = () => realNow() - shiftedFrom + shiftedFrom + advanceMs;
    document.dispatchEvent(new Event('visibilitychange'));
  }, SHOPPER_POSITION_MAX_AGE_MS + 60_000);
  await expect(location.getByText('Tap the map to set your location', { exact: true })).toBeVisible();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  await expect(page.getByText('YOU', { exact: true })).toBeHidden();
}
