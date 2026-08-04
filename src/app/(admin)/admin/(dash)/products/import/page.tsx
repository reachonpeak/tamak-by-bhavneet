"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

type RowResult = { row: number; id: string; action: "updated" | "created" | "error"; message?: string };
type ImportResult = { ok: boolean; updated: number; created: number; errors: number; rows: RowResult[] };

export default function ImportProductsPage() {
  const { getToken } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a .xlsx or .csv file first.");
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/products/import", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || "Import failed.");
      } else {
        setResult(j as ImportResult);
      }
    } catch {
      setError("Something went wrong while uploading.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="adm-list-head">
        <div>
          <span className="adm-eyebrow">Catalog</span>
          <h1 className="adm-h">Import products</h1>
          <p className="adm-sub">Upload an edited spreadsheet to update or add products in bulk.</p>
        </div>
        <Link className="adm-btn adm-btn--ghost" href="/admin/products">← Back to products</Link>
      </div>

      <div className="adm-card" style={{ marginBottom: "1.2rem" }}>
        <ol style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.9 }}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <li><a href="/api/admin/products/export" style={{ textDecoration: "underline", fontWeight: 600 }}>Download the current catalog</a> as an Excel file.</li>
          <li>Edit the rows — price, stock, name, category, description, etc.</li>
          <li>To add a product, add a new row and <b>leave its <code>id</code> blank</b>.</li>
          <li>Do <b>not</b> change or reorder the <code>id</code> column — it links each row to its product.</li>
          <li>Set <code>status</code> to <code>Active</code> or <code>Inactive</code> to control whether a product is visible on the storefront.</li>
          <li>Save the file, then upload it below.</li>
        </ol>
        <p className="adm-sub" style={{ marginTop: ".8rem" }}>
          Photos are <b>not</b> changed by import — manage product images in the product editor. The
          <code> preview</code> and <code> primary_image_url</code> columns are read-only.
        </p>
      </div>

      <div className="adm-card">
        <div className="adm-field">
          <span>Spreadsheet file (.xlsx or .csv)</span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="adm-in"
            onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); setError(""); setResult(null); }}
          />
        </div>
        <div className="adm-row" style={{ marginTop: "1rem", alignItems: "center", gap: ".8rem" }}>
          <button className="adm-btn adm-btn--gold" onClick={upload} disabled={busy || !fileName}>
            {busy ? "Uploading…" : "Upload & import"}
          </button>
          {fileName && <span className="adm-sub">{fileName}</span>}
        </div>
        {error && <p className="adm-error" style={{ marginTop: ".8rem" }}>{error}</p>}
      </div>

      {result && (
        <div className="adm-card" style={{ marginTop: "1.2rem" }}>
          <h2 className="adm-h" style={{ fontSize: "1.1rem" }}>Import complete</h2>
          <p className="adm-sub" style={{ marginBottom: "1rem" }}>
            <span className="adm-pill adm-pill--active">{result.updated} updated</span>{" "}
            <span className="adm-pill adm-pill--active">{result.created} created</span>{" "}
            {result.errors > 0 && <span className="adm-pill adm-pill--low">{result.errors} errors</span>}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr><th>Row</th><th>Product id</th><th>Action</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={`${r.row}-${r.id}`}>
                    <td data-label="Row">{r.row}</td>
                    <td data-label="Product id">{r.id || "—"}</td>
                    <td data-label="Action">
                      {r.action === "error"
                        ? <span className="adm-pill adm-pill--low">error</span>
                        : <span className="adm-pill">{r.action}</span>}
                    </td>
                    <td data-label="Notes">{r.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
