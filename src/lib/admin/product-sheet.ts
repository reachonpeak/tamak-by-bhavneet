import "server-only";
import type { Product } from "@/lib/types";
import { str, num, arr, slugify } from "@/lib/admin/product-input";

// Single source of truth for the products spreadsheet (Excel/CSV) used by the
// admin export + import routes, so headers and parsing never drift.
//
// The `id` column is the JOIN KEY: on import each row is matched back to an
// existing product by `id`. Do NOT edit or reorder the id column. Rows with a
// blank id are created as brand-new products.
//
// Images are intentionally NOT editable through the sheet — `primary_image_url`
// and `preview` are read-only. Import never touches a product's gallery/photos.

export interface SheetColumn {
  key: string;
  header: string;
  width: number;
  /** value written to the cell on export */
  get: (p: Product) => string | number;
}

/** Best available primary image URL for the read-only preview column. */
export const primaryImageUrl = (p: Product): string =>
  p.gallery?.[0]?.thumbUrl || p.gallery?.[0]?.url || p.gallery?.[0]?.fullUrl || p.image || "";

// Order here = column order in the sheet.
export const COLUMNS: SheetColumn[] = [
  { key: "id", header: "id", width: 12, get: (p) => p.id },
  { key: "slug", header: "slug", width: 22, get: (p) => p.slug },
  { key: "name", header: "name", width: 30, get: (p) => p.name },
  { key: "fabric", header: "fabric", width: 26, get: (p) => p.fabric },
  { key: "price", header: "price", width: 10, get: (p) => p.price },
  { key: "oldPrice", header: "oldPrice", width: 10, get: (p) => p.oldPrice ?? "" },
  { key: "tag", header: "tag", width: 12, get: (p) => p.tag ?? "" },
  { key: "category", header: "category", width: 18, get: (p) => p.category },
  { key: "subcategory", header: "subcategory", width: 18, get: (p) => p.subcategory },
  { key: "gender", header: "gender", width: 10, get: (p) => p.gender },
  { key: "color", header: "color", width: 12, get: (p) => p.color },
  { key: "stock", header: "stock", width: 8, get: (p) => p.stock },
  { key: "rating", header: "rating", width: 8, get: (p) => p.rating },
  { key: "reviews", header: "reviews", width: 8, get: (p) => p.reviews },
  { key: "sizes", header: "sizes (comma-separated)", width: 22, get: (p) => (p.sizes ?? []).join(", ") },
  { key: "keywords", header: "keywords", width: 26, get: (p) => p.keywords },
  { key: "description", header: "description", width: 50, get: (p) => p.description },
  { key: "panel", header: "panel", width: 12, get: (p) => p.panel },
  { key: "motif", header: "motif", width: 10, get: (p) => p.motif },
  { key: "tone", header: "tone", width: 10, get: (p) => p.tone },
  { key: "primary_image_url", header: "primary_image_url (read-only)", width: 44, get: (p) => primaryImageUrl(p) },
  { key: "preview", header: "preview (read-only)", width: 16, get: () => "" },
  { key: "status", header: "status", width: 10, get: (p) => (p.active === false ? "Inactive" : "Active") },
];

/** Column key of the embedded photo-preview column (1-indexed position in the sheet). */
export const PREVIEW_COL_INDEX = COLUMNS.findIndex((c) => c.key === "preview") + 1;

/**
 * Sanitise one parsed sheet row into a partial product doc containing ONLY the
 * editable text/number fields. Deliberately omits id, gallery, imagePath,
 * blurDataURL and variants so a merge-write preserves a product's photos.
 */
export function rowToDraft(row: Record<string, unknown>) {
  const name = str(row.name);
  // Blank/missing "status" leaves a product's current active state alone —
  // only an explicit Active/Inactive value should flip it.
  const status = row.status !== undefined ? str(row.status).toLowerCase() : "";
  const activePatch = status ? { active: status !== "inactive" } : {};
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
    panel: (str(row.panel) || "p-indigo") as Product["panel"],
    motif: (str(row.motif) || "paisley") as Product["motif"],
    tone: (str(row.tone) || "m-gold") as Product["tone"],
    ...activePatch,
  };
}
