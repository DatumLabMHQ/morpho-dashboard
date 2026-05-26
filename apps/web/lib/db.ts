import { createClient, type SqlClient } from '@morpho-dashboard/db';

// Centralized accessor: throws once with a clear message instead of every query
// returning an opaque "DATABASE_URL is required" stack from the driver layer.
export function getDb(): SqlClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. ' +
        'Local: copy apps/web/.env.example to apps/web/.env.local. ' +
        'Prod: set it in your Vercel project env.',
    );
  }
  return createClient(url);
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
