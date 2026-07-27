import { cookies } from 'next/headers';

import type { DashboardDto, HealthPlanDto, HealthSubscriptionDto, RetirementAccountDto, PensionAccountDto } from '@evas/contracts';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Server-side data loading.
 *
 * Session cookies are HttpOnly, so a server component cannot rely on the
 * browser to attach them — they are forwarded explicitly here. Everything is
 * `no-store`: a cached wallet balance shown to the wrong user is the worst bug
 * this product could ship, so no page-level caching is applied to
 * authenticated data at all.
 */
async function serverFetch<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookieStore.toString() },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export const getDashboard = () => serverFetch<DashboardDto & { wallet: { availableKobo: number } }>('/users/me/dashboard');
export const getHealthPlans = () => serverFetch<HealthPlanDto[]>('/health-plans');
export const getHealthSubscriptions = () => serverFetch<HealthSubscriptionDto[]>('/health-plans/subscriptions');
export const getRetirement = () => serverFetch<RetirementAccountDto>('/retirement/savings');
export const getPension = () => serverFetch<PensionAccountDto>('/retirement/pension');
export const getSavedRecipients = (serviceType: string) =>
  serverFetch<Array<{ id: string; label: string; network: string | null; recipientMasked: string }>>(
    `/services/recipients?serviceType=${serviceType}`,
  );
