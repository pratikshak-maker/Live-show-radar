"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-raised px-3 text-sm hover:bg-line"
      aria-label={`Copy ${text}`}
    >
      <code>{text}</code>
      {copied ? <Check className="h-3.5 w-3.5 text-confirmed" /> : <Copy className="h-3.5 w-3.5 text-muted" />}
    </button>
  );
}
