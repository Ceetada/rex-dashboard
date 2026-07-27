import type { Metadata } from 'next';

import { AirtimeForm } from './airtime-form';
import { getSavedRecipients, optional } from '@/lib/queries';

export const metadata: Metadata = { title: 'Buy airtime' };

export default async function AirtimePage() {
  // A failed recipients lookup must not block the purchase form — saved
  // numbers are a convenience, not a prerequisite. optional() still lets an
  // expired session redirect rather than rendering a form that cannot submit.
  const recipients = await optional(() => getSavedRecipients('AIRTIME'), []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-sm text-content">Buy airtime</h1>
        <p className="text-body-md text-content-muted">
          Top up any Nigerian number in seconds.
        </p>
      </header>
      <AirtimeForm recipients={recipients} />
    </div>
  );
}
