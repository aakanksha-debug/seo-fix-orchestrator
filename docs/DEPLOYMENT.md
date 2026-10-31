# Deployment

The code is plain Node.js with no dependencies, so it runs anywhere Node 20+ runs.

## Recommended path

1. **GitHub (private repository).** Source of truth for the code. CI runs the tests on every push (`.github/workflows/ci.yml`).
2. **Cloud runner: GitHub Actions** (`.github/workflows/scheduled.yml`). Read-only jobs, no server to maintain.

A small always-on VM may still be needed later for sessions that log in to client CMSs and need a stable IP for allow-listing.

## Scheduled workflow

| Job | Schedule | Input secret | Output artifact |
|---|---|---|---|
| `scout` | 1st of each month, 03:30 UTC (09:00 IST) | `SCOUT_DOMAINS_CSV` | `scout-<run>` (kept 30 days) |
| `queue` | Monday to Friday, 03:30 UTC (09:00 IST) | `CONTROL_CSV` | `queue-<run>` (kept 14 days) |

- **Inputs** are the full CSV text pasted into repository secrets (Settings > Secrets and variables > Actions). Column layouts match `examples/domains.example.csv` and `examples/control.example.csv`. A secret holds up to 48 KB, which is enough for several hundred sites.
- A job whose secret is not set is skipped with a notice, so the workflow is safe to leave enabled before the inputs exist.
- **Results** are downloaded from the run page (Actions > run > Artifacts). They are never committed.
- **Manual run:** Actions > "Scheduled scout and queue" > Run workflow. Choose `scout`, `queue` or `both`, and optionally a site limit for a small test.
- Scheduled runs use the private repository's Actions minutes. A full scout of about 200 sites takes roughly 10 to 30 minutes; the daily queue takes under a minute.

## Secrets

- Never commit credentials, client lists or scout output. `.gitignore` already blocks `data/`, `out/`, `logs/` and `.env`.
- On GitHub Actions, store secrets as encrypted repository or environment secrets.
- On a VM, use the provider's secret manager or a root-only `.env` file.
- Per-site WordPress Application Passwords are preferred over admin passwords when write sessions are added.

## Kill switch

- **GitHub Actions:** set the repository variable `SEO_KILL_SWITCH` to `1` (Settings > Secrets and variables > Actions > Variables) and every scheduled and manual job is skipped. Delete it or set it to `0` to resume.
- **Locally or on a VM:** set `SEO_KILL_SWITCH=1` in the environment, or create a `STOP` file in the working directory, and every queue run returns an empty queue.
