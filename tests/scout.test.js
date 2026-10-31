import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  decodeBody,
  detectCmsFromHtml,
  folderOf,
  normalizeDomain,
  parseRobotsSitemaps,
  parseSitemap,
  scoutDomain,
} from '../src/scout.js';

const urlset = (...urls) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((url) => `<url><loc>${url}</loc></url>`)
    .join('')}</urlset>`;
const sitemapIndex = (...urls) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((url) => `<sitemap><loc>${url}</loc></sitemap>`)
    .join('')}</sitemapindex>`;

function fakeFetcher(routes) {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404, url };
    if (body instanceof Error) return { ok: false, status: 0, url, error: body.message };
    return { ok: true, status: 200, url, text: body };
  };
  return { fetchText, calls };
}

const LIMITS = { maxSitemaps: 200, maxTrackedUrls: 500000 };

test('normalizeDomain accepts sheet formats and rejects non-domains', () => {
  assert.equal(normalizeDomain('incrementors.com/'), 'incrementors.com');
  assert.equal(normalizeDomain('https://www.Example.com/path?x=1'), 'www.example.com');
  assert.equal(normalizeDomain('Blue_Line_Capital'), null);
  assert.equal(normalizeDomain('No website provided - internal project'), null);
  assert.equal(normalizeDomain(''), null);
});

test('parseRobotsSitemaps reads every Sitemap line, case-insensitively, without duplicates', () => {
  const robots = 'User-agent: *\nDisallow:\nSitemap: https://a.com/sitemap_index.xml\nsitemap:https://a.com/news.xml\nSitemap: https://a.com/news.xml\n';
  assert.deepEqual(parseRobotsSitemaps(robots), ['https://a.com/sitemap_index.xml', 'https://a.com/news.xml']);
});

test('parseSitemap decodes entities and CDATA and ignores image:loc', () => {
  const xml =
    '<urlset><url><loc>https://a.com/x?a=1&amp;b=2</loc><image:image><image:loc>https://a.com/i.jpg</image:loc></image:image></url>' +
    '<url><loc><![CDATA[https://a.com/y/]]></loc></url></urlset>';
  assert.deepEqual(parseSitemap(xml), { kind: 'urlset', locs: ['https://a.com/x?a=1&b=2', 'https://a.com/y/'] });
  assert.equal(parseSitemap(sitemapIndex('https://a.com/s1.xml')).kind, 'index');
  assert.equal(parseSitemap('<html>not a sitemap</html>').kind, 'unknown');
});

test('decodeBody handles gzipped and plain sitemaps', () => {
  assert.equal(decodeBody(gzipSync(Buffer.from('<urlset/>')), 1_000_000), '<urlset/>');
  assert.equal(decodeBody(Buffer.from('<urlset/>'), 1_000_000), '<urlset/>');
});

test('folderOf groups nested pages and treats single-segment pages as root', () => {
  assert.equal(folderOf('/blog/post-1/'), '/blog/');
  assert.equal(folderOf('/about/'), '/');
  assert.equal(folderOf('/'), '/');
});

test('scoutDomain follows a sitemap index, dedupes URLs and skips other hosts', async () => {
  const { fetchText } = fakeFetcher({
    'https://a.com/robots.txt': 'Sitemap: https://a.com/sitemap_index.xml',
    'https://a.com/sitemap_index.xml': sitemapIndex('https://a.com/page-sitemap.xml', 'https://a.com/post-sitemap.xml'),
    'https://a.com/page-sitemap.xml': urlset('https://a.com/', 'https://a.com/about/', 'https://www.a.com/contact/'),
    'https://a.com/post-sitemap.xml': urlset('https://a.com/blog/one/', 'https://a.com/blog/two/', 'https://a.com/about/', 'https://other.com/x/'),
    'https://a.com/': '<html><link href="/wp-content/themes/x/style.css"></html>',
  });

  const result = await scoutDomain('a.com', { fetchText, ...LIMITS });

  assert.equal(result.status, 'ok');
  assert.equal(result.urlCount, 5);
  assert.equal(result.sitemapCount, 2);
  assert.equal(result.offHostSkipped, 1);
  assert.equal(result.cmsHint, 'wordpress');
  assert.deepEqual(result.topFolders, [
    { folder: '/', count: 3 },
    { folder: '/blog/', count: 2 },
  ]);
});

test('scoutDomain falls back to /sitemap.xml once when robots.txt has no Sitemap line', async () => {
  const { fetchText, calls } = fakeFetcher({
    'https://b.com/robots.txt': 'User-agent: *\nDisallow:',
    'https://b.com/sitemap.xml': urlset('https://b.com/', 'https://b.com/services/seo/'),
  });

  const result = await scoutDomain('b.com', { fetchText, ...LIMITS, detectCms: false });

  assert.equal(result.status, 'ok');
  assert.equal(result.urlCount, 2);
  assert.deepEqual(result.seedSitemaps, ['https://b.com/sitemap.xml']);
  assert.equal(calls.filter((url) => url === 'https://b.com/sitemap.xml').length, 1);
  assert.equal(calls.includes('https://b.com/sitemap_index.xml'), false);
});

test('scoutDomain reports no_sitemap, unreachable and invalid_domain', async () => {
  const noSitemap = await scoutDomain('c.com', { fetchText: fakeFetcher({}).fetchText, ...LIMITS, detectCms: false });
  assert.equal(noSitemap.status, 'no_sitemap');

  const down = new Error('getaddrinfo ENOTFOUND');
  const unreachable = await scoutDomain('d.com', {
    fetchText: fakeFetcher({ 'https://d.com/robots.txt': down, 'http://d.com/robots.txt': down }).fetchText,
    ...LIMITS,
  });
  assert.equal(unreachable.status, 'unreachable');

  const invalid = await scoutDomain('PeachtreeCompany', { fetchText: fakeFetcher({}).fetchText, ...LIMITS });
  assert.equal(invalid.status, 'invalid_domain');
});

test('scoutDomain stops at maxSitemaps and flags the result as truncated', async () => {
  const { fetchText } = fakeFetcher({
    'https://e.com/robots.txt': 'Sitemap: https://e.com/index.xml',
    'https://e.com/index.xml': sitemapIndex('https://e.com/1.xml', 'https://e.com/2.xml', 'https://e.com/3.xml'),
    'https://e.com/1.xml': urlset('https://e.com/a/'),
    'https://e.com/2.xml': urlset('https://e.com/b/'),
    'https://e.com/3.xml': urlset('https://e.com/c/'),
  });

  const result = await scoutDomain('e.com', { fetchText, maxSitemaps: 2, maxTrackedUrls: 500000, detectCms: false });

  assert.equal(result.truncated, true);
  assert.equal(result.urlCount, 1);
});

test('detectCmsFromHtml recognises common platforms and returns empty when unsure', () => {
  assert.equal(detectCmsFromHtml('<script src="https://cdn.shopify.com/s/x.js"></script>'), 'shopify');
  assert.equal(detectCmsFromHtml('<img src="https://static.wixstatic.com/media/a.jpg">'), 'wix');
  assert.equal(detectCmsFromHtml('<html><body>plain</body></html>'), '');
});
