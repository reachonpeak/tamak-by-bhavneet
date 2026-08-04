"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef } from "react";
import type { Product } from "@/lib/types";
import { inr } from "@/lib/format";
import { useStore } from "./StoreProvider";

const vb = (m: string) => (m === "mandala" ? "0 0 200 200" : "0 0 240 280");

export default function ProductDetail({ p }: { p: Product }) {
  const { addToBag, toggleWish, isWished, toast } = useStore();
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  const [zooming, setZooming] = useState(false);
  const touch = useRef<{ x0: number | null; dx: number }>({ x0: null, dx: 0 });
  const mainRef = useRef<HTMLDivElement>(null);
  const saved = isWished(p.id);

  // use product gallery directly
  const gallery = p.gallery.length ? p.gallery : [{ path: "", blurDataURL: "", url: undefined }];
  const main = gallery[Math.min(active, gallery.length - 1)];
  const stock = p.stock;

  const onAdd = () => {
    if (stock <= 0) {
      toast("Out of stock");
      return;
    }
    addToBag({ id: p.id, name: p.name, price: p.price, image: main?.url ?? p.image, qty });
    toast(`Added to bag · ${p.name}`);
  };

  return (
    <div className="pdp">
      <div className="pdp__gallery">
        <div
          ref={mainRef}
          className={`pdp__main frame ${p.panel}${zooming ? " is-zooming" : ""}`}
          onMouseEnter={() => setZooming(true)}
          onTouchStart={(e) => {
            if (gallery.length <= 1) return;
            touch.current = { x0: e.touches[0].clientX, dx: 0 };
          }}
          onTouchMove={(e) => {
            if (gallery.length <= 1 || touch.current.x0 === null) return;
            touch.current.dx = e.touches[0].clientX - touch.current.x0;
          }}
          onTouchEnd={() => {
            if (gallery.length <= 1 || touch.current.x0 === null) return;
            const dx = touch.current.dx;
            if (Math.abs(dx) > 40) {
              if (dx < 0) {
                setActive((prev) => (prev + 1) % gallery.length);
              } else {
                setActive((prev) => (prev - 1 + gallery.length) % gallery.length);
              }
            }
            touch.current.x0 = null;
          }}
          onTouchCancel={() => {
            touch.current.x0 = null;
          }}
          onMouseDown={(e) => {
            if (gallery.length <= 1) return;
            touch.current = { x0: e.clientX, dx: 0 };
          }}
          onMouseMove={(e) => {
            if (touch.current.x0 === null) {
              const rect = e.currentTarget.getBoundingClientRect();
              const xPct = ((e.clientX - rect.left) / rect.width) * 100;
              const yPct = ((e.clientY - rect.top) / rect.height) * 100;
              e.currentTarget.style.setProperty("--zx", `${xPct}%`);
              e.currentTarget.style.setProperty("--zy", `${yPct}%`);
            }
            if (gallery.length <= 1 || touch.current.x0 === null) return;
            const dx = e.clientX - touch.current.x0;
            if (Math.abs(dx) > 5) {
              e.preventDefault();
            }
            touch.current.dx = dx;
          }}
          onMouseUp={() => {
            if (gallery.length <= 1 || touch.current.x0 === null) return;
            const dx = touch.current.dx;
            if (Math.abs(dx) > 40) {
              if (dx < 0) {
                setActive((prev) => (prev + 1) % gallery.length);
              } else {
                setActive((prev) => (prev - 1 + gallery.length) % gallery.length);
              }
            }
            touch.current.x0 = null;
          }}
          onMouseLeave={() => {
            touch.current.x0 = null;
            setZooming(false);
          }}
        >
          {main?.url ? (
            <Image
              src={main.fullUrl || main.url || ""}
              alt={p.name}
              fill
              priority
              sizes="(max-width:860px) 100vw, 50vw"
              placeholder={main.blurDataURL ? "blur" : "empty"}
              blurDataURL={main.blurDataURL}
              style={{ objectFit: "cover" }}
              className="pdp__main-img"
              draggable={false}
            />
          ) : (
            <div className={`motif ${p.tone}`}>
              <svg viewBox={vb(p.motif)}>
                <use href={`#${p.motif}`} />
              </svg>
            </div>
          )}

          {gallery.length > 1 && (
            <>
              <button
                className="pdp__nav pdp__nav--prev"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((prev) => (prev - 1 + gallery.length) % gallery.length);
                }}
                aria-label="Previous image"
              >
                <svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button
                className="pdp__nav pdp__nav--next"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((prev) => (prev + 1) % gallery.length);
                }}
                aria-label="Next image"
              >
                <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </>
          )}
        </div>
        {gallery.length > 1 && (
          <div className="pdp__thumbs">
            {gallery.map((g, i) => (
              <button
                key={i}
                className={`pdp__thumb frame ${p.panel}${i === active ? " active" : ""}`}
                onClick={() => setActive(i)}
                aria-label={`View image ${i + 1}`}
              >
                {g.url ? (
                  <Image src={g.thumbUrl || g.url || ""} alt="" fill sizes="70px" style={{ objectFit: "cover" }} />
                ) : (
                  <div className={`motif ${p.tone}`} style={{ opacity: 0.5 }}>
                    <svg viewBox={vb(p.motif)}>
                      <use href={`#${p.motif}`} />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pdp__info">
        <span className="eyebrow">{p.category}</span>
        <h1>{p.name}</h1>
        <div className="rating">
          <span className="stars" aria-hidden="true">
            {"★★★★★☆☆☆☆☆".slice(5 - Math.round(p.rating), 10 - Math.round(p.rating))}
          </span>{" "}
          <b>{p.rating.toFixed(1)}</b> <span>({p.reviews} reviews)</span>
        </div>
        <p className="fab">{p.fabric}</p>
        <div className="pdp__price">
          ₹{inr(p.price)}
          {p.oldPrice && <s>₹{inr(p.oldPrice)}</s>}
        </div>
        {p.description && <p className="pdp__desc">{p.description}</p>}


        <div style={{ display: "flex", alignItems: "center", gap: "1rem", margin: ".4rem 0 1rem" }}>
          <span className="eyebrow">Qty</span>
          <div className="qty">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(10, q + 1))} aria-label="Increase quantity">+</button>
          </div>
        </div>

        <div className="hero__cta">
          <button className="btn btn--solid" onClick={onAdd}>Add to Cart</button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              toggleWish(p.id);
              toast(saved ? "Removed from wishlist" : "Saved to wishlist");
            }}
          >
            {saved ? "Saved ♥" : "Save"}
          </button>
        </div>

        <div className="pdp__meta">
          <div>{stock > 0 ? "In stock · Ships within 2–3 business days" : "Currently unavailable"}</div>
          <div>Unstitched fabric · Dispatched as-is</div>
          <div>Free shipping across India · Easy 7-day returns</div>
          <div>For {p.gender}</div>
        </div>

        <Link className="link-back" href="/shop" style={{ marginTop: "1.4rem" }}>← Back to shop</Link>
      </div>
    </div>
  );
}
