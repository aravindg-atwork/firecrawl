"""Summarise results.json into findings.json (compact) and print a text summary."""
import json
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

from audit import neutral, SITES, HOSTS, bare

HERE = Path(__file__).parent / "data"
D = json.loads((HERE / "results.json").read_text("utf-8"))
P, LC = D["pages"], D.get("linkcheck", {})
CL = {s: json.loads((HERE / f"clicks_{s}.json").read_text("utf-8")) for s in SITES if (HERE / f"clicks_{s}.json").exists()}

f = {"counts": {s: len(P[s]) for s in SITES}}
tk, lk = set(P["test"]), set(P["live"])
f["pages_only_live"] = sorted(lk - tk)
f["pages_only_test"] = sorted(tk - lk)
common = sorted(tk & lk)

# broken links per site: link -> pages that contain it
broken = {s: defaultdict(set) for s in SITES}
for s in SITES:
    for key, p in P[s].items():
        for u in {a["href"].split("#")[0] for a in p["anchors"]} | set(p["images"]):
            r = LC.get(u)
            if r and (r["status"] is None or r["status"] >= 400):
                broken[s][u].add(key)
f["broken"] = {s: [{"url": u, "status": LC[u].get("status"), "error": LC[u].get("error"), "pages": sorted(v)}
                   for u, v in sorted(broken[s].items())] for s in SITES}

# test pages linking to live domain (staging leakage)
f["test_links_to_live_domain"] = sorted({(u) for p in P["test"].values() for u in p["cross_domain"]})

# per-page diffs
diffs = []
for k in common:
    t, l = P["test"][k], P["live"][k]
    tl = {neutral(a["href"]) for a in t["anchors"] if urlparse(a["href"]).scheme in ("http", "https")}
    ll = {neutral(a["href"]) for a in l["anchors"] if urlparse(a["href"]).scheme in ("http", "https")}
    tb = sorted({b["text"] for b in t["buttons"] if b["text"]})
    lb = sorted({b["text"] for b in l["buttons"] if b["text"]})
    d = {"page": k}
    if t["status"] != l["status"]:
        d["status"] = [t["status"], l["status"]]
    if t["title"] != l["title"]:
        d["title"] = [t["title"], l["title"]]
    if t["h1"] != l["h1"]:
        d["h1"] = [t["h1"], l["h1"]]
    if ll - tl:
        d["links_missing_on_test"] = sorted(ll - tl)
    if tl - ll:
        d["links_extra_on_test"] = sorted(tl - ll)
    if set(lb) - set(tb):
        d["buttons_missing_on_test"] = sorted(set(lb) - set(tb))
    if set(tb) - set(lb):
        d["buttons_extra_on_test"] = sorted(set(tb) - set(lb))
    if len(t["forms"]) != len(l["forms"]):
        d["forms"] = [len(t["forms"]), len(l["forms"])]
    if len(d) > 1:
        diffs.append(d)
f["page_diffs"] = diffs

# click results: each distinct button (label | href | onclick | tag, host-neutralised) compared site-wide
def norm_effect(e):
    return [x.split(":", 1)[0] + ":" + neutral(x.split(":", 1)[1]) if x.startswith(("navigated:", "new_tab:")) else x
            for x in e]


def norm_sig(sig):
    label, href, onclick, tag = (sig.split("|") + ["", "", ""])[:4]
    return "|".join([label, neutral(href) if href.startswith("http") else href, onclick, tag])


btn = {}
for s in CL:
    btn[s] = {}
    for key, r in CL[s].items():
        for b in r.get("buttons", []):
            btn[s].setdefault(norm_sig(b["sig"]), {"label": b["label"], "page": key, "effect": norm_effect(b["effect"])})
rows = []
for sig in sorted(set(btn.get("test", {})) | set(btn.get("live", {}))):
    t, l = btn.get("test", {}).get(sig), btn.get("live", {}).get(sig)
    te, le = t and t["effect"], l and l["effect"]
    broken_t = te and any(x.startswith(("CLICK_FAILED", "NO_VISIBLE")) for x in te)
    if te != le or broken_t:
        rows.append({"button": sig.split("|")[0] or "(no text) " + sig, "test": te, "live": le,
                     "test_page": t and t["page"], "live_page": l and l["page"]})
f["click_diffs"] = rows
f["click_counts"] = {s: len(btn[s]) for s in btn}
f["js_errors"] = {s: {k: r["js_errors"] for k, r in CL[s].items() if r.get("js_errors")} for s in CL}
f["page_load_errors"] = {s: {k: r["error"] for k, r in CL[s].items() if r.get("error")} for s in CL}
f["crawl_errors"] = {s: (D["crawl_errors"][s].get("errors") or [])[:50] for s in SITES}

(HERE / "findings.json").write_text(json.dumps(f, indent=1, ensure_ascii=False), "utf-8")
print(json.dumps({"counts": f["counts"], "only_live": len(f["pages_only_live"]), "only_test": len(f["pages_only_test"]),
                  "broken_test": len(f["broken"]["test"]), "broken_live": len(f["broken"]["live"]),
                  "test->live links": len(f["test_links_to_live_domain"]), "pages_with_diffs": len(diffs),
                  "buttons_tested": f["click_counts"], "button_diffs": len(rows)}, indent=1))
