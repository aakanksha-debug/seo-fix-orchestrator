// URL Scout: counts a site's pages from its public robots.txt and XML sitemaps.
// Read-only by design: it only issues GET requests for robots.txt, sitemaps and the homepage.
import { gunzipSync } from 'node:zlib';

const FALLBACK_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const LOC_PATTERN = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi;
const TOP_FOLDER_COUNT = 10;

// Hints only: confirm the CMS before any fix is planned.
const CMS_HTML_MARKERS = [
  ['wordpress', /\/wp-content\/|\/wp-includes\//i],
  ['shopify', /cdn\.shopify\.com/i],
  ['wix', /static\.wixstatic\.com/i],
  ['squarespace', /static1\.squarespace\.com|squarespace-cdn\.com/i],
  ['webflow', /data-wf-site|website-files\.com/i],
  ['bigcommerce', /cdn\d*\.bigcommerce\.com/i],
  ['lovable', /lovable\.(?:app|dev)|gpteng\.co/i],
];
const CMS_SITEMAP_MARKERS = [
  ['wordpress', /wp-sitemap|sitemap_index\.xml/i],
  ['shopify', /sitemap_(?:products|pages|collections)_\d+\.xml/i],
  ['wix', /(?:pages|blog-posts|store-products)-sitemap\.xml/i],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeDomain(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const { hostname } = new URL(withScheme);
    return hostname.includes('.') ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

const siteKey = (hostname) => hostname.toLowerCase().replace(/^www\./, '');

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function decodeBody(buffer, maxBytes) {
  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  return (isGzip ? gunzipSync(buffer, { maxOutputLength: maxBytes }) : buffer).toString('utf8');
}

// One fetcher per site, so the politeness delay applies per host.
export function createFetcher({ timeoutMs, userAgent, maxBytes, delayMs }) {
  let lastRequestAt = 0;
  return async function fetchText(url) {
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'application/xml,text/xml,text/plain,text/html;q=0.8,*/*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const declaredLength = Number(response.headers.get('content-length'));
      if (!response.ok || declaredLength > maxBytes) {
        await response.body?.cancel();
        return { ok: false, status: response.status, url, error: response.ok ? 'response too large' : undefined };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) return { ok: false, status: response.status, url, error: 'response too large' };
      return { ok: true, status: response.status, url: response.url || url, text: decodeBody(buffer, maxBytes) };
    } catch (error) {
      return { ok: false, status: 0, url, error: error.message };
    }
  };
}

export function parseRobotsSitemaps(text) {
  const urls = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (match) urls.push(match[1]);
  }
  return [...new Set(urls)];
}

function decodeXml(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name])
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

// Regex rather than a full XML parser: no entity expansion, so no XML-bomb risk.
// <image:loc> and other namespaced tags are deliberately not matched.
export function parseSitemap(xml) {
  const text = String(xml ?? '');
  const kind = /<sitemapindex[\s>]/i.test(text) ? 'index' : /<urlset[\s>]/i.test(text) ? 'urlset' : 'unknown';
  const locs = [...text.matchAll(LOC_PATTERN)].map((match) => decodeXml(match[1])).filter(Boolean);
  return { kind, locs };
}

// "/blog/post/" -> "/blog/"; single-segment pages such as "/about/" count as root "/".
export function folderOf(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  return segments.length > 1 ? `/${segments[0]}/` : '/';
}

export function detectCmsFromHtml(html) {
  const text = String(html ?? '');
  return CMS_HTML_MARKERS.find(([, pattern]) => pattern.test(text))?.[0] ?? '';
}

export function cmsHintFromSitemaps(sitemapUrls) {
  const joined = sitemapUrls.join(' ');
  return CMS_SITEMAP_MARKERS.find(([, pattern]) => pattern.test(joined))?.[0] ?? '';
}

async function findSeedSitemaps(base, robots, fetchText, cache) {
  const fromRobots = robots.ok ? parseRobotsSitemaps(robots.text) : [];
  if (fromRobots.length) return fromRobots;

  // Try fallbacks in order and stop at the first real sitemap, so /sitemap.xml and
  // /sitemap_index.xml (often the same file) are not counted twice.
  for (const path of FALLBACK_SITEMAP_PATHS) {
    const url = `${base}${path}`;
    const response = await fetchText(url);
    if (response.ok && parseSitemap(response.text).kind !== 'unknown') {
      cache.set(url, response);
      return [url];
    }
  }
  return [];
}

export async function scoutDomain(input, { fetchText, maxSitemaps, maxTrackedUrls, detectCms = true }) {
  const domain = normalizeDomain(input);
  const result = {
    input: String(input ?? '').trim(),
    domain,
    status: 'invalid_domain',
    urlCount: 0,
    sitemapCount: 0,
    offHostSkipped: 0,
    truncated: false,
    seedSitemaps: [],
    topFolders: [],
    cmsHint: '',
    errors: [],
  };
  if (!domain) return result;

  let base = `https://${domain}`;
  let robots = await fetchText(`${base}/robots.txt`);
  if (robots.status === 0) {
    const httpRobots = await fetchText(`http://${domain}/robots.txt`);
    if (httpRobots.status !== 0) {
      base = `http://${domain}`;
      robots = httpRobots;
    }
  }
  if (robots.status === 0) {
    result.status = 'unreachable';
    result.errors.push(`robots.txt: ${robots.error ?? 'network error'}`);
    return result;
  }

  const cache = new Map();
  const seeds = await findSeedSitemaps(base, robots, fetchText, cache);
  result.seedSitemaps = seeds;

  const key = siteKey(domain);
  const pages = new Set();
  const folders = new Map();
  const visited = new Set();
  const pending = [...seeds];

  while (pending.length && !result.truncated) {
    const sitemapUrl = pending.shift();
    if (visited.has(sitemapUrl)) continue;
    if (visited.size >= maxSitemaps) {
      result.truncated = true;
      result.errors.push(`stopped after ${maxSitemaps} sitemaps`);
      break;
    }
    visited.add(sitemapUrl);

    const response = cache.get(sitemapUrl) ?? (await fetchText(sitemapUrl));
    if (!response.ok) {
      result.errors.push(`${sitemapUrl}: ${response.error ?? `HTTP ${response.status}`}`);
      continue;
    }

    const { kind, locs } = parseSitemap(response.text);
    if (kind === 'index') {
      pending.push(...locs);
      continue;
    }
    if (kind !== 'urlset') {
      result.errors.push(`${sitemapUrl}: not a sitemap`);
      continue;
    }

    result.sitemapCount += 1;
    for (const loc of locs) {
      const parsed = safeUrl(loc);
      if (!parsed || siteKey(parsed.hostname) !== key) {
        result.offHostSkipped += 1;
        continue;
      }
      const pageUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
      if (pages.has(pageUrl)) continue;
      if (pages.size >= maxTrackedUrls) {
        result.truncated = true;
        result.errors.push(`stopped after ${maxTrackedUrls} URLs`);
        break;
      }
      pages.add(pageUrl);
      const folder = folderOf(parsed.pathname);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
  }

  result.urlCount = pages.size;
  result.status = visited.size === 0 ? 'no_sitemap' : pages.size === 0 ? 'empty' : 'ok';
  result.topFolders = [...folders.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_FOLDER_COUNT)
    .map(([folder, count]) => ({ folder, count }));

  if (detectCms) {
    const homepage = await fetchText(`${base}/`);
    result.cmsHint = (homepage.ok && detectCmsFromHtml(homepage.text)) || cmsHintFromSitemaps([...visited]);
  } else {
    result.cmsHint = cmsHintFromSitemaps([...visited]);
  }

  return result;
}
