/**
 * Netflix Watchtime — v2
 *
 * Netflix removed the old REST endpoint (/shakti/<build>/viewingactivity) and no
 * longer exposes a per-item watched-seconds value. The watch history is now served
 * by the GraphQL API (web.prod.cloud.netflix.com/graphql) and the only complete,
 * official export is the "viewingHistoryCSV" query, which returns Title + Date.
 *
 * Strategy: open the Netflix viewing-activity page in a background tab, run the same
 * GraphQL query the page itself uses (so cookies/CORS just work), close the tab, then
 * compute analytics locally. Watch time is *estimated* from a per-title average,
 * since Netflix no longer provides real durations.
 */

// Persisted GraphQL query used by Netflix's own "Download all" button.
// If Netflix bumps these, the extension surfaces a clear "API changed" error.
const GQL_ENDPOINT = "https://web.prod.cloud.netflix.com/graphql";
const GQL_OP = "viewingHistoryCSV";
const GQL_ID = "c6a61b41-db7d-4e62-8daf-bf95567649d4";
const GQL_VER = 102;

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const $ = (id) => document.getElementById(id);

let ITEMS = []; // [{ date: Date, title, isSeries, show }]
let PROFILE = null;

/* ---------------------------------------------------------------- UI helpers */

function setLog(text) {
    const el = $("logs");
    if (el) el.textContent = text;
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

/* --------------------------------------------------------- data acquisition */

// Runs in the MAIN world of the Netflix tab (has access to window.netflix + cookies).
async function grabFromPage(endpoint, op, id, ver) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let model = null;
    for (let i = 0; i < 40; i++) {
        try {
            model = window.netflix.reactContext.models.vaModel.data;
        } catch (e) {
            model = null;
        }
        if (model && model.profileInfo) break;
        model = null;
        await sleep(250);
    }
    if (!model) return { error: "NOT_LOGGED_IN" };

    const guid = model.profileInfo.guid;
    const profileName = model.profileInfo.profileName || null;

    const body = {
        operationName: op,
        variables: { options: { profileGuid: guid } },
        extensions: { persistedQuery: { id, version: ver } },
    };

    try {
        const r = await fetch(endpoint, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) return { error: "API_CHANGED", detail: "HTTP " + r.status };
        const j = await r.json();
        const csv = j && j.data && j.data.viewingHistoryCSV;
        if (csv == null) return { error: "API_CHANGED", detail: "no data field" };
        return { csv, profileName };
    } catch (e) {
        return { error: "API_CHANGED", detail: String(e) };
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
        // In case it already completed before we attached.
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab && tab.status === "complete") finish(true);
        });
    });
}

async function fetchHistory() {
    show("loader");
    setLog(t("openingNetflix"));

    let tab;
    try {
        tab = await chrome.tabs.create({
            url: "https://www.netflix.com/viewingactivity",
            active: false,
        });
    } catch (e) {
        showError("errorTitle", "errorGeneric");
        return;
    }

    try {
        await waitForTabComplete(tab.id);
        setLog(t("readingHistory"));

        const injection = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: grabFromPage,
            args: [GQL_ENDPOINT, GQL_OP, GQL_ID, GQL_VER],
        });
        const result = injection && injection[0] && injection[0].result;

        if (!result) return showError("errorTitle", "errorGeneric");
        if (result.error === "NOT_LOGGED_IN") return showError("notLoggedInTitle", "notLoggedInMsg");
        if (result.error) return showError("apiChangedTitle", "apiChangedMsg");

        PROFILE = result.profileName;
        ITEMS = parseHistory(result.csv);
        if (!ITEMS.length) return showError("emptyTitle", "emptyMsg");

        render();
    } catch (e) {
        showError("errorTitle", "errorGeneric");
    } finally {
        try {
            await chrome.tabs.remove(tab.id);
        } catch (e) {
            /* ignore */
        }
    }
}

/* -------------------------------------------------------------- CSV parsing */

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field);
            field = "";
            if (row.length > 1 || row[0] !== "") rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }
    if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// Netflix CSV date is locale-specific (e.g. "6/14/26" or "14/06/2026").
function parseNflxDate(s) {
    const m = s.trim().match(/^(\d{1,4})\D(\d{1,2})\D(\d{1,4})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2], c = +m[3];
    let day, month, year;
    if (a > 31) {
        year = a; month = b; day = c; // YYYY-MM-DD
    } else if (a > 12) {
        day = a; month = b; year = c; // DD/MM/YY
    } else {
        month = a; day = b; year = c; // MM/DD/YY (Netflix en-US default)
    }
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    return isNaN(d) ? null : d;
}

const SERIES_KW = /\b(season|saison|temporada|staffel|stagione|episode|épisode|episódio|episodio|folge|chapter|chapitre|cap[íi]tulo|kapitel|part|partie|parte|teil|volume|vol\.|limited series|miniseries|mini-series|s[ée]rie limit[ée]e)\b/i;

function classify(title) {
    const segs = title.split(/:\s/);
    const isSeries = SERIES_KW.test(title) || segs.length >= 3;
    const show = isSeries ? segs[0].trim() : null;
    return { isSeries, show };
}

function parseHistory(csv) {
    const rows = parseCSV(csv);
    const items = [];
    for (const r of rows) {
        if (r.length < 2) continue;
        const title = r[0];
        if (!title || title.toLowerCase() === "title") continue; // header
        const date = parseNflxDate(r[1]);
        if (!date) continue;
        const { isSeries, show } = classify(title);
        items.push({ title, date, isSeries, show });
    }
    return items;
}

/* ----------------------------------------------------------------- analytics */

function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function analyse() {
    const now = new Date();
    const today = startOfDay(now);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - ((today.getDay() + 6) % 7)); // Monday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const a = {
        total: ITEMS.length,
        movies: 0,
        episodes: 0,
        period: { week: 0, month: 0, year: 0, older: 0 },
        byMonth: new Map(),
        byYear: new Map(),
        byDow: [0, 0, 0, 0, 0, 0, 0],
        byDay: new Map(),
        shows: new Map(),
        first: null,
        last: null,
    };

    for (const it of ITEMS) {
        if (it.isSeries) a.episodes++; else a.movies++;
        if (it.show) a.shows.set(it.show, (a.shows.get(it.show) || 0) + 1);

        if (it.date >= weekStart) a.period.week++;
        if (it.date >= monthStart) a.period.month++;
        if (it.date >= yearStart) a.period.year++; else a.period.older++;

        const ym = it.date.getFullYear() + "-" + String(it.date.getMonth() + 1).padStart(2, "0");
        a.byMonth.set(ym, (a.byMonth.get(ym) || 0) + 1);
        a.byYear.set(it.date.getFullYear(), (a.byYear.get(it.date.getFullYear()) || 0) + 1);
        a.byDow[it.date.getDay()]++;
        const dk = it.date.getFullYear() + "-" + (it.date.getMonth() + 1) + "-" + it.date.getDate();
        a.byDay.set(dk, (a.byDay.get(dk) || 0) + 1);

        if (!a.first || it.date < a.first) a.first = it.date;
        if (!a.last || it.date > a.last) a.last = it.date;
    }

    a.daysActive = a.byDay.size;
    a.topShows = [...a.shows.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
    a.seriesCount = a.shows.size;
    let busiest = null;
    for (const [k, v] of a.byDay) if (!busiest || v > busiest[1]) busiest = [k, v];
    a.busiest = busiest;
    return a;
}

/* ----------------------------------------------------------------- rendering */

function fmtDuration(minutes) {
    const totalMin = Math.round(minutes);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    const parts = [];
    if (days) parts.push(days + " " + (days === 1 ? t("day") : t("days")));
    if (hours) parts.push(hours + " " + (hours === 1 ? t("hour") : t("hours")));
    if (mins && !days) parts.push(mins + " " + (mins === 1 ? t("minute") : t("minutes")));
    return parts.join(" ") || "0 " + t("minutes");
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

function donut(id, titleKey, labels, data, colors) {
    makeChart(id, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#141414", borderWidth: 2 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "55%",
            plugins: {
                legend: { position: "bottom", labels: { padding: 14 } },
                title: { display: true, text: t(titleKey), font: { size: 16, weight: "600" }, padding: { bottom: 12 } },
            },
        },
    });
}

function bars(id, titleKey, labels, data, color) {
    makeChart(id, {
        type: "bar",
        data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 38 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: t(titleKey), font: { size: 16, weight: "600" }, padding: { bottom: 12 } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
                y: { grid: { color: GREY }, ticks: { precision: 0 }, beginAtZero: true },
            },
        },
    });
}

function recomputeEstimate(a) {
    const avgEp = Math.max(1, +$("avg-episode").value || 35);
    const avgMv = Math.max(1, +$("avg-movie").value || 100);
    const minutes = a.episodes * avgEp + a.movies * avgMv;
    $("total-stat").textContent = fmtDuration(minutes);

    const shareUrl = "https://github.com/ghrlt/netflix-watchtime";
    const shareText = t("shareMessage", fmtDuration(minutes));
    $("twitter-share-btn").href =
        "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(shareUrl);
    return minutes;
}

function render() {
    show("content");
    if (PROFILE) {
        $("profile-name").textContent = PROFILE;
        $("profile-name").style.display = "";
    } else {
        $("profile-name").style.display = "none";
    }

    // static i18n text nodes
    document.querySelectorAll(".text").forEach((el) => {
        const k = el.getAttribute("data-text-key");
        if (k) el.textContent = t(k);
    });

    const a = analyse();

    // hero subtitle
    $("hero-sub").textContent = t("heroSub", [String(a.total), a.first ? fmtDate(a.first) : "—"]);

    // cards
    $("cards").innerHTML =
        card(a.total, t("titlesWatched")) +
        card(a.movies, t("movies")) +
        card(a.episodes, t("episodes")) +
        card(a.seriesCount, t("uniqueSeries")) +
        card(a.daysActive, t("daysActive")) +
        card(a.busiest ? a.busiest[1] : 0, t("busiestDay"));

    // estimate (depends on the inputs)
    recomputeEstimate(a);
    $("avg-episode").addEventListener("input", () => recomputeEstimate(a));
    $("avg-movie").addEventListener("input", () => recomputeEstimate(a));

    // charts
    donut("contentproportion", "contentProportion",
        [t("movies"), t("episodes")], [a.movies, a.episodes], [RED, "#b81d24"]);

    // disjoint period buckets so the donut sums to the total
    const pWeek = a.period.week;
    const pMonth = Math.max(0, a.period.month - a.period.week);
    const pYear = Math.max(0, a.period.year - a.period.month);
    const pOlder = a.period.older;
    donut("periodproportion", "periodProportion",
        [t("thisWeek"), t("thisMonth"), t("thisYear"), t("older")],
        [pWeek, pMonth, pYear, pOlder],
        ["#e50914", "#f5b500", "#3ba55d", "rgba(255,255,255,0.30)"]);

    // monthly timeline — last 24 months that have data
    const months = [...a.byMonth.keys()].sort();
    const lastMonths = months.slice(-24);
    const monthLabels = lastMonths.map((ym) => {
        const [y, m] = ym.split("-");
        return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    });
    bars("timeline", "activityTimeline", monthLabels, lastMonths.map((m) => a.byMonth.get(m)), RED);

    // day of week — start Monday
    const dowOrder = [1, 2, 3, 4, 5, 6, 0];
    const dowLabels = dowOrder.map((d) =>
        new Date(2024, 0, 1 + ((d + 6) % 7)).toLocaleDateString(undefined, { weekday: "short" }));
    bars("dayofweek", "byDayOfWeek", dowLabels, dowOrder.map((d) => a.byDow[d]), "#b81d24");

    // top series list
    $("top-series").innerHTML = a.topShows.length
        ? a.topShows
              .map(
                  ([name, n]) =>
                      `<li><span class="ts-name">${escapeHtml(name)}</span><span class="ts-count">${n} ${
                          n === 1 ? t("episodeShort") : t("episodesShort")
                      }</span></li>`
              )
              .join("")
        : `<li class="muted">${t("noSeries")}</li>`;
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
