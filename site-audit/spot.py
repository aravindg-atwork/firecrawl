from playwright.sync_api import sync_playwright

SITES = ["https://mfl.bowandbaan.com", "https://madrasfert.co.in"]
CHECKS = [
    ("/vigilance/complaint-registration-form/", "input[type=submit]:visible, button[type=submit]:visible"),
    ("/ufaqs/particulars-of-organization/", "input[type=submit]:visible, button:has-text('Search'):visible"),
    ("/azadi-ka-amrit-mahotsav/", None),
    ("/right-to-information-act-2005/", None),
]
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for base in SITES:
        for path, sel in CHECKS:
            p = b.new_page()
            errs = []
            p.on("pageerror", lambda e: errs.append(str(e)[:80]))
            try:
                r = p.goto(base + path, wait_until="domcontentloaded", timeout=60000)
                p.wait_for_timeout(1500)
                info = f"status={r.status} title={p.title()[:50]!r}"
                if sel:
                    loc = p.locator(sel)
                    if loc.count():
                        u = p.url
                        lab = loc.first.get_attribute("value") or loc.first.inner_text()[:20]
                        loc.first.click(timeout=5000)
                        p.wait_for_timeout(2000)
                        info += f" | click {lab!r} -> " + ("navigated " + p.url if p.url != u else "stayed (validation/ajax)")
                    else:
                        info += " | BUTTON NOT FOUND"
                if "right-to" in path:
                    info += f" | ufaqs links={p.locator('a[href*=ufaqs]').count()}"
            except Exception as e:
                info = "ERROR " + str(e).splitlines()[0][:80]
            print(base[8:24], path, info, "jserr", errs[:2], flush=True)
            p.close()
    b.close()
