# Chrome Web Store listing

Copy/paste source for the Web Store developer dashboard. The store renders the description as
**plain text** (line breaks preserved, no Markdown/HTML) — keep formatting to line breaks,
CAPS headers and emoji.

---

## Name
Netflix Watchtime

## Summary (max 132 characters)
See your real Netflix watch time — total hours, top series and viewing habits, computed locally in your browser. Free.

## Category
Productivity  (alt: Fun)

## Language
English (with French + Portuguese translations bundled)

---

## Detailed description

How much of your life has Netflix really had? Now you can know.

Netflix quietly stopped showing how long you've watched — so most trackers just guess.
Netflix Watchtime doesn't. It reads your own viewing activity, in your logged-in session,
right in your browser, and reconstructs your NEAR-EXACT watch time from each title's real
runtime and how far you actually got. Finished a show? It counts in full. Bailed on a movie
after 20 minutes? It only counts those 20 minutes.

WHAT YOU GET
• Total watch time — the number you weren't sure you wanted.
• Your top series, ranked by time actually watched.
• When you watch — by hour of the day, day of the week, and across the years.
• Movies vs episodes, by real time spent.
• Titles watched, active days, busiest stretches — all from your own account.

FAST & PRIVATE
• Crunches thousands of titles in seconds.
• Everything is computed locally on your device. Your viewing history, the titles you've
  watched, and your account details never leave your browser.
• No ads. No tracking. No account required.

OPTIONAL GLOBAL LEADERBOARD
• Curious how you stack up against the rest of the internet? Opt in to the global
  watch-time leaderboard — under a name you choose, or completely anonymously.
• It's strictly opt-in, and only ONE number is ever sent: your total. Nothing else —
  no titles, no history, no identity.

Open source: https://github.com/ghrlt/netflix-watchtime
Leaderboard & info: https://netflixwatchtime.zlef.fr

Not affiliated with Netflix, Inc. "Netflix" is a trademark of its respective owner.

---

## Single purpose (required field)
Netflix Watchtime computes and displays statistics about the user's own Netflix viewing
activity — total watch time, top series, and viewing patterns — using the user's existing
Netflix session, with all analysis performed locally in the browser.

---

## Permission justifications (Privacy practices tab)

Host permission — https://*.netflix.com/*
Needed to read the user's own viewing activity from their logged-in Netflix account (the
viewing-activity page and the account APIs it uses) in order to compute their watch-time
statistics. Used only on the user's own session, only when the dashboard is opened.

scripting
Used to run the analysis function inside the Netflix tab so it can read the user's viewing
history from the page using the existing session, then return the computed data.

tabs
Used to open the user's Netflix viewing-activity page in a background tab to read the data,
and to close that tab once the analysis is done.

storage
Stores a single randomly generated identifier locally so that, if the user opts in to the
leaderboard, re-submitting updates their existing entry instead of creating duplicates. Also
remembers the leaderboard display name the user chooses. Nothing sensitive is stored.

Remote code
Not used. All extension code is bundled; nothing is fetched and executed remotely.

---

## Data usage disclosures (Privacy practices tab)

Declare the following:

Does this item collect or use data? Yes — minimally, and only on explicit opt-in.

What is collected:
• "User-provided content" / website content — ONLY if the user opts in to the leaderboard:
  a single integer (their total watch time in seconds) plus an optional display name they
  type. A random local identifier is also sent so entries can be de-duplicated.

What is NOT collected: viewing history, watched titles, Netflix account info, email,
credentials, location, health/financial data, web browsing history, personal communications.
The extension performs no analytics or tracking.

Certifications (check all three — they are true):
• The data is not sold or transferred to third parties (outside the leaderboard's own display).
• The data is not used or transferred for purposes unrelated to the item's core functionality.
• The data is not used or transferred to determine creditworthiness or for lending.

Privacy policy URL:
https://netflixwatchtime.zlef.fr/privacy

---

## Store assets (reminder)
• Icon: 128×128 (medias/icon128.png).
• At least one screenshot, 1280×800 or 640×400 — use the dashboard (the 127-days hero with
  charts) and optionally the leaderboard card.
• Small promo tile 440×280 (optional but recommended).
