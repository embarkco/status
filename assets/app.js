/* The page from the data the checks keep (scripts/check.mjs): what's
   wrong now, each service with a bar a day for 90 days and its uptime,
   and past incidents by day. Problems the checks find are told plainly
   ("Elevated errors on …", "We're looking into it"); notices written by
   hand go in data/notices.json (README). */

const DAY = 86_400_000;
const DAYS = 90;
const HISTORY_DAYS = 14;
const STATE_WORDS = { up: "Operational", slow: "Slower than usual", down: "Elevated errors", wait: "Not checked yet" };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) n.append(kid);
  return n;
};

const get = (path) =>
  fetch(`${path}?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const dayName = (ms) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const dateTime = (iso) => `${new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })}, ${time(iso)}`;
const length = (ms) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
};
const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/* ---------- incidents: the checks' and the hand-written ones, one shape ---------- */

/* "A", "A and B", "A, B and C" */
const listOf = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function incidentsFrom(config, outages, notices) {
  const names = Object.fromEntries(config.components.map((c) => [c.id, c.name]));
  /* stretches of the same kind that overlap are one event (a deploy that
     takes three services down for a few minutes is one incident, not three) */
  const groups = [];
  for (const o of [...outages].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const end = (x) => (x.end ? Date.parse(x.end) : Infinity);
    const g = groups.find((x) => x.kind === o.kind && Date.parse(o.start) <= Math.max(...x.items.map(end)));
    if (g) g.items.push(o);
    else groups.push({ kind: o.kind, items: [o] });
  }
  const found = groups.map(({ kind, items }) => {
    const who = listOf([...new Set(items.map((o) => names[o.component] ?? o.component))]);
    const start = items[0].start;
    const over = items.every((o) => o.end);
    const end = over ? items.map((o) => o.end).sort().at(-1) : null;
    const updates = [{ status: "Investigating", body: "We're looking into it.", at: start }];
    if (end) updates.unshift({ status: "Resolved", body: `Working normally again after ${length(Date.parse(end) - Date.parse(start))}.`, at: end });
    return { title: kind === "down" ? `Elevated errors on ${who}` : `${who} ${items.length > 1 ? "are" : "is"} slower than usual`, tone: kind, start, end, updates };
  });
  const written = notices.map((n) => {
    const updates = Array.isArray(n.updates) && n.updates.length ? [...n.updates].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [{ status: n.end ? "Resolved" : "Update", body: n.body ?? "", at: n.end ?? n.start }];
    const start = n.start ?? updates.at(-1).at;
    const end = n.end ?? (updates[0].status === "Resolved" ? updates[0].at : null);
    return { title: n.title, tone: "notice", start, end, updates };
  });
  return [...found, ...written].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

function updatesOf(incident) {
  return incident.updates.map((u) =>
    el("div", { class: "update" }, el("p", {}, el("strong", { text: u.status }), ` — ${u.body}`), el("p", { class: "when muted small", text: dateTime(u.at) })),
  );
}

/* ---------- a day of one service ---------- */

function dayOf(outages, id, dayStart, since) {
  const dayEnd = dayStart + DAY;
  if (!since || dayEnd <= Date.parse(since) || dayStart > Date.now()) return { tracked: 0, down: 0, slow: 0 };
  const from = Math.max(dayStart, Date.parse(since));
  const to = Math.min(dayEnd, Date.now());
  let down = 0;
  let slow = 0;
  for (const o of outages) {
    if (o.component !== id) continue;
    const a = Math.max(from, Date.parse(o.start));
    const b = Math.min(to, o.end ? Date.parse(o.end) : Date.now());
    if (b > a) o.kind === "down" ? (down += b - a) : (slow += b - a);
  }
  return { tracked: Math.max(0, to - from), down, slow };
}

const kindOf = (d) => (!d.tracked ? "none" : d.down ? "down" : d.slow ? "slow" : "up");

/* ---------- the hover card ---------- */

const tip = document.getElementById("tip");
let tipFor = null;

function showTip(bar) {
  const d = JSON.parse(bar.dataset.day);
  const lines = [];
  if (!d.tracked) lines.push(el("div", { class: "muted", text: "Not tracked yet." }));
  else if (!d.down && !d.slow) lines.push(el("div", { class: "muted", text: "No downtime recorded on this day." }));
  else {
    if (d.down) lines.push(el("div", { class: "tip-line" }, el("span", { class: "k k-down" }), el("span", { class: "grow", text: "Elevated errors" }), el("span", { class: "muted", text: length(d.down) })));
    if (d.slow) lines.push(el("div", { class: "tip-line" }, el("span", { class: "k k-slow" }), el("span", { class: "grow", text: "Slower than usual" }), el("span", { class: "muted", text: length(d.slow) })));
  }
  tip.replaceChildren(el("div", { class: "tip-date", text: dayName(d.start) }), ...lines);
  tip.hidden = false;
  tipFor?.classList.remove("is-on");
  tipFor = bar;
  bar.classList.add("is-on");
  const r = bar.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
  const top = r.top - h - 10 > 8 ? r.top - h - 10 : r.bottom + 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip() {
  tip.hidden = true;
  tipFor?.classList.remove("is-on");
  tipFor = null;
}

document.addEventListener("mouseover", (e) => {
  const bar = e.target.closest?.(".bar");
  if (bar) showTip(bar);
  else if (tipFor && !e.target.closest?.(".bars")) hideTip();
});
/* a tap shows it on a phone; a tap elsewhere puts it away */
document.addEventListener("click", (e) => {
  const bar = e.target.closest?.(".bar");
  if (bar && bar !== tipFor) showTip(bar);
  else hideTip();
});
window.addEventListener("scroll", hideTip, { passive: true });

/* ---------- the page ---------- */

function render(config, state, outages, notices) {
  const incidents = incidentsFrom(config, outages, notices);

  /* now: what's wrong, or that nothing is */
  const now = document.getElementById("now");
  const open = incidents.filter((i) => !i.end);
  now.replaceChildren(
    ...(open.length
      ? open.map((i) => el("section", { class: `card incident tone-${i.tone}` }, el("div", { class: "incident-head" }, el("span", { class: "pulse", "aria-hidden": "true" }), el("h1", { text: i.title })), el("div", { class: "incident-body" }, ...updatesOf(i))))
      : [el("section", { class: "card allgood" }, el("span", { class: `dot ${state.checkedAt ? "dot-up" : "dot-wait"}`, "aria-hidden": "true" }), el("h1", { text: state.checkedAt ? "Everything is looking good" : "Checking…" }))]),
  );

  /* each service, a bar a day, and its uptime */
  const today = startOfDay(Date.now());
  document.getElementById("services").replaceChildren(
    ...config.components.map((c) => {
      const status = state.components[c.id]?.status ?? "wait";
      const bars = el("div", { class: "bars" });
      /* the whole 90 days, and the last 60 a phone shows */
      const sum = { 90: { tracked: 0, down: 0 }, 60: { tracked: 0, down: 0 } };
      for (let i = DAYS - 1; i >= 0; i--) {
        const start = today - i * DAY;
        const d = dayOf(outages, c.id, start, state.components[c.id]?.monitoringSince ?? state.monitoringSince);
        for (const n of i < 60 ? [90, 60] : [90]) {
          sum[n].tracked += d.tracked;
          sum[n].down += d.down;
        }
        bars.append(el("span", { class: `bar bar-${kindOf(d)}`, "data-day": JSON.stringify({ start, ...d }) }));
      }
      const pctOf = ({ tracked, down }) => {
        if (!tracked) return "No data yet";
        const up = (1 - down / tracked) * 100;
        return `${up === 100 ? "100" : up.toFixed(2)}% uptime`;
      };
      const pct = pctOf(sum[90]);
      bars.setAttribute("role", "img");
      bars.setAttribute("aria-label", `${c.name}: ${pct} over the past ${DAYS} days`);
      return el(
        "li",
        { class: "service" },
        el("div", { class: "service-row" }, el("span", { class: "service-name", text: c.name }), el("span", { class: `state state-${status}`, text: STATE_WORDS[status] })),
        bars,
        el(
          "div",
          { class: "span", "aria-hidden": "true" },
          el("span", { class: "from" }, el("span", { class: "d90", text: "90 days ago" }), el("span", { class: "d60", text: "60 days ago" })),
          el("span", { class: "rule" }),
          el("span", { class: "pct" }, el("span", { class: "d90", text: pct }), el("span", { class: "d60", text: pctOf(sum[60]) })),
          el("span", { class: "rule" }),
          el("span", { text: "Today" }),
        ),
      );
    }),
  );

  /* past incidents: the last two weeks, a heading a day, from the day
     monitoring began (a day before it isn't "no incidents", it's unknown) */
  const began = Math.min(...[state.monitoringSince, ...Object.values(state.components).map((c) => c.monitoringSince)].filter(Boolean).map((t) => startOfDay(Date.parse(t))));
  const days = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const start = today - i * DAY;
    if (Number.isFinite(began) && start < began) break;
    const those = incidents.filter((x) => startOfDay(Date.parse(x.start)) === start);
    days.push(
      el(
        "article",
        { class: "day" },
        el("h3", { text: dayName(start) }),
        ...(those.length
          ? those.map((x) => el("div", { class: `past tone-${x.tone}` }, el("h4", { text: x.title }), ...updatesOf(x)))
          : [el("p", { class: "quiet", text: "No incidents reported." })]),
      ),
    );
  }
  if (Number.isFinite(began) && today - (HISTORY_DAYS - 1) * DAY < began) days.push(el("p", { class: "began muted small", text: `Monitoring began ${dayName(began)}.` }));
  document.getElementById("history").replaceChildren(...days);
}

async function load() {
  const [config, state, outages, notices] = await Promise.all([get("checks.json"), get("data/state.json"), get("data/outages.json"), get("data/notices.json")]);
  if (!config || !state) return;
  render(config, state, outages ?? [], notices ?? []);
}

load();
/* a page left open keeps itself current */
setInterval(load, 60_000);
