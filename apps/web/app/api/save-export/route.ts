import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Local-only endpoint used by the Chains page's Report-mode export button.
// Writes the PNG payload to apps/web/public/exports/morpho-share-by-chain.png
// so the file is ready to drop into the report.
//
// Refuses to run in production to avoid the (unlikely) risk of writing to a
// read-only filesystem.
export const runtime = 'nodejs';

const EXPORTS_DIR = join(process.cwd(), 'public', 'exports');
const FILENAME = 'morpho-share-by-chain.png';

export async function POST(req: Request): Promise<Response> {
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'save-export disabled in production' }, { status: 403 });
  }
  if ((req.headers.get('content-type') ?? '').indexOf('image/png') === -1) {
    return Response.json({ error: 'content-type must be image/png' }, { status: 415 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return Response.json({ error: 'empty body' }, { status: 400 });
  }
  await mkdir(EXPORTS_DIR, { recursive: true });
  const path = join(EXPORTS_DIR, FILENAME);
  await writeFile(path, buf);
  return Response.json({ ok: true, path, bytes: buf.length });
}
