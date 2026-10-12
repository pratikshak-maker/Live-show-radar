"use client";

import Image from "next/image";
import { monogram } from "@/lib/normalize";

/** Images already in the cache can finish loading before React hydrates; show them at once. */
export function markIfLoaded(el: HTMLImageElement | null) {
  if (el?.complete && el.naturalWidth > 0) el.dataset.loaded = "true";
}

/** Artist photo with a soft fade-in; a cobalt→sky monogram when no photo exists. */
export function Avatar({
  name,
  src,
  size = 56,
  className = "",
  rounded = "rounded-[12px]",
  zoom = false,
}: {
  name: string;
  src: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: string;
  zoom?: boolean;
}) {
  const box = { width: size, height: size };
  if (src && /^https:\/\//.test(src)) {
    return (
      <span
        className={`relative block shrink-0 overflow-hidden bg-raised ${rounded} ${className}`}
        style={box}
      >
        <Image
          src={src}
          alt=""
          width={size * 2}
          height={size * 2}
          unoptimized
          referrerPolicy="no-referrer"
          ref={markIfLoaded}
          onLoad={(e) => (e.currentTarget.dataset.loaded = "true")}
          className={`fade-img h-full w-full object-cover ${zoom ? "zoom-img" : ""}`}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        ...box,
        fontSize: size * 0.36,
        background: "linear-gradient(135deg, var(--cobalt), var(--sky))",
      }}
      className={`artist-name grid shrink-0 place-items-center text-white ${rounded} ${className}`}
    >
      {monogram(name)}
    </span>
  );
}
