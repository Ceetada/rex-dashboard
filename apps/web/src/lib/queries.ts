import { cookies } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

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

  // An expired or revoked session must land the user on the sign-in screen,
  // not on a 500 error page. Access tokens live 15 minutes, so this is the
  // ordinary case for anyone returning to a tab they left open — treating it
  // as a server fault would make that look like the product is broken.
  //
  // `redirect()` throws internally, so it must not sit inside a try/catch that
  // swallows it. Callers that tolerate failure (see getSavedRecipients) catch
  // around this function and would swallow the redirect, which is why the auth
  // check happens here, before any of them get a chance.
  if (response.status === 401) {
    redirect('/login');
  }

  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Wraps a loader whose failure a page can tolerate — a missing saved-recipients
 * list should not stop someone buying airtime.
 *
 * The subtlety worth naming: `redirect()` signals itself by *throwing*, so a
 * bare `.catch(() => fallback)` silently swallows it and the user stays on a
 * page they are no longer authorised to see. `unstable_rethrow` re-throws
 * Next's control-flow errors and lets only genuine failures reach the fallback.
 */
async function optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    unstable_rethrow(error);
    return fallback;
  }
}

export { optional };
export const getDashboard = () => serverFetch<DashboardDto & { wallet: { availableKobo: number } }>('/users/me/dashboard');
export const getHealthPlans = () => serverFetch<HealthPlanDto[]>('/health-plans');
export const getHealthSubscriptions = () => serverFetch<HealthSubscriptionDto[]>('/health-plans/subscriptions');
export const getRetirement = () => serverFetch<RetirementAccountDto>('/retirement/savings');
export const getPension = () => serverFetch<PensionAccountDto>('/retirement/pension');
export const getSavedRecipients = (serviceType: string) =>
  serverFetch<Array<{ id: string; label: string; network: string | null; recipientMasked: string }>>(
    `/services/recipients?serviceType=${serviceType}`,
  );
