import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const display = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-face",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Live Show Radar",
  description:
    "An agent that watches the artists you follow and alerts you the moment a show is announced in India.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#00004a" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeInit = `try{var t=localStorage.getItem('lsr-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
