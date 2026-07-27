'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Nigerian mobile data is metered and often slow. Refetching on
            // every window focus burns the user's money for no benefit on a
            // dashboard whose numbers change slowly.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Never retry a 4xx: the request is wrong, and retrying a
              // rejected purchase just wastes the user's connection.
              const status = (error as { status?: number }).status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // Mutations are never retried automatically. Purchases are
            // idempotent by key, but a silent retry still hides failure from
            // the user, and they should decide whether to try again.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
