<img src="https://raw.githubusercontent.com/ghrlt/netflix-watchtime/master/medias/banner.png" alt="A banner featuring the extension logo">

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](http://www.gnu.org/licenses/gpl-3.0)

# Netflix Watchtime

View and analyse your Netflix watch history — number of titles, movies vs episodes,
your top series, when you watch, and an **estimated** total watch time.

> **v2 — rebuilt for Netflix's current API (2026).**
> The old REST endpoint (`/shakti/<build>/viewingactivity`) the extension relied on was
> removed, which is why v1 stopped working. Netflix now serves the watch history through
> its GraphQL API and **no longer exposes how many seconds you watched each title**, so the
> headline "total watch time" is now an *estimate* based on your number of titles (with
> adjustable per-title averages). Everything else — counts, trends, top series — is exact.

## How it works

1. Click the toolbar icon to open the dashboard.
2. The extension opens your Netflix viewing-activity page in a background tab and runs the
   same GraphQL query Netflix's own "Download all" button uses (so your cookies and CORS
   just work), then closes the tab.
3. The history (title + date per entry) is analysed **locally in your browser**. Nothing is
   sent anywhere.

You need to be logged into Netflix in the same browser.

## What you get

- **Estimated watch time** — titles × adjustable average minutes (episodes / movies).
- Titles watched, movies, episodes, unique series, active days, busiest day.
- Movies vs Episodes, "when you watched" (week/month/year/older), activity over time,
  and watching by day of the week.
- Your **top series** by number of episodes.

## Installation

Install from source:
- Download the repo as a ZIP and extract it.
- Open your Chromium-based browser and go to `chrome://extensions`.
- Enable **Developer mode**, click **Load unpacked**, and select the extracted folder.
- Click the extension's icon to open your dashboard.

## A note on durability

The GraphQL query is referenced by a persisted-query id/version
(`scripts.js` → `GQL_ID` / `GQL_VER`). If Netflix bumps those, the extension shows a clear
"Netflix changed its API" message and these two constants simply need updating to the
current values (visible in the request Netflix's own *Download all* button makes).

## Adding a translation

Translations live in `_locales/<locale>/messages.json`. Copy `_locales/en/messages.json`,
translate every `message` value, and open a pull request. (`en` and `fr` ship today.)
