import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ReportAlreadyDecidedError,
  confirmLocationReport,
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

test('a 409 on confirm or reject says which decision already counted', async () => {
  for (const decide of [confirmLocationReport, rejectLocationReport]) {
    for (const status of ['confirmed', 'rejected'] as const) {
      const restore = fetchReturning(409, {
        statusCode: 409,
        message: `This report was already ${status}.`,
        status,
      });
      try {
        await assert.rejects(
          decide(7, 'token', 'http://store.test'),
          (error: unknown) => {
            assert.ok(error instanceof ReportAlreadyDecidedError);
            assert.equal(error.status, status);
            assert.equal(error.message, `This report was already ${status}.`);
            return true;
          },
        );
      } finally {
        restore();
      }
    }
  }
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
