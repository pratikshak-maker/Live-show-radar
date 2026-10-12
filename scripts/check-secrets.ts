/* Fails if a secret-looking env var name appears with a NEXT_PUBLIC_ prefix anywhere in the repo. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_WORDS = ["KEY", "SECRET", "TOKEN", "PASSWORD", "PASSCODE", "SERVICE_ROLE"];
const SKIP = new Set(["node_modules", ".next", ".git", "coverage"]);
const pattern = /NEXT_PUBLIC_[A-Z0-9_]+/g;
const problems: string[] = [];

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json|md|yml|yaml|env|example|sql)$/.test(name) || name.startsWith(".env")) {
      if (p.endsWith("check-secrets.ts")) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.match(pattern) ?? []) {
        if (SECRET_WORDS.some((w) => m.includes(w))) problems.push(`${p}: ${m}`);
      }
    }
  }
}

walk(process.cwd());
if (problems.length) {
  console.error("Secret names with NEXT_PUBLIC_ prefix found:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("check:secrets ok — no NEXT_PUBLIC_ secrets.");
