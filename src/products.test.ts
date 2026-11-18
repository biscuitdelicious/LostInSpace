import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FALLBACK_PRODUCTS,
  fetchProducts,
  filterProductsLocally,
  resolveApiBaseUrl,
} from './products';

test('fallback seed includes Whole Milk 1L at Aisle 7, left, middle shelf', () => {
  const milk = FALLBACK_PRODUCTS.find((p) => p.name === 'Whole Milk 1L');
  assert.ok(milk);
  assert.equal(milk.aisleLocation, 'Aisle 7, left, middle shelf');
  assert.equal(milk.aisleNumber, 7);
});

test('filterProductsLocally matches by product name, category, or aisle text', () => {
  assert.equal(filterProductsLocally(FALLBACK_PRODUCTS, '').length, 9);
  const milk = filterProductsLocally(FALLBACK_PRODUCTS, 'milk');
  assert.equal(milk.length, 1);
  assert.equal(milk[0].name, 'Whole Milk 1L');

  const aisle7 = filterProductsLocally(FALLBACK_PRODUCTS, 'aisle 7');
  assert.equal(aisle7.length, 2);
});

test('fetchProducts falls back cleanly when backend URL is unreachable', async () => {
  const result = await fetchProducts('coffee', 'http://127.0.0.1:1');
  assert.equal(result.fromBackend, false);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, 'Roasted Arabica Coffee');
});

test('resolveApiBaseUrl reads EXPO_PUBLIC_API_URL and defaults to localhost:3000', () => {
  const previous = process.env.EXPO_PUBLIC_API_URL;
  try {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.20:3000/';
    assert.equal(resolveApiBaseUrl(), 'http://192.168.1.20:3000');

    delete process.env.EXPO_PUBLIC_API_URL;
    assert.equal(resolveApiBaseUrl(), 'http://localhost:3000');
  } finally {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = previous;
    }
  }
});

test('resolveApiBaseUrl prefers a window.__LIS_API_URL__ override over the built-in URL', () => {
  const previousEnv = process.env.EXPO_PUBLIC_API_URL;
  const globalScope = globalThis as { window?: unknown };
  const hadWindow = 'window' in globalScope;
  try {
    process.env.EXPO_PUBLIC_API_URL = 'http://built-in.example:3000';

    globalScope.window = { __LIS_API_URL__: 'http://127.0.0.1:4100//' };
    assert.equal(resolveApiBaseUrl(), 'http://127.0.0.1:4100');

    globalScope.window = {};
    assert.equal(resolveApiBaseUrl(), 'http://built-in.example:3000');
  } finally {
    if (previousEnv === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = previousEnv;
    }
    if (hadWindow) {
      globalScope.window = undefined;
    } else {
      delete globalScope.window;
    }
  }
});
