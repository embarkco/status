# Broker&Agent status

The public status page for Broker&Agent: [status.brokerandagent.com](https://status.brokerandagent.com).

Every five minutes a GitHub Actions run (`.github/workflows/check.yml`) asks
each service in `checks.json` whether it's working, from GitHub's servers,
so the page tells the truth even when ours are down. A service that doesn't
answer twice, ten seconds apart, is **down**; one that answers in more than
five seconds is **slow**. The page is plain HTML on GitHub Pages and reads
the data files beside it.

| File | What |
|---|---|
| `checks.json` | The services, the public address asked for each, and what a working answer looks like |
| `scripts/check.mjs` | One round of checks (Node 22, no dependencies; `node scripts/check.mjs` runs it anywhere) |
| `data/state.json` | Each service now, and since when |
| `data/outages.json` | Every slow or down stretch, start to end (kept 100 days) |
| `data/notices.json` | Notices written by hand (below) |

**History before Oct 11 2026.** The page went public on Oct 11 2026. For the
Workspace, the site dashboard, sign-in and website chat, the days from Oct 8
2026 (16:06 UTC) come from HQ's own checks of the same addresses (HQ →
Health, every five minutes, from Cloudflare rather than GitHub), including
the one outage they saw: 5 to 15 minutes without an answer during the Oct 8
launch deploy. The Claude connector and brokerandagent.com start on Oct 11.
Nothing before Oct 8 is shown as up: those days say "Not tracked yet".
| `index.html`, `assets/` | The page: HQ's look, light or dark as the device is set |

Data is committed only when something changes, plus once an hour, about 24
commits a day.

## What the page says

- All fine: "Everything is looking good".
- A service down: "Elevated errors on <service>", "Investigating — We're
  looking into it", and "Resolved" with its time once the checks see it
  working again. Slow: "<service> is slower than usual".
- Each service shows 90 day-bars (60 on a phone) and its uptime; hovering
  a day (tapping, on a phone) says what happened that day.
- Past incidents: the last 14 days, by date.

## A notice

For something the checks can't see (a slow feature, planned maintenance),
add one to `data/notices.json` and commit. Newest update first or last,
either way; one whose newest update is "Resolved" is over:

```json
[
  {
    "title": "Publishing from the site editor is slow",
    "updates": [
      { "status": "Investigating", "body": "We're looking into slow publishes. Your website itself is fine.", "at": "2026-10-10T20:30:00Z" },
      { "status": "Resolved", "body": "Publishing is back to normal.", "at": "2026-10-10T21:10:00Z" }
    ]
  }
]
```

## A service

Add it to `checks.json` with a public address that only answers well when
the service works (the workspace's `/api/public/health` also checks its
database). Nothing private goes here: this repository is public.

## Setup (once)

1. Settings → Pages: deploy from the `main` branch, root folder; custom
   domain `status.brokerandagent.com` (the `CNAME` file), HTTPS on.
2. DNS: `status` CNAME to `embarkco.github.io` (Cloudflare, DNS only).
3. Actions → Check → Run workflow, once, to start.
