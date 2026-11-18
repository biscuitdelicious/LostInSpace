import type { AisleTap, ShelfLevel, ShelfSide } from './shelf-location';
import { resolveApiBaseUrl } from './products';
import { StaffUnauthorizedError } from './staff-auth';

export type LocationReport = {
  id: number;
  productId: number;
  productName: string;
  kind: 'moved';
  status: 'pending' | 'confirmed' | 'rejected';
  originalAisleLocation: string;
  originalAisleNumber: number;
  originalMapX: number;
  originalMapY: number;
  reportedAisleLocation: string;
  reportedAisleNumber: number;
  reportedMapX: number;
  reportedMapY: number;
  createdAt: string;
};

/** The aisle the shopper tapped, plus the side and shelf they picked. */
export type ReportChoice = AisleTap & { side: ShelfSide; shelf: ShelfLevel };

export async function createLocationReport(productId: number, choice: ReportChoice, baseUrl = resolveApiBaseUrl()): Promise<LocationReport> {
  return request(`${baseUrl}/product-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      aisleNumber: choice.aisleNumber,
      side: choice.side,
      shelf: choice.shelf,
      mapY: choice.mapY,
      kind: 'moved',
    }),
  });
}

/**
 * Whether staff have decided a report this shopper sent.
 * `decided` covers confirmed, rejected, and a report that no longer
 * exists. `unknown` means the backend could not be asked, so nothing
 * should change yet.
 */
export async function fetchReportDecision(id: number, baseUrl = resolveApiBaseUrl()): Promise<'pending' | 'decided' | 'unknown'> {
  try {
    const response = await fetch(`${baseUrl}/product-reports/${id}`);
    if (response.status === 404) return 'decided';
    if (!response.ok) return 'unknown';
    const report = (await response.json()) as Partial<LocationReport> | null;
    if (report?.status === 'pending') return 'pending';
    return report?.status === 'confirmed' || report?.status === 'rejected' ? 'decided' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function fetchLocationReports(token: string, baseUrl = resolveApiBaseUrl()): Promise<LocationReport[]> {
  return request(`${baseUrl}/product-reports`, {
    headers: staffHeaders(token),
  });
}

export async function confirmLocationReport(id: number, token: string, baseUrl = resolveApiBaseUrl()): Promise<LocationReport> {
  return request(`${baseUrl}/product-reports/${id}/confirm`, {
    method: 'POST',
    headers: staffHeaders(token),
  });
}

export async function rejectLocationReport(id: number, token: string, baseUrl = resolveApiBaseUrl()): Promise<LocationReport> {
  return request(`${baseUrl}/product-reports/${id}/reject`, {
    method: 'POST',
    headers: staffHeaders(token),
  });
}

function staffHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the store backend. Start it and try again.');
  }
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
    if (response.status === 401) {
      throw new StaffUnauthorizedError(message || 'Staff sign-in required.');
    }
    throw new Error(message || `The store backend returned HTTP ${response.status}.`);
  }
  return body as T;
}
