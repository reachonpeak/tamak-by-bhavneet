import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { requireAdminSession } from "@/lib/supabase/requireAdminSession";
import { getAllProductsFresh } from "@/lib/data/products";
import { COLUMNS, PREVIEW_COL_INDEX, primaryImageUrl } from "@/lib/admin/product-sheet";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_PX = 70; // rendered thumbnail size in the sheet
const FETCH_TIMEOUT_MS = 8000; // one slow/stuck storage object shouldn't stall the whole export

// Fetch a remote image and convert it to a small PNG (exceljs can't embed WebP).
// Returns null on any failure so one broken URL never fails the whole export.
async function toPreviewPng(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//.test(url)) return null; // skip local/relative seed paths
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    return await sharp(raw)
      .resize(PREVIEW_PX * 2, PREVIEW_PX * 2, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// Resolve promises from `tasks` with a bounded number running at once.
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// GET → products.xlsx with one row per product and an embedded photo preview.
// Cookie-authed so a plain <a href> download works (mirrors orders export).
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });

  const products = await getAllProductsFresh();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle" };

  // Data rows.
  products.forEach((p) => {
    const data: Record<string, string | number> = {};
    for (const c of COLUMNS) data[c.key] = c.get(p);
    const row = ws.addRow(data);
    row.alignment = { vertical: "top", wrapText: false };
  });

  // Embed a preview thumbnail per product (fetched + converted concurrently).
  type Job = { product: Product; rowNumber: number };
  const jobs: Job[] = products.map((product, i) => ({ product, rowNumber: i + 2 }));
  // Each thumbnail fetch is latency-bound (~0.3–3s per uncached storage object,
  // sharp resize itself is ~5ms), so wall-clock time scales with concurrency,
  // not bandwidth/CPU. 8 concurrent took ~49s for 488 products; 24 takes ~7s.
  await pooled(jobs, 24, async ({ product, rowNumber }) => {
    const png = await toPreviewPng(primaryImageUrl(product));
    if (!png) return;
    const imgId = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: "png" });
    ws.getRow(rowNumber).height = PREVIEW_PX * 0.78; // points ≈ px * 0.75, +margin
    ws.addImage(imgId, {
      tl: { col: PREVIEW_COL_INDEX - 1 + 0.15, row: rowNumber - 1 + 0.1 },
      ext: { width: PREVIEW_PX, height: PREVIEW_PX },
      editAs: "oneCell",
    });
  });

  const body = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="products-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
