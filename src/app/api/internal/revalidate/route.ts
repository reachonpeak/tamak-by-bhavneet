import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { bumpProducts, bumpContent, bumpSettings, bumpCategories } from "@/lib/revalidate";

export const runtime = "nodejs";

// Bulk data-fix scripts (e.g. scripts/import-products-xlsx.mjs) write straight
// to Supabase with the service-role key, bypassing every admin API route —
// which means the unstable_cache-backed reads in src/lib/data/products.ts
// never get their revalidateTag("products") bump and keep serving stale data
// for up to an hour. This endpoint lets such scripts trigger that same bump
// over HTTP, authenticated the same way as the keepalive cron.
const BUMP_BY_TAG: Record<string, () => void> = {
  products: bumpProducts,
  content: bumpContent,
  settings: bumpSettings,
  categories: bumpCategories,
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let tag = "products";
  try {
    const body = await req.json();
    if (typeof body?.tag === "string") tag = body.tag;
  } catch {
    // no body → default to "products"
  }
  const bump = BUMP_BY_TAG[tag];
  if (!bump) {
    return NextResponse.json({ error: `Unknown tag "${tag}"` }, { status: 400 });
  }
  bump();
  return NextResponse.json({ ok: true, tag });
}
