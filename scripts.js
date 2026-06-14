/**
 * Netflix Watchtime — v2 (near-exact)
 *
 * Netflix removed the old REST feed (/shakti/<build>/viewingactivity) AND dropped the
 * per-entry watched-seconds it used to expose, which is why v1 broke. This version
 * reconstructs your real watch time from Netflix's current internal APIs:
 *
 *   1. Paginate the full history via the AUI Falcor endpoint
 *      (/api/aui/pathEvaluator … callPath ["aui","viewingActivity",page,_]) — gives
 *      each entry's video id, exact timestamp and series id.
 *   2. Look up runtime + bookmarkPosition per video via the member Falcor endpoint
 *      (/nq/website/memberapi/release/pathEvaluator … ["videos",[ids],["runtime",
 *      "bookmarkPosition"]]) in batches.
 *   3. watched = bookmarkPosition (where you actually stopped), counted as the full
 *      runtime once you're past 90 % (i.e. you finished it). Abandoned titles only
 *      count what you actually watched.
 *
 * Everything runs in the Netflix tab's MAIN world (so cookies, CSRF token and CORS are
 * the page's own) and is analysed locally. Nothing is sent anywhere.
 */

const FINISHED_RATIO = 0.9; // watched >= 90% of runtime => counts as fully watched
const HISTORY_CONCURRENCY = 12; // parallel history-page fetches (feed is 20 items/page)
const META_CONCURRENCY = 6; // parallel runtime/bookmark batch fetches
const META_CHUNK = 200; // video ids per runtime/bookmark request

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const $ = (id) => document.getElementById(id);

let ITEMS = []; // [{ id, date:Date, title, isSeries, show, watched(sec) }]
let PROFILE = null;

/* ---------------------------------------------------------------- UI helpers */

function setLog(text) {
    const el = $("logs");
    if (el) el.textContent = text;
}
function setProgress(frac) {
    const bar = $("progress-bar");
    if (bar) bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
}
function show(which) {
    for (const id of ["loader", "error", "content"]) {
        $(id).style.display = id === which ? "" : "none";
    }
}
function showError(titleKey, msgKey) {
    $("error-title").textContent = t(titleKey);
    $("error-msg").textContent = t(msgKey);
    show("error");
}

/* ------------------------------------------------- in-page pipeline (MAIN world) */

// Self-contained: runs in the Netflix page context. Reports progress on document.title
// as "NWT::phase::done::total" so the dashboard can poll it. Returns the raw dataset.
async function runPipeline(cfg) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const report = (phase, done, total) => {
        try { document.title = "NWT::" + phase + "::" + done + "::" + total; } catch (e) {}
    };

    let m = null;
    for (let i = 0; i < 40; i++) {
        try { m = window.netflix.reactContext.models; } catch (e) { m = null; }
        if (m && m.userInfo && m.userInfo.data && m.userInfo.data.authURL) break;
        m = null;
        await sleep(250);
    }
    if (!m) return { error: "NOT_LOGGED_IN" };

    const authURL = m.userInfo.data.authURL;
    const build = m.serverDefs.data.BUILD_IDENTIFIER;
    const guid = m.userInfo.data.guid;
    let esn = "";
    try { esn = m.esnAccessor.data.esn || ""; } catch (e) {}

    const auiHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-netflix.uiversion": build,
        "x-netflix.clienttype": "akira",
        "x-netflix.nq.stack": "prod",
        "x-netflix.esnprefix": "NFCDCH-LX-",
        "x-netflix.client.request.name": "ui/xhrUnclassified",
        "x-netflix.request.routing": JSON.stringify({
            path: "/nq/aui/endpoint/^1.0.0-web/pathEvaluator",
            control_tag: "auinqweb",
        }),
    };
    const metaHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-netflix.uiversion": build,
        "x-netflix.client.request.name": "ui/falcorUnclassified",
        "x-netflix.request.client.user.guid": guid,
        "x-netflix.clienttype": "akira",
        "x-netflix.nq.stack": "prod",
    };
    if (esn) metaHeaders["x-netflix.esn"] = esn;

    async function vaPage(pg) {
        const url =
            "https://www.netflix.com/api/aui/pathEvaluator/web/^2.0.0?method=call&callPath=" +
            encodeURIComponent(JSON.stringify(["aui", "viewingActivity", pg, 50])) +
            "&falcor_server=0.1.0";
        const r = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: auiHeaders,
            body: "param=" + encodeURIComponent(JSON.stringify({ guid })),
        });
        if (!r.ok) throw new Error("history HTTP " + r.status);
        const j = await r.json();
        const v = j.jsonGraph && j.jsonGraph.aui && j.jsonGraph.aui.viewingActivity && j.jsonGraph.aui.viewingActivity.value;
        if (!v) throw new Error("history shape");
        return v;
    }

    async function metaChunk(ids) {
        const url =
            "https://www.netflix.com/nq/website/memberapi/release/pathEvaluator" +
            "?webp=true&falcor_server=0.1.0&withSize=true&materialize=true&original_path=%2Fshakti%2F" +
            build + "%2FpathEvaluator";
        const body =
            "authURL=" + encodeURIComponent(authURL) +
            "&path=" + encodeURIComponent(JSON.stringify(["videos", ids, ["runtime", "bookmarkPosition"]]));
        const r = await fetch(url, { method: "POST", credentials: "include", headers: metaHeaders, body });
        if (!r.ok) throw new Error("meta HTTP " + r.status);
        const j = await r.json();
        return (j.jsonGraph && j.jsonGraph.videos) || {};
    }

    // small helpers: retry transient failures, run tasks with bounded concurrency
    async function withRetry(fn, tries = 3) {
        for (let a = 0; a < tries; a++) {
            try { return await fn(); }
            catch (e) { if (a === tries - 1) throw e; await sleep(300 * (a + 1)); }
        }
    }
    async function runPool(list, concurrency, fn) {
        let i = 0;
        const n = Math.max(1, Math.min(concurrency, list.length || 1));
        await Promise.all(Array.from({ length: n }, async () => {
            while (true) {
                const idx = i++;
                if (idx >= list.length) break;
                await fn(list[idx]);
            }
        }));
    }

    // --- 1. paginate full history (page 0 first to learn the total, then in parallel) ---
    const all = [];
    let vhSize = null;
    let profileName = null;
    let v0;
    try { v0 = await withRetry(() => vaPage(0)); }
    catch (e) { return { error: "API_ERROR", detail: String(e) }; }
    if (typeof v0.vhSize === "number") vhSize = v0.vhSize;
    if (v0.profileInfo) profileName = v0.profileInfo.profileName || null;
    const page0 = v0.viewedItems || [];
    all.push(...page0);
    report("history", all.length, vhSize || all.length);

    const pageLen = page0.length || 20;
    if (vhSize != null && all.length < vhSize) {
        const totalPages = Math.ceil(vhSize / pageLen);
        const pages = [];
        for (let pg = 1; pg < totalPages; pg++) pages.push(pg);
        await runPool(pages, cfg.concurrency, async (pg) => {
            let v = null;
            try { v = await withRetry(() => vaPage(pg)); } catch (e) {}
            if (v && v.viewedItems && v.viewedItems.length) all.push(...v.viewedItems);
            report("history", all.length, vhSize);
        });
    }
    if (!all.length) return { error: "EMPTY" };

    // --- 2. runtime + bookmark per unique video (batched, in parallel) ---
    const ids = [...new Set(all.map((x) => x.movieID))];
    const meta = {};
    const chunks = [];
    for (let i = 0; i < ids.length; i += cfg.metaChunk) chunks.push(ids.slice(i, i + cfg.metaChunk));
    let metaDone = 0;
    await runPool(chunks, cfg.metaConcurrency, async (chunk) => {
        let v = {};
        try { v = await withRetry(() => metaChunk(chunk)); } catch (e) {}
        for (const id of chunk) {
            const node = v[id];
            if (!node) continue;
            meta[id] = {
                runtime: node.runtime && typeof node.runtime.value === "number" ? node.runtime.value : null,
                bookmark: node.bookmarkPosition && typeof node.bookmarkPosition.value === "number" ? node.bookmarkPosition.value : null,
            };
        }
        metaDone += chunk.length;
        report("meta", Math.min(metaDone, ids.length), ids.length);
    });

    // --- 3. assemble ---
    const items = all.map((x) => {
        const mv = meta[x.movieID] || {};
        return {
            id: x.movieID,
            date: x.date, // epoch ms
            title: x.title,
            series: x.series != null ? x.series : null,
            seriesTitle: x.seriesTitle || null,
            rt: mv.runtime,
            bm: mv.bookmark,
        };
    });
    report("done", items.length, items.length);
    return { items, profileName, vhSize };
}

/* ------------------------------------------------------- orchestration (dashboard) */

let POLL = null;
function startProgressPoll(tabId) {
    const phases = { history: "fetchingHistory", meta: "fetchingRuntimes" };
    POLL = setInterval(async () => {
        try {
            const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => document.title,
            });
            const title = r && r[0] && r[0].result;
            if (typeof title === "string" && title.startsWith("NWT::")) {
                const [, phase, done, total] = title.split("::");
                if (phases[phase]) setLog(t(phases[phase], [done, total]));
                const base = phase === "meta" ? 0.7 : 0;
                const span = phase === "meta" ? 0.3 : 0.7;
                const frac = total > 0 ? +done / +total : 0;
                setProgress(base + span * frac);
            }
        } catch (e) {}
    }, 600);
}
function stopProgressPoll() {
    if (POLL) clearInterval(POLL);
    POLL = null;
}

async function fetchHistory() {
    show("loader");
    setProgress(0);
    setLog(t("openingNetflix"));

    let tab;
    try {
        tab = await chrome.tabs.create({ url: "https://www.netflix.com/viewingactivity", active: false });
    } catch (e) {
        return showError("errorTitle", "errorGeneric");
    }

    try {
        await waitForTabComplete(tab.id);
        setLog(t("startingAnalysis"));
        startProgressPoll(tab.id);

        const injection = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: runPipeline,
            args: [{ concurrency: HISTORY_CONCURRENCY, metaConcurrency: META_CONCURRENCY, metaChunk: META_CHUNK }],
        });
        stopProgressPoll();
        const result = injection && injection[0] && injection[0].result;

        if (!result) return showError("errorTitle", "errorGeneric");
        if (result.error === "NOT_LOGGED_IN") return showError("notLoggedInTitle", "notLoggedInMsg");
        if (result.error === "EMPTY") return showError("emptyTitle", "emptyMsg");
        if (result.error) return showError("apiChangedTitle", "apiChangedMsg");

        PROFILE = result.profileName;
        ITEMS = buildItems(result.items);
        if (!ITEMS.length) return showError("emptyTitle", "emptyMsg");
        render();
    } catch (e) {
        showError("errorTitle", "errorGeneric");
    } finally {
        stopProgressPoll();
        try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        let done = false;
        const listener = (id, info) => {
            if (id === tabId && info.status === "complete") finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        const finish = (ok) => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            ok ? resolve() : reject(new Error("tab load timeout"));
        };
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab && tab.status === "complete") finish(true);
        });
    });
}

/* ------------------------------------------------------------- data assembly */

// Per item, real watched seconds: bookmark position, credited as full runtime once
// you're past FINISHED_RATIO (you finished it). Falls back gracefully if a runtime or
// bookmark is missing (rare — removed titles).
function watchedSeconds(rt, bm) {
    if (rt == null && bm == null) return null;
    if (rt == null) return bm; // unknown runtime, use position
    if (bm == null || bm <= 0) return rt; // no live bookmark => treat as finished
    if (bm >= FINISHED_RATIO * rt) return rt; // finished (past the credits threshold)
    return Math.min(bm, rt); // in-progress / abandoned => what you actually watched
}

function buildItems(raw) {
    const out = [];
    for (const x of raw) {
        const date = new Date(x.date);
        if (isNaN(date)) continue;
        const isSeries = x.series != null;
        out.push({
            id: x.id,
            date,
            title: x.title,
            isSeries,
            show: isSeries ? (x.seriesTitle || (x.title || "").split(/:\s/)[0]) : null,
            watched: watchedSeconds(x.rt, x.bm) || 0,
        });
    }
    return out;
}

/* ----------------------------------------------------------------- analytics */

function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function analyse() {
    const now = new Date();
    const today = startOfDay(now);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - ((today.getDay() + 6) % 7));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const a = {
        total: ITEMS.length,
        movies: 0,
        episodes: 0,
        watched: 0,
        period: { week: 0, month: 0, year: 0, older: 0 }, // by watched seconds
        byMonth: new Map(),
        byDow: new Array(7).fill(0),
        byHour: new Array(24).fill(0),
        byDay: new Map(),
        shows: new Map(), // show -> { secs, eps }
        first: null,
        last: null,
    };

    for (const it of ITEMS) {
        const w = it.watched;
        a.watched += w;
        if (it.isSeries) a.episodes++; else a.movies++;
        if (it.show) {
            const s = a.shows.get(it.show) || { secs: 0, eps: 0 };
            s.secs += w; s.eps++;
            a.shows.set(it.show, s);
        }
        if (it.date >= weekStart) a.period.week += w;
        if (it.date >= monthStart) a.period.month += w;
        if (it.date >= yearStart) a.period.year += w; else a.period.older += w;

        const ym = it.date.getFullYear() + "-" + String(it.date.getMonth() + 1).padStart(2, "0");
        a.byMonth.set(ym, (a.byMonth.get(ym) || 0) + w);
        a.byDow[it.date.getDay()] += w;
        a.byHour[it.date.getHours()] += w;
        const dk = it.date.getFullYear() + "-" + (it.date.getMonth() + 1) + "-" + it.date.getDate();
        a.byDay.set(dk, (a.byDay.get(dk) || 0) + w);

        if (!a.first || it.date < a.first) a.first = it.date;
        if (!a.last || it.date > a.last) a.last = it.date;
    }

    a.daysActive = a.byDay.size;
    a.topShows = [...a.shows.entries()].sort((x, y) => y[1].secs - x[1].secs).slice(0, 8);
    a.seriesCount = a.shows.size;
    let busiest = null;
    for (const [k, v] of a.byDay) if (!busiest || v > busiest[1]) busiest = [k, v];
    a.busiest = busiest;
    return a;
}

/* ----------------------------------------------------------------- rendering */

function fmtDuration(seconds) {
    const totalMin = Math.round(seconds / 60);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    const parts = [];
    if (days) parts.push(days + " " + (days === 1 ? t("day") : t("days")));
    if (hours) parts.push(hours + " " + (hours === 1 ? t("hour") : t("hours")));
    if (mins && !days) parts.push(mins + " " + (mins === 1 ? t("minute") : t("minutes")));
    return parts.join(" ") || "0 " + t("minutes");
}
function fmtHours(seconds) {
    return Math.round(seconds / 3600).toLocaleString();
}
function fmtDate(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function card(value, label) {
    return `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

let CHARTS = [];
function makeChart(id, cfg) {
    CHARTS.push(new Chart($(id).getContext("2d"), cfg));
}

const RED = "#e50914";
const GREY = "rgba(255,255,255,0.12)";
Chart.defaults.color = "rgba(255,255,255,0.72)";
Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
Chart.defaults.font.size = 13;

const hoursTip = (label) => ({
    callbacks: { label: (i) => fmtDuration((i.raw || 0)) + (label ? " · " + label : "") },
});

function donut(id, titleKey, labels, data, colors) {
    makeChart(id, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#141414", borderWidth: 2 }] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: "55%",
            plugins: {
                legend: { position: "bottom", labels: { padding: 14 } },
                title: { display: true, text: t(titleKey), font: { size: 16, weight: "600" }, padding: { bottom: 12 } },
                tooltip: hoursTip(),
            },
        },
    });
}
function bars(id, titleKey, labels, data, color, asTime) {
    makeChart(id, {
        type: "bar",
        data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 38 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: t(titleKey), font: { size: 16, weight: "600" }, padding: { bottom: 12 } },
                tooltip: asTime ? hoursTip() : undefined,
            },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
                y: {
                    grid: { color: GREY }, beginAtZero: true,
                    ticks: asTime ? { callback: (v) => Math.round(v / 3600) + "h" } : { precision: 0 },
                },
            },
        },
    });
}

function render() {
    show("content");
    if (PROFILE) { $("profile-name").textContent = PROFILE; $("profile-name").style.display = ""; }
    else $("profile-name").style.display = "none";

    document.querySelectorAll(".text").forEach((el) => {
        const k = el.getAttribute("data-text-key");
        if (k) el.textContent = t(k);
    });

    const a = analyse();

    $("total-stat").textContent = fmtDuration(a.watched);
    $("hero-sub").textContent = t("heroSub", [String(a.total), a.first ? fmtDate(a.first) : "—"]);

    $("cards").innerHTML =
        card(fmtHours(a.watched), t("hoursWatched")) +
        card(a.total.toLocaleString(), t("titlesWatched")) +
        card(a.movies.toLocaleString(), t("movies")) +
        card(a.episodes.toLocaleString(), t("episodes")) +
        card(a.seriesCount.toLocaleString(), t("uniqueSeries")) +
        card(a.daysActive.toLocaleString(), t("daysActive"));

    // share
    const shareText = t("shareMessage", fmtDuration(a.watched));
    $("twitter-share-btn").href =
        "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) +
        "&url=" + encodeURIComponent("https://github.com/ghrlt/netflix-watchtime");

    donut("contentproportion", "contentProportion",
        [t("movies"), t("episodes")], [a.movies, a.episodes], [RED, "#b81d24"]);

    const pWeek = a.period.week;
    const pMonth = Math.max(0, a.period.month - a.period.week);
    const pYear = Math.max(0, a.period.year - a.period.month);
    donut("periodproportion", "periodProportion",
        [t("thisWeek"), t("thisMonth"), t("thisYear"), t("older")],
        [pWeek, pMonth, pYear, a.period.older],
        ["#e50914", "#f5b500", "#3ba55d", "rgba(255,255,255,0.30)"]);

    const months = [...a.byMonth.keys()].sort().slice(-24);
    const monthLabels = months.map((ym) => {
        const [y, mo] = ym.split("-");
        return new Date(+y, +mo - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    });
    bars("timeline", "activityTimeline", monthLabels, months.map((m) => a.byMonth.get(m)), RED, true);

    const hourLabels = [...Array(24).keys()].map((h) => String(h).padStart(2, "0"));
    bars("hourofday", "byHourOfDay", hourLabels, a.byHour, "#f5b500", true);

    const dowOrder = [1, 2, 3, 4, 5, 6, 0];
    const dowLabels = dowOrder.map((d) =>
        new Date(2024, 0, 1 + ((d + 6) % 7)).toLocaleDateString(undefined, { weekday: "short" }));
    bars("dayofweek", "byDayOfWeek", dowLabels, dowOrder.map((d) => a.byDow[d]), "#b81d24", true);

    $("top-series").innerHTML = a.topShows.length
        ? a.topShows
              .map(([name, s]) =>
                  `<li><span class="ts-name">${escapeHtml(name)}</span><span class="ts-count">${fmtDuration(s.secs)}</span></li>`)
              .join("")
        : `<li class="muted">${t("noSeries")}</li>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* --------------------------------------------------------------------- boot */

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".text").forEach((el) => {
        const k = el.getAttribute("data-text-key");
        if (k) el.textContent = t(k);
    });
    $("retry-btn").addEventListener("click", fetchHistory);
    fetchHistory();
});
