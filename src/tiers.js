// Maps a URL count to a size tier and an Ahrefs "Max number of internal pages" cap.
const UNKNOWN_TIER = Object.freeze({
  tier: 'UNKNOWN',
  weight: null,
  crawlCap: null,
  needsSessions: false,
  frequency: 'manual-check',
  method: 'count-urls-manually',
});

export function assignTier(urlCount, config) {
  if (!Number.isFinite(urlCount) || urlCount <= 0) return { ...UNKNOWN_TIER };

  const tier = config.tiers.find((t) => t.maxUrls === null || urlCount <= t.maxUrls);
  const wantedCap = Math.max(config.minCrawlCap, Math.ceil(urlCount * config.crawlCapMultiplier));

  return {
    tier: tier.name,
    weight: tier.weight,
    crawlCap: Math.min(wantedCap, config.ahrefsCapLimit),
    // The site needs more pages than one Ahrefs crawl allows: split into folder sessions.
    needsSessions: wantedCap > config.ahrefsCapLimit,
    frequency: tier.frequency,
    method: tier.method,
  };
}
