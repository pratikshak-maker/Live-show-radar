"use client";

import { useEffect } from "react";

const SELECTOR = ".bg-stage, [data-ripple]";

/** One document-level listener: primary buttons (and anything with data-ripple) get a ripple on click. */
export function RippleLayer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      const host = (e.target as Element | null)?.closest<HTMLElement>(SELECTOR);
      if (!host || host.matches(":disabled")) return;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      const cs = getComputedStyle(host);
      if (cs.position === "static") host.style.position = "relative";
      host.style.overflow = "hidden";
      const size = Math.max(rect.width, rect.height) * 2;
      const wave = document.createElement("span");
      wave.className = "ripple-wave";
      wave.style.width = wave.style.height = `${size}px`;
      wave.style.left = `${e.clientX - rect.left - size / 2}px`;
      wave.style.top = `${e.clientY - rect.top - size / 2}px`;
      host.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove(), { once: true });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
