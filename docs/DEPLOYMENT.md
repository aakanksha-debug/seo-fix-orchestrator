# Deployment

The code is plain Node.js with no dependencies, so it runs anywhere Node 20+ runs.

## Recommended path

1. **GitHub (private repository).** Source of truth for the code. CI runs the tests on every push (`.github/workflows/ci.yml`).
2. **Cloud runner.** Two options, to be chosen:

| Option | Good for | Watch out for |
|---|---|---|
| GitHub Actions scheduled workflow | Read-only jobs such as `scout` and `queue`. No server to maintain | Inputs must come from a secure source (for example the Sheets API with a service account), never from files committed to the repo |
| Small always-on VM (any provider) with a cron job | Later sessions that log in to client CMSs and need a stable IP for allow-listing | You maintain OS updates, disk encryption and access control |

No scheduled workflow is included yet. It will be added once the runner is chosen, so nothing runs against client sites by accident.

## Secrets

- Never commit credentials, client lists or scout output. `.gitignore` already blocks `data/`, `out/`, `logs/` and `.env`.
- On GitHub Actions, store secrets as encrypted repository or environment secrets.
- On a VM, use the provider's secret manager or a root-only `.env` file.
- Per-site WordPress Application Passwords are preferred over admin passwords when write sessions are added.

## Kill switch

Set `SEO_KILL_SWITCH=1` in the runner environment, or create a `STOP` file in the working directory, and every queue run returns an empty queue.
