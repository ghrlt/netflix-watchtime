<img src="https://raw.githubusercontent.com/ghrlt/netflix-watchtime/master/medias/banner.png" alt="A banner featuring the extension logo">

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](http://www.gnu.org/licenses/gpl-3.0)

# Netflix Watchtime

See how much time you've **really** spent on Netflix — total watch time, top series,
when you watch (hour of day, day of week, over the years), movies vs episodes, and more.

> **v2 — rebuilt for Netflix's current API (2026).**
> The old endpoint v1 used (`/shakti/<build>/viewingactivity`) was removed, which is why
> it stopped working. This version reconstructs your **near-exact** watch time from
> Netflix's current internal APIs — not a flat estimate.

## How watch time is computed

Netflix no longer exposes a single "seconds watched" field, but it still knows, per title:
its **runtime** and your **bookmark position** (how far you got). So for every entry in
your history:

- if you finished it (watched ≥ 90 % → past the credits), it counts as the **full runtime**;
- if you stopped partway (or abandoned it), it counts **only what you actually watched**.

Summed across your whole history, that's your real watch time. Titles you binged to the end
count fully; the movie you bailed on after 20 minutes only adds 20 minutes.

## How it works (technical)

The dashboard opens your Netflix viewing-activity page in a background tab and, in that
page's own context (so cookies, CSRF token and CORS are Netflix's own), it:

1. Paginates your full history via the AUI Falcor endpoint
   (`/api/aui/pathEvaluator` → `["aui","viewingActivity",page,_]`) — video id + exact
   timestamp + series id per entry.
2. Looks up `runtime` + `bookmarkPosition` per title via the member Falcor endpoint
   (`/nq/website/memberapi/release/pathEvaluator` → `["videos",[ids],["runtime",
   "bookmarkPosition"]]`), batched.
3. Computes everything **locally**. Nothing is sent anywhere.

A few thousand history items take well under a minute. You must be logged into Netflix in
the same browser.

## Installation

Install from source:
- Download the repo as a ZIP and extract it.
- Open your Chromium-based browser and go to `chrome://extensions`.
- Enable **Developer mode**, click **Load unpacked**, and select the extracted folder.
- Click the extension's icon to open your dashboard.

## A note on durability

This relies on Netflix's internal (undocumented) account APIs. If Netflix changes their
shape, the extension shows a clear "Netflix changed its API" message — the request/response
formats are documented in `scripts.js` so they're quick to refresh.

## Adding a translation

Translations live in `_locales/<locale>/messages.json`. Copy `_locales/en/messages.json`,
translate every `message` value, and open a pull request. (`en` and `fr` ship today.)
