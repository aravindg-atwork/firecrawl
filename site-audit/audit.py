"""Compare a test site against a live site using self-hosted Firecrawl.

Stage 1 (crawl):  Firecrawl /v2/crawl both sites -> pages, links, rawHtml
Stage 2 (links):  HTTP-check every unique link found on either site
Stage 3 (clicks): Playwright clicks every visible button on each page and records the effect
Writes results.json next to this script; report.py renders it.
"""
import json, re, sys, time, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse, urljoin, urldefrag

import requests
from bs4 import BeautifulSoup

FC = "http://localhost:3002"
SITES = {"test": "https://mfl.bowandbaan.com/", "live": "https://madrasfert.co.in/"}
HOSTS = {k: urlparse(v).netloc.lower() for k, v in SITES.items()}
OUT = Path(__file__).parent / "data" / "results.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36"}
CRAWL_LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 300
STAGES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["crawl", "links", "clicks"]


def bare(host):
    return host[4:] if host.startswith("www.") else host


def path_key(url):
    """Site-independent key for a page: path without trailing slash + query."""
    p = urlparse(url)
    path = re.sub(r"/+$", "", p.path) or "/"
    return path + (("?" + p.query) if p.query else "")


def neutral(url):
    """Rewrite a link so test and live links compare equal (host swapped to a placeholder)."""
    url = urldefrag(url)[0]
    p = urlparse(url)
    h = bare(p.netloc.lower())
    for k, host in HOSTS.items():
        if h == bare(host):
            return "SITE:" + path_key(url)
    return url.rstrip("/")


def load():
    return json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}


def save(data):
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")


# ---------------------------------------------------------------- stage 1
def crawl(site, base):
    body = {
        "url": base,
        "limit": CRAWL_LIMIT,
        "sitemap": "include",
        "ignoreQueryParameters": True,
        "scrapeOptions": {"formats": ["links", "rawHtml"], "onlyMainContent": False, "timeout": 60000},
    }
    r = requests.post(f"{FC}/v2/crawl", json=body, timeout=60)
    r.raise_for_status()
    job = r.json()["id"]
    print(f"[{site}] crawl job {job}", flush=True)
    docs, nxt = [], f"{FC}/v2/crawl/{job}"
    while True:
        s = requests.get(f"{FC}/v2/crawl/{job}", timeout=60).json()
        print(f"[{site}] {s.get('status')} {s.get('completed')}/{s.get('total')}", flush=True)
        if s.get("status") in ("completed", "failed", "cancelled"):
            break
        time.sleep(10)
    while nxt:  # paginate results
        s = requests.get(nxt, timeout=120).json()
        docs += s.get("data", [])
        nxt = s.get("next")
    errs = requests.get(f"{FC}/v2/crawl/{job}/errors", timeout=60).json()
    return docs, errs


def parse_page(doc, site):
    md = doc.get("metadata", {})
    url = md.get("sourceURL") or md.get("url")
    soup = BeautifulSoup(doc.get("rawHtml") or "", "html.parser")
    anchors = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        anchors.append({"href": urljoin(url, href), "raw": href, "text": " ".join(a.get_text(" ").split())[:80]})
    buttons = []
    for b in soup.select("button, input[type=submit], input[type=button], [role=button], a.btn, a.button, a[class*=elementor-button], .wp-block-button__link"):
        txt = " ".join((b.get_text(" ") or b.get("value") or b.get("aria-label") or "").split())[:80]
        buttons.append({"tag": b.name, "text": txt, "href": b.get("href"), "onclick": b.get("onclick")})
    forms = [{"action": urljoin(url, f.get("action") or ""), "method": (f.get("method") or "get").lower()} for f in soup.find_all("form")]
    imgs = [urljoin(url, i.get("src")) for i in soup.find_all("img", src=True) if not i["src"].startswith("data:")]
    title = soup.title.get_text(strip=True) if soup.title else ""
    h1 = [" ".join(h.get_text(" ").split()) for h in soup.find_all("h1")]
    return {
        "url": url, "key": path_key(url), "status": md.get("statusCode"), "title": title, "h1": h1,
        "anchors": anchors, "fc_links": doc.get("links", []), "buttons": buttons, "forms": forms, "images": imgs,
        "cross_domain": sorted({a["href"] for a in anchors
                                 if bare(urlparse(a["href"]).netloc.lower()) == bare(HOSTS["live" if site == "test" else "test"])}),
    }


# ---------------------------------------------------------------- stage 2
def check(url):
    try:
        r = requests.head(url, headers=UA, timeout=20, allow_redirects=True)
        if r.status_code in (403, 405, 406, 501) or r.status_code >= 400:
            r = requests.get(url, headers=UA, timeout=25, allow_redirects=True, stream=True)
            r.close()
        return {"status": r.status_code, "final": r.url}
    except requests.RequestException as e:
        return {"status": None, "error": type(e).__name__ + ": " + str(e)[:150]}


def link_stage(data):
    urls = set()
    for site in SITES:
        for p in data["pages"][site].values():
            for a in p["anchors"]:
                if urlparse(a["href"]).scheme in ("http", "https"):
                    urls.add(urldefrag(a["href"])[0])
            urls.update(p["images"])
    print(f"checking {len(urls)} urls", flush=True)
    res = {}
    with ThreadPoolExecutor(16) as ex:
        for u, r in zip(urls, ex.map(check, urls)):
            res[u] = r
    data["linkcheck"] = res


# ---------------------------------------------------------------- stage 3
CLICK_SELECTOR = ("button:visible, input[type=submit]:visible, input[type=button]:visible, [role=button]:visible, "
                  "a.btn:visible, a.button:visible, a[class*=elementor-button]:visible, .wp-block-button__link:visible")


SIG_JS = """els => els.map(e => [(e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' ').slice(0,80),
  e.getAttribute('href') || '', e.getAttribute('onclick') || '', e.tagName].join('|'))"""


def click_stage(data, sites):
    """Click each distinct button (label+href+onclick) once per site; repeated header/footer buttons are skipped."""
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for site in sites:
            out[site] = {}
            seen = set()
            for key, p in data["pages"][site].items():
                if "/wp-content/" in key or p["status"] != 200:  # files (PDF etc.) and 404s have no buttons
                    continue
                ctx = browser.new_context(user_agent=UA["User-Agent"], viewport={"width": 1366, "height": 900})
                page = ctx.new_page()
                results, errors = [], []
                page.on("pageerror", lambda e: errors.append(str(e)[:200]))
                try:
                    page.goto(p["url"], wait_until="networkidle", timeout=45000)
                except Exception as e:
                    out[site][key] = {"error": str(e)[:200]}
                    ctx.close()
                    continue
                try:
                    sigs = page.locator(CLICK_SELECTOR).evaluate_all(SIG_JS)
                except Exception:
                    sigs = []
                todo = [i for i, s in enumerate(sigs) if s not in seen][:30]
                seen.update(sigs)
                first = True
                for i in todo:
                    try:
                        if not first:
                            page.goto(p["url"], wait_until="domcontentloaded", timeout=45000)
                            page.wait_for_timeout(800)
                        first = False
                        loc = page.locator(CLICK_SELECTOR).nth(i)
                        if not loc.count():
                            continue
                        label = " ".join((loc.inner_text(timeout=2000) or loc.get_attribute("value") or
                                          loc.get_attribute("aria-label") or "").split())[:80]
                        before_url, before_html = page.url, len(page.content())
                        popups, dialogs = [], []
                        ctx.on("page", lambda pg: popups.append(pg))
                        page.once("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
                        loc.scroll_into_view_if_needed(timeout=3000)
                        loc.click(timeout=5000)
                        page.wait_for_timeout(1500)
                        effect = []
                        if page.url != before_url:
                            effect.append("navigated:" + page.url)
                        for pg in popups:
                            try:
                                pg.wait_for_load_state("domcontentloaded", timeout=10000)
                            except Exception:
                                pass
                            effect.append("new_tab:" + pg.url)
                            pg.close()
                        if dialogs:
                            effect.append("dialog:" + dialogs[0])
                        if not effect and page.url == before_url and abs(len(page.content()) - before_html) > 20:
                            effect.append("dom_changed")
                        results.append({"i": i, "sig": sigs[i], "label": label, "effect": effect or ["NO_VISIBLE_EFFECT"]})
                    except Exception as e:
                        results.append({"i": i, "sig": sigs[i], "label": sigs[i].split("|")[0],
                                        "effect": ["CLICK_FAILED: " + str(e).splitlines()[0][:150]]})
                out[site][key] = {"buttons": results, "js_errors": sorted(set(errors))}
                print(f"[{site}] {key}: {len(results)} clicks", flush=True)
                OUT.with_name(f"clicks_{site}.json").write_text(json.dumps(out[site], indent=1, ensure_ascii=False), "utf-8")
                ctx.close()
        browser.close()
    return out


def main():
    data = load()
    if "crawl" in STAGES:
        data["pages"], data["crawl_errors"] = {}, {}
        with ThreadPoolExecutor(2) as ex:
            futs = {s: ex.submit(crawl, s, u) for s, u in SITES.items()}
            for s, f in futs.items():
                docs, errs = f.result()
                data["pages"][s] = {}
                for d in docs:
                    pg = parse_page(d, s)
                    data["pages"][s][pg["key"]] = pg
                data["crawl_errors"][s] = errs
                print(f"[{s}] {len(data['pages'][s])} pages", flush=True)
        save(data)
    if "links" in STAGES:
        link_stage(data)
        save(data)
    for site in SITES:  # "clicks-test" / "clicks-live" run one site, writing its own file so both can run at once
        if "clicks" in STAGES or f"clicks-{site}" in STAGES:
            res = click_stage(data, [site])
            OUT.with_name(f"clicks_{site}.json").write_text(json.dumps(res[site], indent=1, ensure_ascii=False), "utf-8")
    print("done ->", OUT)


if __name__ == "__main__":
    main()
