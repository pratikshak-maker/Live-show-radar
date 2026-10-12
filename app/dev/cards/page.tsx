import { notFound } from "next/navigation";
import { cardFixtures } from "@/lib/fixtures";
import { DevCards } from "./DevCards";

export const dynamic = "force-dynamic";

export default function DevCardsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevCards items={cardFixtures()} />;
}
