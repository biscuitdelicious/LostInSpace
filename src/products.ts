export type StoreProduct = {
  id: number;
  name: string;
  category: string;
  aisleLocation: string;
  aisleNumber: number;
  mapX: number;
  mapY: number;
};

export const FALLBACK_PRODUCTS: StoreProduct[] = [
  {
    id: 3,
    name: 'Sourdough Bread',
    category: 'Bakery',
    aisleLocation: 'Aisle 1, right, top shelf',
    aisleNumber: 1,
    mapX: 99,
    mapY: 105,
  },
  {
    id: 4,
    name: 'Organic Bananas',
    category: 'Fresh Produce',
    aisleLocation: 'Aisle 2, left, middle shelf',
    aisleNumber: 2,
    mapX: 158,
    mapY: 142,
  },
  {
    id: 5,
    name: 'Basmati Rice 1kg',
    category: 'Grains & Pasta',
    aisleLocation: 'Aisle 3, left, bottom shelf',
    aisleNumber: 3,
    mapX: 231,
    mapY: 188,
  },
  {
    id: 6,
    name: 'Extra Virgin Olive Oil',
    category: 'Cooking Oils',
    aisleLocation: 'Aisle 4, right, middle shelf',
    aisleNumber: 4,
    mapX: 332,
    mapY: 144,
  },
  {
    id: 7,
    name: 'Roasted Arabica Coffee',
    category: 'Coffee & Tea',
    aisleLocation: 'Aisle 5, left, top shelf',
    aisleNumber: 5,
    mapX: 378,
    mapY: 108,
  },
  {
    id: 8,
    name: 'Dark Chocolate 70%',
    category: 'Snacks & Sweets',
    aisleLocation: 'Aisle 6, right, middle shelf',
    aisleNumber: 6,
    mapX: 479,
    mapY: 148,
  },
  {
    id: 2,
    name: 'Greek Yogurt 500g',
    category: 'Dairy & Eggs',
    aisleLocation: 'Aisle 7, right, bottom shelf',
    aisleNumber: 7,
    mapX: 553,
    mapY: 185,
  },
  {
    id: 1,
    name: 'Whole Milk 1L',
    category: 'Dairy & Eggs',
    aisleLocation: 'Aisle 7, left, middle shelf',
    aisleNumber: 7,
    mapX: 525,
    mapY: 138,
  },
  {
    id: 9,
    name: 'Sparkling Mineral Water',
    category: 'Beverages',
    aisleLocation: 'Aisle 8, left, bottom shelf',
    aisleNumber: 8,
    mapX: 599,
    mapY: 192,
  },
];

export function filterProductsLocally(
  products: StoreProduct[],
  query: string,
): StoreProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...products];
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.aisleLocation.toLowerCase().includes(q),
  );
}

export const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_API_URL` is baked into the bundle when it is built, so a
 * deployed app always talks to the URL it was built with. A browser can pin
 * a different one before the bundle runs — the end-to-end tests set
 * `window.__LIS_API_URL__` to the backend started for that run, so they
 * exercise the real API instead of depending on a public URL.
 */
export function resolveApiBaseUrl(): string {
  const runtime = runtimeApiUrl();
  if (runtime) return runtime;
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function runtimeApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as { __LIS_API_URL__?: unknown }).__LIS_API_URL__;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, '') : null;
}

export async function fetchProducts(
  query: string,
  baseUrl = resolveApiBaseUrl(),
): Promise<{ products: StoreProduct[]; fromBackend: boolean }> {
  const url = `${baseUrl}/products?q=${encodeURIComponent(query.trim())}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as StoreProduct[];
    return { products: data, fromBackend: true };
  } catch {
    return {
      products: filterProductsLocally(FALLBACK_PRODUCTS, query),
      fromBackend: false,
    };
  }
}
