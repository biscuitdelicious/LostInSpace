import { expect, type Page } from '@playwright/test';

async function add(page: Page, query: string, name: string) {
  await page.getByRole('textbox', { name: 'Search store products', exact: true }).fill(query);
  await page.getByRole('button', { name: `Add ${name} to shopping list`, exact: true }).click();
  await expect(page.getByRole('button', { name: `${name} is in shopping list`, exact: true })).toBeDisabled();
}

/**
 * How the product chip sits against the drawn route, measured in the map's
 * own SVG units: how many points of the dashed line lie under the chip
 * (sampled one unit apart, the line is 6 wide), and whether the chip is
 * drawn below the pin. Null until both the route and the chip are drawn.
 */
export async function chipOverRoute(page: Page, name: string): Promise<{ hidden: number; belowPin: boolean } | null> {
  return page.getByRole('img', { name: 'Store map', exact: true }).evaluate((root, productName) => {
    const svg = root.tagName.toLowerCase() === 'svg' ? root : root.querySelector('svg');
    if (!svg) return null;
    const text = Array.from(svg.querySelectorAll('text')).find((node) => node.textContent === productName);
    const chip = text?.previousElementSibling;
    const pinDot = chip?.previousElementSibling;
    const line = svg.querySelector('path[stroke-dasharray]');
    if (!(chip instanceof SVGRectElement) || !(pinDot instanceof SVGCircleElement) || !(line instanceof SVGPathElement)) return null;
    const box = chip.getBBox();
    const total = line.getTotalLength();
    if (total < 1) return null;
    let hidden = 0;
    for (let at = 0; at <= total; at += 1) {
      const point = line.getPointAtLength(at);
      if (point.x > box.x - 3 && point.x < box.x + box.width + 3 && point.y > box.y - 3 && point.y < box.y + box.height + 3) hidden += 1;
    }
    return { hidden, belowPin: box.y > pinDot.cy.baseVal.value };
  }, name);
}

/** Shared on desktop and iPhone-sized browser viewports. */
export async function completeShoppingList(page: Page) {
  await page.goto('/');
  // Deliberately add out of aisle order: 7, 1, 8.
  await add(page, 'milk', 'Whole Milk 1L');
  await add(page, 'bread', 'Sourdough Bread');
  await add(page, 'water', 'Sparkling Mineral Water');
  await page.getByRole('button', { name: 'Shopping list (3 items)', exact: true }).click();
  const list = page.getByLabel('Shopping list items', { exact: true });
  for (const name of ['Whole Milk 1L', 'Sourdough Bread', 'Sparkling Mineral Water']) {
    await expect(list.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  const banner = page.getByLabel('Route banner', { exact: true });
  const bar = page.getByLabel('Route progress bar', { exact: true });
  let previousDistance = Infinity;
  // The shorter sweep for these products is 8 → 7 → 1, not the add order.
  for (const [i, name] of ['Sparkling Mineral Water', 'Whole Milk 1L', 'Sourdough Bread'].entries()) {
    await expect(banner.getByText(`Stop ${i + 1} of 3 · ${name}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search store products', exact: true })).toBeHidden();
    await expect(page.getByLabel('Product finder sheet', { exact: true })).toBeHidden();
    const distanceText = await bar.getByText(/m remaining$/).textContent();
    const distance = Number.parseFloat(distanceText ?? '');
    expect(distance).toBeLessThan(previousDistance);
    expect(distance).toBeGreaterThan(0);
    previousDistance = distance;

    // The currently targeted product label is on the map between both bars.
    const pin = await page.getByRole('img', { name: 'Store map', exact: true }).getByText(name, { exact: true }).boundingBox();
    const top = await banner.boundingBox();
    const bottom = await bar.boundingBox();
    expect(pin).not.toBeNull();
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    await expect(pin!.y).toBeGreaterThan(top!.y + top!.height);
    await expect(pin!.y + pin!.height).toBeLessThan(bottom!.y);
    // The label never sits on the line: the walk into the aisle and up to
    // the pin stays visible at every stop, on the phone and the desktop.
    await expect.poll(async () => (await chipOverRoute(page, name))?.hidden ?? -1, { message: `${name} label covers the route` }).toBe(0);
    const viewport = page.viewportSize();
    if (viewport && viewport.height > viewport.width) {
      const mapBox = await page.getByRole('img', { name: 'Store map', exact: true }).boundingBox();
      expect(mapBox).not.toBeNull();
      // The product label stays over the shelf column, never covering any aisle name on the right.
      for (let aisleNum = 1; aisleNum <= 8; aisleNum += 1) {
        const aisleLoc = page.getByText(`AISLE ${aisleNum}`, { exact: true });
        if (await aisleLoc.isVisible()) {
          const box = await aisleLoc.boundingBox();
          expect(box).not.toBeNull();
          expect(pin!.x + pin!.width).toBeLessThan(box!.x);
        }
      }
      if (i === 0) {
        // Route chrome used to letterbox the plan to ~60% width and shrink the names.
        const aisle = page.getByText(`AISLE ${[8, 7, 1][i]}`, { exact: true });
        await expect.poll(async () => (await aisle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(16);
        const aisleBox = await aisle.boundingBox();
        expect(aisleBox).not.toBeNull();
        expect(aisleBox!.x).toBeGreaterThan(mapBox!.x);
        expect(aisleBox!.x + aisleBox!.width).toBeLessThan(mapBox!.x + mapBox!.width);
        // START and ENTRANCE / CHECKOUT stay inside the left edge of the zoomed map.
        for (const landmark of ['START', 'ENTRANCE / CHECKOUT']) {
          const landmarkBox = await page.getByText(landmark, { exact: true }).boundingBox();
          expect(landmarkBox).not.toBeNull();
          expect(landmarkBox!.x).toBeGreaterThan(mapBox!.x + 4);
          expect(landmarkBox!.y).toBeGreaterThan(top!.y + top!.height);
          expect(landmarkBox!.y + landmarkBox!.height).toBeLessThan(bottom!.y);
        }
      }
    }
    await page.getByRole('button', { name: 'Found it', exact: true }).click();
  }
  const complete = page.getByLabel('Shopping complete', { exact: true });
  await expect(complete).toBeVisible();
  await expect(complete.getByText('You’re done!', { exact: true })).toBeVisible();
  await expect(complete.getByText('All 3 products found.', { exact: true })).toBeVisible();
  await expect(banner).toBeHidden();
  await expect(bar).toBeHidden();
  await expect(page.getByText('START', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(complete).toBeHidden();
  await page.getByRole('button', { name: 'Shopping list (0 items)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start list route', exact: true })).toBeDisabled();
}

export async function cancelShoppingList(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shopping list (0 items)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start list route', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close shopping list', exact: true }).click();
  await add(page, 'milk', 'Whole Milk 1L');
  await add(page, 'yogurt', 'Greek Yogurt 500g');
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Whole Milk 1L from shopping list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shopping list (1 item)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close shopping list', exact: true }).click();
  await add(page, 'milk', 'Whole Milk 1L');
  await page.getByRole('button', { name: 'Shopping list (2 items)', exact: true }).click();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  const banner = page.getByLabel('Route banner', { exact: true });
  await expect(banner.getByText('Stop 1 of 2 · Greek Yogurt 500g', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Found it', exact: true }).click();
  await expect(banner.getByText('Stop 2 of 2 · Whole Milk 1L', { exact: true })).toBeVisible();
  await expect(banner.getByText('7.5 m to Whole Milk 1L', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End route', exact: true }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByLabel('Shopping complete', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Shopping list (1 item)', exact: true }).click();
  const list = page.getByLabel('Shopping list items', { exact: true });
  await expect(list.getByText('Whole Milk 1L', { exact: true })).toBeVisible();
  await expect(list.getByText('Greek Yogurt 500g', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  await expect(banner.getByText('Stop 1 of 1 · Whole Milk 1L', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Found it', exact: true }).click();
  await expect(page.getByText('All 1 product found.', { exact: true })).toBeVisible();
}

export async function shoppingListSurvivesReload(page: Page) {
  await page.goto('/');
  await add(page, 'milk', 'Whole Milk 1L');
  await add(page, 'bread', 'Sourdough Bread');
  await page.reload();
  const listButton = page.getByRole('button', { name: 'Shopping list (2 items)', exact: true });
  await expect(listButton).toBeVisible();
  await listButton.click();
  const list = page.getByLabel('Shopping list items', { exact: true });
  await expect(list.getByText('Whole Milk 1L', { exact: true })).toBeVisible();
  await expect(list.getByText('Sourdough Bread', { exact: true })).toBeVisible();
  await expect(page.getByText('shorter aisle sweep', { exact: false })).toBeHidden();
  await expect(page.getByText('This list stays in your current session.', { exact: false })).toBeHidden();
  await expect(page.getByText('We’ll group these by aisle and pick the shorter walk. It stays saved on this phone.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start list route', exact: true }).click();
  const banner = page.getByLabel('Route banner', { exact: true });
  await expect(banner.getByText(/Stop 1 of 2 · /)).toBeVisible();
  const stop = (await banner.innerText()).split('\n').find((line) => line.startsWith('Stop 1 of 2'));
  await page.reload();
  await expect(page.getByLabel('Route banner', { exact: true }).getByText(stop ?? 'Stop 1 of 2', { exact: false })).toBeVisible();
}
