import { neon } from '@neondatabase/serverless';

export type SqlClient = ReturnType<typeof neon>;

export function createClient(databaseUrl: string): SqlClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return neon(databaseUrl);
}

export const MORPHO_SCHEMA = 'morpho_' as const;
