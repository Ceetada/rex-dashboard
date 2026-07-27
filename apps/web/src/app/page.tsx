import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Entry point. Sends signed-in users to their dashboard and everyone else to
 * sign in — checking the session cookie here rather than letting /dashboard
 * fail on an unauthenticated API call, which would show a signed-out visitor
 * an error page instead of a login form.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.has('__Host-evas_access') || cookieStore.has('__Host-evas_refresh');
  redirect(signedIn ? '/dashboard' : '/login');
}
