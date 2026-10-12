import { distance } from "fastest-levenshtein";

/** Ticketing + listing domains we trust enough to scrape or cite (editable). */
export const TICKETING_ALLOWLIST = [
  "district.in",
  "insider.in",
  "bookmyshow.com",
  "in.bookmyshow.com",
  "skillboxes.com",
  "sortmyscene.com",
  "ticketmaster.com",
  "ticketmaster.co.in",
  "zomato.com",
  "highape.com",
  "allevents.in",
  "songkick.com",
  "bandsintown.com",
];

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isTicketingDomain(url: string | null | undefined): boolean {
  if (!url) return false;
  const d = domainOf(url);
  if (!d) return false;
  return TICKETING_ALLOWLIST.some((a) => d === a || d.endsWith(`.${a}`));
}

export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Normalised URL for equality checks (no hash, no trailing slash, no tracking params). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** "Björk" / "The Local Train" / "Peter Cat Recording Co." → comparable form. */
export function normalizeArtist(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function similarity(a: string, b: string): number {
  const x = normalizeArtist(a);
  const y = normalizeArtist(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

export type City = { name: string; slug: string; state: string; lat: number; lng: number };

const C = (name: string, state: string, lat: number, lng: number): City => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  state,
  lat,
  lng,
});

export const CITIES: Record<string, City> = {
  Bengaluru: C("Bengaluru", "Karnataka", 12.9716, 77.5946),
  Mumbai: C("Mumbai", "Maharashtra", 19.076, 72.8777),
  "Delhi NCR": C("Delhi NCR", "Delhi", 28.6139, 77.209),
  Chennai: C("Chennai", "Tamil Nadu", 13.0827, 80.2707),
  Kolkata: C("Kolkata", "West Bengal", 22.5726, 88.3639),
  Hyderabad: C("Hyderabad", "Telangana", 17.385, 78.4867),
  Pune: C("Pune", "Maharashtra", 18.5204, 73.8567),
  Goa: C("Goa", "Goa", 15.4909, 73.8278),
  Kochi: C("Kochi", "Kerala", 9.9312, 76.2673),
  Shillong: C("Shillong", "Meghalaya", 25.5788, 91.8933),
  Guwahati: C("Guwahati", "Assam", 26.1445, 91.7362),
  Jaipur: C("Jaipur", "Rajasthan", 26.9124, 75.7873),
  Ahmedabad: C("Ahmedabad", "Gujarat", 23.0225, 72.5714),
  Chandigarh: C("Chandigarh", "Chandigarh", 30.7333, 76.7794),
  Indore: C("Indore", "Madhya Pradesh", 22.7196, 75.8577),
  Lucknow: C("Lucknow", "Uttar Pradesh", 26.8467, 80.9462),
  Mysuru: C("Mysuru", "Karnataka", 12.2958, 76.6394),
  Visakhapatnam: C("Visakhapatnam", "Andhra Pradesh", 17.6868, 83.2185),
  Thiruvananthapuram: C("Thiruvananthapuram", "Kerala", 8.5241, 76.9366),
  Udaipur: C("Udaipur", "Rajasthan", 24.5854, 73.7125),
  Puducherry: C("Puducherry", "Puducherry", 11.9416, 79.8083),
  Kasauli: C("Kasauli", "Himachal Pradesh", 30.8989, 76.965),
  Dharamshala: C("Dharamshala", "Himachal Pradesh", 32.219, 76.3234),
};

const ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  blr: "Bengaluru",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  "navi mumbai": "Mumbai",
  thane: "Mumbai",
  delhi: "Delhi NCR",
  "new delhi": "Delhi NCR",
  ncr: "Delhi NCR",
  "delhi ncr": "Delhi NCR",
  gurgaon: "Delhi NCR",
  gurugram: "Delhi NCR",
  noida: "Delhi NCR",
  "greater noida": "Delhi NCR",
  madras: "Chennai",
  chennai: "Chennai",
  calcutta: "Kolkata",
  kolkata: "Kolkata",
  hyderabad: "Hyderabad",
  secunderabad: "Hyderabad",
  pune: "Pune",
  goa: "Goa",
  vagator: "Goa",
  anjuna: "Goa",
  panaji: "Goa",
  panjim: "Goa",
  assagao: "Goa",
  kochi: "Kochi",
  cochin: "Kochi",
  ernakulam: "Kochi",
  shillong: "Shillong",
  guwahati: "Guwahati",
  jaipur: "Jaipur",
  ahmedabad: "Ahmedabad",
  chandigarh: "Chandigarh",
  indore: "Indore",
  lucknow: "Lucknow",
  mysuru: "Mysuru",
  mysore: "Mysuru",
  visakhapatnam: "Visakhapatnam",
  vizag: "Visakhapatnam",
  thiruvananthapuram: "Thiruvananthapuram",
  trivandrum: "Thiruvananthapuram",
  udaipur: "Udaipur",
  puducherry: "Puducherry",
  pondicherry: "Puducherry",
  kasauli: "Kasauli",
  dharamshala: "Dharamshala",
  dharamsala: "Dharamshala",
};

/** Resolve an Indian city alias to its canonical record, or null if unknown. */
export function resolveCity(raw: string | null | undefined): City | null {
  if (!raw) return null;
  const key = raw
    .toLowerCase()
    .replace(/,.*$/, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const canonical = ALIASES[key];
  return canonical ? (CITIES[canonical] ?? null) : null;
}

export function isHomeCity(cityName: string, homeCity: string): boolean {
  const home = resolveCity(homeCity)?.name ?? homeCity;
  return cityName === home;
}

export function citySlug(name: string): string {
  return resolveCity(name)?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function dedupeKey(artistName: string, citySlugValue: string, startDate: string): string {
  return `${normalizeArtist(artistName)}|${citySlugValue}|${startDate}`;
}

export function venueKey(venue: string, city: string): string {
  return `${venue.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${citySlug(city)}`;
}

export function monogram(name: string): string {
  const words = name.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
