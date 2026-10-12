import { Activity, Mic2, Radar, Settings } from "lucide-react";

export const NAV = [
  { href: "/", label: "Radar", icon: Radar },
  { href: "/artists", label: "Artists", icon: Mic2 },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
