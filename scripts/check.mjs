#!/usr/bin/env node
/* One round of checks (every five minutes from GitHub Actions, outside
   our own servers, so the page tells the truth when we're down).

   Each service is asked twice before it's called down, ten seconds
   apart. A service that answers but takes more than five seconds is slow.
   The files always carry the latest check, and the page is published from
   every run; the history is committed only when something changed, or
   once an hour: about 24 commits a day, not 288.

     data/state.json    each service now: up, slow or down, since when
     data/outages.json  every slow or down stretch, start to end (100 days)

   No dependencies: Node 22's fetch. `node scripts/check.mjs` runs it
   locally too (it only reads public addresses). */

import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const TIMEOUT_MS = 15_000;
const SLOW_MS = 5_000;
const RETRY_MS = 10_000;
const HEARTBEAT_MS = 55 * 60_000;
const KEEP_DAYS = 100;

const read = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

async function once(c) {
  const started = Date.now();
  try {
    const res = await fetch(c.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "brokerandagent-status (+https://status.brokerandagent.com)", "cache-control": "no-cache" },
    });
    const ms = Date.now() - started;
    if (res.status !== (c.expect.status ?? 200)) return { ok: false, ms, why: `answered ${res.status}` };
    if (c.expect.json) {
      const body = await res.json().catch(() => null);
      for (const [k, v] of Object.entries(c.expect.json)) if (!body || body[k] !== v) return { ok: false, ms, why: `said ${k} was ${JSON.stringify(body?.[k])}` };
    } else {
      await res.arrayBuffer().catch(() => undefined);
    }
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, why: err?.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : "couldn't connect" };
  }
}

async function check(c) {
  let r = await once(c);
  if (!r.ok) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    r = await once(c);
  }
  return { status: !r.ok ? "down" : r.ms > SLOW_MS ? "slow" : "up", ms: r.ms, why: r.why };
}

const config = read("checks.json", null);
const state = read("data/state.json", { monitoringSince: null, checkedAt: null, writtenAt: null, components: {} });
const outages = read("data/outages.json", []);
const now = new Date();
const iso = now.toISOString();

const results = await Promise.all(config.components.map(async (c) => [c.id, await check(c)]));
let changed = false;
for (const [id, r] of results) {
  const before = state.components[id];
  if (!before || before.status !== r.status) {
    changed = true;
    /* a stretch that was slow or down ends; a new one starts */
    const open = outages.find((o) => o.component === id && !o.end);
    if (open) open.end = iso;
    if (r.status !== "up") outages.push({ component: id, kind: r.status, start: iso, end: null, why: r.why ?? "slow to answer" });
    /* when this service's history begins: its first check, kept for good */
    state.components[id] = { status: r.status, since: iso, ms: r.ms, monitoringSince: before?.monitoringSince ?? iso };
  } else {
    state.components[id] = { ...before, ms: r.ms };
  }
  console.log(`${id}: ${r.status} (${r.ms} ms${r.why ? `, ${r.why}` : ""})`);
}
/* services no longer checked leave the page */
for (const id of Object.keys(state.components)) if (!config.components.some((c) => c.id === id)) delete state.components[id];

/* The files always carry this check (the page published from this run
   says when it last checked); the history is committed only when
   something changed, or once an hour (the workflow reads `commit`). */
const due = !state.writtenAt || now.getTime() - Date.parse(state.writtenAt) >= HEARTBEAT_MS;
const commit = changed || due;
state.monitoringSince ??= iso;
state.checkedAt = iso;
if (commit) state.writtenAt = iso;
const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
write("data/state.json", state);
write("data/outages.json", outages.filter((o) => !o.end || Date.parse(o.end) >= cutoff));
console.log(changed ? "status changed: kept" : commit ? "hourly: kept" : "no change: published, not kept");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
