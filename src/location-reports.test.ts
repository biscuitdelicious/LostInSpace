import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ReportAlreadyDecidedError,
  confirmLocationReport,
  fallbackDecidedMessage,
  rejectLocationReport,
} from './location-reports';
import { StaffUnauthorizedError } from './staff-auth';

function fetchReturning(status: number, body: unknown) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

test('a 409 on confirm or reject passes on the backend message that names the product and report', async () => {
  const message = 'Someone already rejected the Sourdough Bread report to Aisle 6, left, top shelf (report 12). Sourdough Bread stays on Aisle 1, right, top shelf.';
  for (const decide of [confirmLocationReport, rejectLocationReport]) {
    for (const status of ['confirmed', 'rejected'] as const) {
      const restore = fetchReturning(409, { statusCode: 409, message, status });
      try {
        await assert.rejects(
          decide(12, 'token', 'http://store.test'),
          (error: unknown) => {
            assert.ok(error instanceof ReportAlreadyDecidedError);
            assert.equal(error.status, status);
            assert.equal(error.message, message);
            return true;
          },
        );
      } finally {
        restore();
      }
    }
  }
});

test('without a backend message the product and report still come from the report payload', async () => {
  const restore = fetchReturning(409, {
    statusCode: 409,
    status: 'confirmed',
    report: { id: 12, productName: 'Sourdough Bread', reportedAisleLocation: 'Aisle 6, left, top shelf' },
  });
  try {
    await assert.rejects(confirmLocationReport(12, 'token', 'http://store.test'), (error: unknown) => {
      assert.ok(error instanceof ReportAlreadyDecidedError);
      assert.equal(error.message, 'Someone already confirmed the Sourdough Bread report to Aisle 6, left, top shelf (report 12).');
      return true;
    });
  } finally {
    restore();
  }
  assert.equal(fallbackDecidedMessage('rejected', null), 'This report was already rejected.');
});

test('other failures keep their existing errors', async () => {
  const unauthorized = fetchReturning(401, { message: 'Staff sign-in required' });
  try {
    await assert.rejects(
      confirmLocationReport(7, 'token', 'http://store.test'),
      StaffUnauthorizedError,
    );
  } finally {
    unauthorized();
  }
  const conflictWithoutDecision = fetchReturning(409, { message: 'Something else' });
  try {
    await assert.rejects(
      rejectLocationReport(7, 'token', 'http://store.test'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof ReportAlreadyDecidedError, false);
        assert.equal(error.message, 'Something else');
        return true;
      },
    );
  } finally {
    conflictWithoutDecision();
  }
});
