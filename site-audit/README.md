# Site audit: test vs live

Compares the staging site (https://mfl.bowandbaan.com/) against the live site
(https://madrasfert.co.in/) for missing pages, broken links, links pointing at the
wrong domain, and buttons that behave differently.

The finished report is [`Website-Comparison-Report.docx`](./Website-Comparison-Report.docx)
(audit run on 27 November 2026).

## Files

| File | Purpose |
| --- | --- |
| `audit.py` | Crawls both sites with self-hosted Firecrawl, HTTP-checks every link, and click-tests buttons with Playwright |
| `report.py` | Turns `data/results.json` and the click results into `data/findings.json` |
| `spot.py` | Direct Playwright checks for pages the crawler did not reach (forms, search, RTI page) |
| `make_docx.js` | Builds the Word report |
| `data/` | Audit output: findings, cross-domain link map, click results, one-sided page checks |

`data/results.json` (the raw crawl with page HTML, about 9 MB) is not committed; re-run the crawl to regenerate it.

## Re-running

1. Start Firecrawl from the repository root: `docker compose up -d` (API on `http://localhost:3002`).
2. Install the Python dependencies: `pip install requests beautifulsoup4 playwright` and `python -m playwright install chromium`.
3. Crawl and check links: `python audit.py 300 crawl,links` (300 is the per-site page limit).
4. Click-test buttons, both sites at once: `python audit.py 300 clicks-test` and `python audit.py 300 clicks-live`.
5. Summarise: `python report.py`.
6. Build the report: `npm install docx`, then `node make_docx.js Website-Comparison-Report.docx`.

Self-hosted Firecrawl cannot run browser actions (they need Fire Engine), so the button test uses Playwright directly.
