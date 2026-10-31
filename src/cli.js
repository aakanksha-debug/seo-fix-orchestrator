#!/usr/bin/env node
// Command-line entry point. Both commands are read-only: they fetch public pages
// and write local CSV files. Nothing is written to Ahrefs, Google Sheets or any website.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { parseCsv, toCsv } from './csv.js';
import { buildQueue } from './priority.js';
import { createFetcher, scoutDomain } from './scout.js';
import { assignTier } from './tiers.js';

const USAGE = `Usage:
  node src/cli.js scout --in <domains.csv> --out <scout.csv> [--limit N] [--concurrency N] [--no-cms] [--config <settings.json>]
  node src/cli.js queue --in <control.csv> --out <queue.csv> [--config <settings.json>]

scout  Counts each site's URLs from its public robots.txt and sitemaps, then assigns a size tier and crawl cap.
       Input columns: client_id, domain (or website_url).
queue  Applies the daily gate and builds the fix queue. Writes <queue>.csv and <queue>-skipped.csv.
       Input columns: client_id, domain, status, open_escalation, approval_mode, has_login, cms,
       backup_possible, health_score, tier.

Kill switch: set SEO_KILL_SWITCH=1 or create a file named STOP in the working directory.`;

const SCOUT_COLUMNS = [
  'client_id', 'input', 'domain', 'status', 'url_count', 'sitemap_count', 'off_host_skipped', 'truncated',
  'top_folders', 'cms_hint', 'tier', 'crawl_cap', 'needs_sessions', 'frequency', 'method', 'seed_sitemaps',
  'errors', 'scouted_at',
];
const QUEUE_COLUMNS = ['rank', 'client_id', 'domain', 'health_score', 'tier', 'priority', 'fast_track', 'approval_mode', 'cms'];
const SKIPPED_COLUMNS = ['client_id', 'domain', 'status', 'health_score', 'tier', 'reasons'];
const MAX_CONCURRENCY = 10;

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function writeOutput(path, contents) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function positiveInt(value, name, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`--${name} must be a positive whole number`);
  return number;
}

const killSwitchOn = () => process.env.SEO_KILL_SWITCH === '1' || existsSync(resolve('STOP'));

async function runScout(options, config) {
  const rows = parseCsv(readFileSync(options.in, 'utf8'));
  const targets = rows.slice(0, positiveInt(options.limit, 'limit', rows.length));
  const concurrency = Math.min(positiveInt(options.concurrency, 'concurrency', 3), MAX_CONCURRENCY);

  const results = await mapWithConcurrency(targets, concurrency, async (row) => {
    const scouted = await scoutDomain(row.domain || row.website_url || '', {
      fetchText: createFetcher(config.scout),
      maxSitemaps: config.scout.maxSitemaps,
      maxTrackedUrls: config.scout.maxTrackedUrls,
      detectCms: !options['no-cms'],
    });
    const tier = assignTier(scouted.status === 'ok' ? scouted.urlCount : NaN, config);
    process.stderr.write(`${scouted.domain ?? scouted.input}: ${scouted.status}, ${scouted.urlCount} URLs\n`);

    return {
      client_id: row.client_id ?? '',
      input: scouted.input,
      domain: scouted.domain ?? '',
      status: scouted.status,
      url_count: scouted.urlCount,
      sitemap_count: scouted.sitemapCount,
      off_host_skipped: scouted.offHostSkipped,
      truncated: scouted.truncated,
      top_folders: scouted.topFolders.map(({ folder, count }) => `${folder}:${count}`).join(' | '),
      cms_hint: scouted.cmsHint,
      tier: tier.tier,
      crawl_cap: tier.crawlCap ?? '',
      needs_sessions: tier.needsSessions,
      frequency: tier.frequency,
      method: tier.method,
      seed_sitemaps: scouted.seedSitemaps.join(' | '),
      errors: scouted.errors.join(' | '),
      scouted_at: new Date().toISOString(),
    };
  });

  writeOutput(options.out, toCsv(results, SCOUT_COLUMNS));
  console.log(`Scouted ${results.length} sites. Wrote ${options.out}`);
}

function runQueue(options, config) {
  const sites = parseCsv(readFileSync(options.in, 'utf8')).map((row) => ({
    clientId: row.client_id,
    domain: row.domain,
    status: row.status,
    openEscalation: row.open_escalation,
    approvalMode: row.approval_mode,
    hasLogin: row.has_login,
    cms: row.cms,
    backupPossible: row.backup_possible,
    healthScore: row.health_score,
    tier: row.tier,
  }));

  const { queue, skipped } = buildQueue(sites, config, { killSwitch: killSwitchOn() });
  const { dir, name } = parse(options.out);
  const skippedPath = join(dir, `${name}-skipped.csv`);

  writeOutput(
    options.out,
    toCsv(
      queue.map((site, i) => ({
        rank: i + 1,
        client_id: site.clientId,
        domain: site.domain,
        health_score: site.healthScore,
        tier: site.tier,
        priority: site.priority,
        fast_track: site.fastTrack,
        approval_mode: site.approvalMode,
        cms: site.cms,
      })),
      QUEUE_COLUMNS,
    ),
  );
  writeOutput(
    skippedPath,
    toCsv(
      skipped.map((site) => ({
        client_id: site.clientId,
        domain: site.domain,
        status: site.status,
        health_score: site.healthScore,
        tier: site.tier,
        reasons: site.reasons.join('; '),
      })),
      SKIPPED_COLUMNS,
    ),
  );
  console.log(`Queued ${queue.length} sites, skipped ${skipped.length}. Wrote ${options.out} and ${skippedPath}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
      config: { type: 'string' },
      'no-cms': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (!values.in || !values.out) throw new Error(`--in and --out are required.\n\n${USAGE}`);

  const config = loadConfig(values.config);
  if (command === 'scout') await runScout(values, config);
  else if (command === 'queue') runQueue(values, config);
  else throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
