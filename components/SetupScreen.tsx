import Link from "next/link";
import { getConfiguredMap } from "@/lib/integrations/registry";
import { CopyButton } from "./CopyButton";

import { setupDocUrl } from "@/lib/constants";

export function SetupScreen() {
  const map = getConfiguredMap();
  const steps = [
    {
      title: "Create a free Neon Postgres database",
      body: "In the Neon SQL editor, run db/migrations/0001_init.sql, then copy the pooled connection string.",
      vars: ["DATABASE_URL"],
      done: map.database.configured,
    },
    {
      title: "Add a Gemini API key",
      body: "Get one at aistudio.google.com. Gemini does the searching and reads the pages.",
      vars: ["GEMINI_API_KEY"],
      done: map.gemini.configured,
    },
    {
      title: "Add a secret for the scheduler",
      body: "A long random string that cron-job.org sends so only it can trigger scans.",
      vars: ["CRON_SECRET"],
      done: Boolean(process.env.CRON_SECRET),
    },
  ];
  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="text-3xl font-bold">Almost there — connect your database</h1>
      <p className="mt-2 max-w-[70ch] text-muted">
        Live Show Radar needs a place to keep your artists and shows. It takes about five minutes,
        and you only do it once. Everything else is optional.
      </p>
      <ol className="mt-6 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-[18px] border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                  s.done ? "bg-confirmed text-stage-ink" : "bg-raised text-ink"
                }`}
                aria-label={s.done ? "Done" : `Step ${i + 1}`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{s.title}</h2>
                <p className="text-sm text-muted">{s.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.vars.map((v) => (
                    <CopyButton key={v} text={v} />
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted">
        Add these to <code>.env.local</code> (or Vercel → Settings → Environment Variables), then
        reload. Full walkthrough:{" "}
        <a
          href={setupDocUrl("")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-stage underline underline-offset-2"
        >
          SETUP.md
        </a>
        .{" "}
        <Link href="/settings" className="text-stage underline underline-offset-2">
          See all connections
        </Link>
      </p>
    </div>
  );
}
