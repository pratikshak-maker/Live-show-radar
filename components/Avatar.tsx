import Image from "next/image";
import { monogram } from "@/lib/normalize";

export function Avatar({
  name,
  src,
  size = 56,
  className = "",
}: {
  name: string;
  src: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (src && /^https:\/\//.test(src)) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        unoptimized
        referrerPolicy="no-referrer"
        className={`shrink-0 rounded-[14px] object-cover ${className}`}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, fontSize: size * 0.36 }}
      className={`artist-name grid shrink-0 place-items-center rounded-[14px] bg-raised text-muted ${className}`}
    >
      {monogram(name)}
    </span>
  );
}
