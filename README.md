# SEO Fix Orchestrator

Planning layer for fixing Ahrefs and Semrush on-page errors across the ShareIt and CRM portfolios, in three gated sessions, with crawl credits under control.

This first version is **read-only**. It fetches public `robots.txt`, sitemaps and homepages, and writes local CSV files. It does not log in anywhere and does not write to Ahrefs, Google Sheets, Project Central or any client website.

## What it does today

| Command | What it does |
|---|---|
| `scout` | Counts each site's URLs from its public sitemaps, hints the CMS, lists the biggest folders, and assigns a size tier, an Ahrefs crawl cap and a crawl frequency |
| `queue` | Applies the daily gate (status, escalation, approval mode, login, CMS, backup) and orders eligible sites by priority |

Rules for the three fix sessions and the approval matrix live in `src/sessions.js`. They are tested, but nothing executes fixes yet.

## Requirements

Node.js 20 or newer. There are no npm dependencies, so there is nothing to install.

## Usage

```bash
npm test
node src/cli.js scout --in data/domains.csv --out out/scout.csv --limit 5
node src/cli.js queue --in data/control.csv --out out/queue.csv
```

`examples/` has sample input files with placeholder domains. Put real client inputs in `data/`, which git ignores, so client data never reaches the repository.

### Scout input

| Column | Notes |
|---|---|
| `client_id` | Optional, copied to the output |
| `domain` or `website_url` | Any format from the Project tab, such as `example.com/` or `https://www.example.com` |

Rows that aren't domains (for example "No website provided") come back with status `invalid_domain`.

### Scout output statuses

| Status | Meaning |
|---|---|
| `ok` | Sitemap found and counted |
| `no_sitemap` | No sitemap in `robots.txt` or at the usual paths. Count manually or with a crawler |
| `empty` | Sitemap found but it lists no pages for this host |
| `unreachable` | The site didn't respond over HTTPS or HTTP |
| `invalid_domain` | The input isn't a domain |

`truncated = true` means a safety limit (`maxSitemaps` or `maxTrackedUrls`) stopped the count early. `needs_sessions = true` means the site needs more pages than one Ahrefs crawl allows, so plan folder-wise sessions. `cms_hint` is a hint only. Confirm the CMS before planning any fix.

### Queue input

`client_id, domain, status, open_escalation, approval_mode, has_login, cms, backup_possible, health_score, tier`

- `approval_mode` is `pm`, `client` or `developer`.
- Yes/no columns accept `yes`, `y`, `true` or `1`.
- `health_score` accepts a number or the Project tab format `Score 97/Error 215`.
- `tier` is the tier from the scout output.

The queue command writes `queue.csv` and `queue-skipped.csv`. Every skipped site lists all the reasons it was skipped.

## Configuration

`config/settings.json`:

| Key | Default | Meaning |
|---|---|---|
| `targetHealthScore` | 90 | Sites at or above this are not queued |
| `fastTrackBelow` | 70 | Eligible sites below this go to the front of the queue |
| `crawlCapMultiplier` | 1.2 | Crawl cap = URL count x this |
| `minCrawlCap` | 50 | Lowest cap ever suggested |
| `ahrefsCapLimit` | 5000 | Highest "Max number of internal pages" your Ahrefs project settings accept. Check this against your plan |
| `tiers` | S ≤300, M ≤2,000, L ≤10,000, XL above | Weights and frequencies are starting points to tune |

## Safety rules built in

- **Read-only.** GET requests to public URLs only, with a polite delay per host, a timeout, a size limit and a clear user agent.
- **Kill switch.** Set `SEO_KILL_SWITCH=1` or create a file named `STOP` in the working directory, and the queue comes back empty.
- **Fail closed.** Unknown risk class, unknown approval mode, risk C and developer handoff are never marked ready to fix.
- **HOLD can't be bypassed.** A low health score never lets a paused, unpaid or escalated site into the queue.
- **No client data or secrets in git.** `data/`, `out/`, `logs/`, `.env` and `STOP` are ignored.
- **Spreadsheet-safe output.** Cells that would run as a formula in Google Sheets are prefixed with an apostrophe.
- **No XML-bomb risk.** Sitemaps are parsed without entity expansion.

## Roadmap

1. URL Scout and control sheet (this version)
2. Tiers and Ahrefs bulk settings, applied by hand from the scout output
3. Approval statuses and access pre-check
4. Session 1 executor on one pilot site, then scale
5. Scheduler on the cloud runner (GitHub Actions: monthly scout, weekday queue)

See `docs/DEPLOYMENT.md` for where this runs, the input secrets and the kill switch.
