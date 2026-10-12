"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "./nav";
import { ScanButton } from "./ScanButton";
import { NotificationsBell } from "./NotificationsBell";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="palette-stripe" aria-hidden />
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-[-0.03em] md:text-xl"
        >
          <span className="logo-mark" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
          Live Show Radar
        </Link>
        <nav aria-label="Main" className="mx-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-[10px] px-3.5 py-2 text-sm font-medium ${
                      active ? "bg-stage text-stage-ink" : "text-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <ScanButton />
          <NotificationsBell />
          <span className="hidden md:block">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </header>
  );
}
