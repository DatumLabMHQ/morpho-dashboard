import type { Env } from '../env.js';

// BigInt isn't natively JSON-serializable; sync_runs.id comes back as bigint.
// We stringify it so callers see "42" instead of the request crashing.
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, bigintReplacer), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Returns a 401 Response if the request lacks the right bearer; null on success.
// Caller should `if (denied) return denied;` then proceed.
export function requireAdminAuth(request: Request, env: Env): Response | null {
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
