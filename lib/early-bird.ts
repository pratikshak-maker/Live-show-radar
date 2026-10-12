/** Tier names we treat as early-bird pricing. */
export const EARLY_BIRD_RE = /early[\s-]?bird|phase\s*0|\bblind\b|pre-?sale|launch price/i;

export const isEarlyBirdName = (name: string): boolean => EARLY_BIRD_RE.test(name);
