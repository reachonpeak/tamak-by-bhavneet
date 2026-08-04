// Bulk-update products from a hand-edited export of products.xlsx (the same
// file/format produced by src/app/api/admin/products/export/route.ts).
// Based on src/app/api/admin/products/import/route.ts, with differences
// these hand-edited sheets need:
//   - By default only NON-BLANK sheet cells overwrite a field (most rows only
//     have category/color/stock/description/etc. filled in — name/price/
//     fabric/slug/sizes are blank and must not be wiped to empty/0). Pass
//     --full-overwrite to instead apply every cell as-is, blanks included —
//     use this only when the sheet is a genuinely complete row-per-row dump
//     and blank really does mean "clear this field".
//   - A "status" column (Active/Inactive) drives each product's active flag
//     when present. Falls back to the older convention of an unlabeled
//     trailing column (past `preview`) holding a "DUPLICATE" marker, which
//     sets the row inactive instead of being deleted.
//   - The sheet's embedded preview images can be saved with a nonstandard
//     drawing XML namespace (e.g. after a LibreOffice round-trip) that
//     crashes ExcelJS's parser. Since this script never reads those images,
//     drawings are stripped from the workbook before parsing.
//
// Usage: node scripts/import-products-xlsx.mjs <path-to.xlsx> [--apply] [--full-overwrite]
//   (default is a dry run — report only, no DB writes)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import ws from "ws";

config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const FULL_OVERWRITE = process.argv.includes("--full-overwrite");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/import-products-xlsx.mjs <path-to.xlsx> [--apply] [--full-overwrite]");
  process.exit(1);
}

// Some re-saved sheets carry embedded preview images whose drawing XML uses
// a default namespace instead of the "xdr:" prefix ExcelJS expects, which
// crashes its parser entirely. Strip drawings from the zip before loading —
// this script only reads cell values, never the images.
async function loadWorkbookWithoutDrawings(filePath) {
  const zip = await JSZip.loadAsync(await import("node:fs/promises").then((fs) => fs.readFile(filePath)));
  const toRemove = [];
  zip.forEach((relPath) => {
    if (/^xl\/drawings\//.test(relPath)) toRemove.push(relPath);
  });
  for (const p of toRemove) zip.remove(p);

  const rewrite = async (relPath, replacer) => {
    const f = zip.file(relPath);
    if (!f) return;
    const xml = await f.async("string");
    const cleaned = replacer(xml);
    if (cleaned !== xml) zip.file(relPath, cleaned);
  };
  const relFiles = [];
  const sheetFiles = [];
  zip.forEach((relPath) => {
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(relPath)) relFiles.push(relPath);
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(relPath)) sheetFiles.push(relPath);
  });
  for (const p of relFiles) {
    await rewrite(p, (xml) => xml.replace(/<Relationship[^>]*Type="[^"]*\/drawing"[^>]*\/>/g, ""));
  }
  for (const p of sheetFiles) {
    await rewrite(p, (xml) => xml.replace(/<drawing[^>]*\/>/g, ""));
  }
  await rewrite("[Content_Types].xml", (xml) =>
    xml.replace(/<Override[^>]*PartName="\/xl\/drawings\/[^"]*"[^>]*\/>/g, "")
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SECRET_KEY } = process.env;
if (!URL_ || !SUPABASE_SECRET_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const supabase = createClient(URL_, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

// ── Same field sanitisers as src/lib/admin/product-input.ts ────────────────
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const num = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));
const str = (v) => String(v ?? "").trim();
const arr = (v) =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

// ── Same columns as src/lib/admin/product-sheet.ts ──────────────────────────
const COLUMN_KEYS = [
  "id", "slug", "name", "fabric", "price", "oldPrice", "tag", "category",
  "subcategory", "gender", "color", "stock", "rating", "reviews", "sizes",
  "keywords", "description", "panel", "motif", "tone",
  "primary_image_url", "preview", "status",
];
const normHeader = (s) => s.split("(")[0].trim().toLowerCase().replace(/\s+/g, "_");
const KEY_BY_HEADER = new Map(COLUMN_KEYS.map((k) => [normHeader(k), k]));

function rowToDraft(row) {
  const name = str(row.name);
  return {
    name,
    slug: str(row.slug) || slugify(name),
    fabric: str(row.fabric),
    price: num(row.price),
    oldPrice: row.oldPrice === "" || row.oldPrice == null ? null : num(row.oldPrice),
    tag: str(row.tag) || null,
    category: str(row.category),
    subcategory: str(row.subcategory),
    gender: str(row.gender) || "Women",
    color: str(row.color),
    stock: num(row.stock),
    rating: Math.min(5, Number(row.rating) || 4.5),
    reviews: num(row.reviews),
    sizes: arr(row.sizes),
    keywords: str(row.keywords),
    description: str(row.description),
    panel: str(row.panel) || "p-indigo",
    motif: str(row.motif) || "paisley",
    tone: str(row.tone) || "m-gold",
  };
}

// Fields the sheet had a genuinely non-blank cell for. `row.eachCell` was
// called with includeEmpty:false while parsing, so `rec` simply doesn't have
// a key for a blank cell — that's what we key off of here.
const DRAFT_KEYS = [
  "name", "slug", "fabric", "price", "oldPrice", "tag", "category", "subcategory",
  "gender", "color", "stock", "rating", "reviews", "sizes", "keywords",
  "description", "panel", "motif", "tone",
];
function presentKeys(rec) {
  return new Set(DRAFT_KEYS.filter((k) => rec[k] !== undefined && String(rec[k]).trim() !== ""));
}
// Keep only the fields the sheet actually had values for — blank cells must
// not clobber existing data (most rows in this sheet only carry
// category/color/stock/description/etc., not name/price/fabric/slug/sizes).
function partialDraft(rec) {
  const draft = rowToDraft(rec);
  const present = presentKeys(rec);
  const out = {};
  for (const k of Object.keys(draft)) if (present.has(k)) out[k] = draft[k];
  return out;
}

async function main() {
  const wb = await loadWorkbookWithoutDrawings(file);
  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    console.error("The sheet has no data rows");
    process.exit(1);
  }

  const colKey = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = KEY_BY_HEADER.get(normHeader(String(cell.text ?? cell.value ?? "")));
    if (key) colKey[colNumber] = key;
  });
  if (!Object.values(colKey).includes("id")) {
    console.error("Missing an 'id' column in the sheet.");
    process.exit(1);
  }

  const parsed = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec = {};
    let any = false;
    let duplicate = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const v = cell.text ?? cell.value ?? "";
      const key = colKey[colNumber];
      if (key) {
        rec[key] = v;
        if (String(v).trim()) any = true;
      } else if (String(v).trim().toUpperCase() === "DUPLICATE") {
        // Unlabeled trailing column used to flag duplicate listings.
        duplicate = true;
      }
    });
    if (any) parsed.push({ row: rowNumber, rec, duplicate });
  });
  if (!parsed.length) {
    console.error("No data rows found");
    process.exit(1);
  }

  const { data: existingRows, error: readErr } = await supabase.from("products").select("id,data");
  if (readErr) throw new Error(readErr.message);
  const existing = new Map((existingRows ?? []).map((r) => [r.id, r.data]));
  let maxNum = (existingRows ?? []).reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, "")) || 0), 0);

  const now = new Date().toISOString();
  const writes = [];
  const results = [];
  let deactivated = 0;
  let reactivated = 0;

  for (const { row, rec, duplicate } of parsed) {
    const id = str(rec.id);

    if (id) {
      const before = existing.get(id);
      if (before) {
        const draft = FULL_OVERWRITE ? rowToDraft(rec) : partialDraft(rec);
        // "status" column (Active/Inactive) is authoritative when present;
        // otherwise fall back to the older DUPLICATE-marker convention.
        const statusActive = rec.status !== undefined ? str(rec.status).toLowerCase() === "active" : null;
        const activeOverride = statusActive !== null ? { active: statusActive } : duplicate ? { active: false } : {};
        if (activeOverride.active === false && before.active !== false) deactivated++;
        if (activeOverride.active === true && before.active === false) reactivated++;
        writes.push({ id, data: { ...before, ...draft, ...activeOverride, updatedAt: now } });
        results.push({ row, id, action: activeOverride.active === false ? "updated (marked inactive)" : "updated" });
      } else {
        results.push({ row, id, action: "error", message: `id "${id}" not found — nothing updated` });
      }
    } else if (rowToDraft(rec).name) {
      const draft = rowToDraft(rec);
      const newId = `PROD_${++maxNum}`;
      writes.push({
        id: newId,
        data: { id: newId, ...draft, gallery: [], variants: [], imagePath: null, blurDataURL: "", createdAt: now, updatedAt: now, active: true },
      });
      results.push({ row, id: newId, action: "created" });
    } else {
      results.push({ row, id: "", action: "error", message: "blank id and no name — row skipped" });
    }
  }

  const updated = results.filter((r) => r.action.startsWith("updated")).length;
  const created = results.filter((r) => r.action === "created").length;
  const errors = results.filter((r) => r.action === "error");

  console.log(APPLY ? "APPLYING (--apply)" : "DRY RUN — nothing will be written (pass --apply to write)");
  console.log(FULL_OVERWRITE ? "Mode: FULL OVERWRITE — blank cells clear existing fields" : "Mode: partial — blank cells leave existing fields untouched");
  console.log(
    `${parsed.length} data row(s): ${updated} to update, ${created} to create, ` +
      `${deactivated} newly marked inactive, ${reactivated} newly marked active, ${errors.length} error(s).\n`
  );
  for (const e of errors) console.log(`  row ${e.row}: ${e.message}`);

  if (APPLY) {
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400).map((w) => ({ id: w.id, data: w.data }));
      const { error } = await supabase.from("products").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(error.message);
      console.log(`  wrote rows ${i + 1}-${Math.min(i + 400, writes.length)}`);
    }
    console.log(`\nDone. Updated ${updated}, created ${created}, ${deactivated} marked inactive, ${reactivated} marked active, ${errors.length} error(s).`);
    await revalidateProducts();
  } else {
    console.log("\nDry run only — re-run with --apply to write these changes.");
  }
}

// This script writes straight to Supabase, bypassing every admin API route —
// so the unstable_cache-backed reads in src/lib/data/products.ts never get
// their revalidateTag("products") bump and keep serving stale data for up to
// an hour (see src/app/api/internal/revalidate/route.ts). Bust it here so the
// site reflects the import immediately.
async function revalidateProducts() {
  const url = process.env.REVALIDATE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    console.log("\n(skipped cache revalidation — set REVALIDATE_URL and REVALIDATE_SECRET to enable)");
    return;
  }
  try {
    const res = await fetch(new URL("/api/internal/revalidate", url), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ tag: "products" }),
    });
    console.log(res.ok ? `\nRevalidated products cache at ${url}` : `\nRevalidation failed: HTTP ${res.status}`);
  } catch (e) {
    console.log(`\nRevalidation request failed: ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
