const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, HeadingLevel, PageOrientation, LevelFormat, BorderStyle, Footer, PageNumber,
  VerticalAlign,
} = require("docx");

const TEST = "mfl.bowandbaan.com";
const LIVE = "madrasfert.co.in";
const FONT = "Calibri";
const PAGE_W = 16838, PAGE_H = 11906, MARGIN = 1080; // A4 landscape, 0.75in margins
const CONTENT_W = PAGE_W - 2 * MARGIN; // 14678

const C = {
  ok: "E2F4E6", bad: "FBE3E3", warn: "FFF1D6", info: "E8EEF7", head: "1F3864", sub: "F2F2F2",
  okT: "1E6B34", badT: "A61B1B", warnT: "8A5A00",
};

// ---------- helpers
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
const para = (children, o = {}) => new Paragraph({
  children: (Array.isArray(children) ? children : [children]).map(c => typeof c === "string" ? run(c, o) : c),
  spacing: { before: o.before ?? 0, after: o.after ?? 60 }, alignment: o.align,
});
const bullet = (children) => new Paragraph({
  numbering: { reference: "bul", level: 0 },
  children: (Array.isArray(children) ? children : [children]).map(c => typeof c === "string" ? run(c) : c),
  spacing: { after: 40 },
});
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });

// status chip text -> colour
function status(s) {
  if (/^(OK|Works|Clean|Matches|Present|Same)/i.test(s)) return { fill: C.ok, color: C.okT };
  if (/^(Broken|404|Missing|Hacked|Spam|Wrong|Not found|403)/i.test(s)) return { fill: C.bad, color: C.badT };
  if (/^(Different|Old|Outdated|Points to|Check|Not tested|n\/a)/i.test(s)) return { fill: C.warn, color: C.warnT };
  return null;
}

function cell(content, width, o = {}) {
  const lines = Array.isArray(content) ? content : [content];
  const st = o.status ? status(lines[0]) : null;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: o.fill || (st && st.fill) || "FFFFFF", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.TOP,
    children: lines.map((l, i) => new Paragraph({
      spacing: { after: i === lines.length - 1 ? 0 : 40 },
      children: [run(l, { size: o.size || 18, bold: Boolean(o.bold || (st && i === 0)), color: o.color || (st && i === 0 ? st.color : undefined) })],
    })),
  });
}

// cols: [{h, w(fraction), status?}] rows: arrays of strings or string[]
function table(cols, rows) {
  const widths = cols.map(c => Math.floor(c.w * CONTENT_W));
  widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({
        tableHeader: true,
        children: cols.map((c, i) => cell(c.h, widths[i], { fill: C.head, color: "FFFFFF", bold: true })),
      }),
      ...rows.map(r => new TableRow({
        cantSplit: true,
        children: r.map((v, i) => cell(v, widths[i], { status: cols[i].status })),
      })),
    ],
  });
}
const gap = () => para("", { after: 120 });

// ---------- content
const SBS = [ // standard side-by-side column set
  { h: "#", w: 0.04 }, { h: "Item", w: 0.22 }, { h: "Where (page)", w: 0.17 },
  { h: `TEST  (${TEST})`, w: 0.17, status: true }, { h: `LIVE  (${LIVE})`, w: 0.17, status: true },
  { h: "What to do", w: 0.23 },
];

const children = [];

// Title block
children.push(
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Website Comparison Report")] }),
  para([run("Test site vs Live site — links, buttons and broken-link audit", { size: 26, color: "404040" })], { after: 80 }),
  para([run("Test: ", { bold: true }), run(`https://${TEST}/`), run("      Live: ", { bold: true }), run(`https://${LIVE}/`),
        run("      Date: ", { bold: true }), run("27 November 2026")], { after: 200 }),
);

// At a glance
children.push(h1("1. Summary at a glance"));
children.push(table(
  [{ h: "Check", w: 0.34 }, { h: "TEST site", w: 0.22, status: true }, { h: "LIVE site", w: 0.22, status: true }, { h: "Meaning", w: 0.22 }],
  [
    ["Pages and files found by the crawler", "205", "233", "Live has more because its menus link more pages; most also exist on Test (see §4)."],
    ["Links and files checked", "1,710 (both sites combined)", "1,710 (both sites combined)", "Every link, PDF and image on every page."],
    ["Hidden spam links (site hacked)", "Clean — none found", "Hacked — 4 pages", "Urgent security issue on Live only."],
    ["Files that return 404 (exist on the other site)", "Missing — 8 files", "OK", "Upload the files to Test."],
    ["Links that still point to the other domain", "Points to Live — 31 links", "OK", "Test should link to its own domain."],
    ["Broken links on that site", "Broken — 35", "Broken — 21", "Several are broken on both sites (see §5)."],
    ["Buttons click-tested", "OK — 34 tested, all respond", "OK — 6 tested, all respond", "One Test button goes to the Live site (see §6)."],
    ["JavaScript errors", "OK — none", "OK — none", ""],
    ["Page titles / headings / page status", "Matches", "Matches", "Identical on every page that exists on both."],
  ]));
children.push(gap());

children.push(h2("How to read this report"));
children.push(table(
  [{ h: "Colour", w: 0.15, status: true }, { h: "Meaning", w: 0.85 }],
  [["OK", "Works correctly / matches."], ["Broken", "Broken, missing or a problem that must be fixed."], ["Different", "Differs between the sites or needs a manual check — decide if it is intended."]]));
children.push(para("Every table puts the Test site and the Live site side by side. The last column says exactly what to change.", { before: 80 }));

// Priority fix list
children.push(h1("2. Fix list in priority order"));
children.push(table(
  [{ h: "Priority", w: 0.08 }, { h: "Issue", w: 0.3 }, { h: "Fix on", w: 0.1 }, { h: "Action", w: 0.42 }, { h: "Section", w: 0.1 }],
  [
    ["1 — Urgent", "Live site has hidden Viagra/Cialis spam links (site compromised)", "LIVE", "Remove the injected code from the 4 pages, scan WordPress for malware, update WordPress/plugins, change admin passwords. Do NOT copy Live content to Test until cleaned.", "§3"],
    ["2 — High", "8 new files missing on Test + out-of-date notices block", "TEST", "Upload the 8 files; update the Latest News / Notices block to match Live.", "§4"],
    ["3 — High", "31 links on Test point to madrasfert.co.in", "TEST", "Change the links in the site-wide news/sidebar widget and the “GO BACK TO HOME PAGE” button to the Test domain (or use relative links). A database search-replace of http://madrasfert.co.in → https://mfl.bowandbaan.com fixes all at once.", "§4"],
    ["4 — Medium", "Broken links on both sites", "BOTH", "Upload or remove the missing PDFs; fix the recruitment form link.", "§5"],
    ["5 — Medium", "Broken “Read More” links on /home/… section pages", "TEST", "Use full URLs (/marketing/chemical-fertilizers/ etc.) instead of relative ones, or hide those section pages from the sitemap.", "§5"],
    ["6 — Medium", "Placeholder / malformed links on Live", "LIVE", "Replace YOUR_PDF_LINK.pdf; add mailto: to the e-mail link on Marketing pages.", "§5"],
    ["7 — Low", "Google Translate widget and Search box missing on Test", "TEST", "Add them if Test should match Live.", "§6"],
    ["8 — Low", "Test bot protection adds a 403 link to every page", "TEST", "Whitelist testers / disable Imunify bot-check link on staging.", "§5"],
  ]));

// Security
children.push(h1("3. Security — hidden spam links on the Live site"));
children.push(para("These links are hidden from visitors (invisible styling or a hidden block) but are seen by Google, which can damage the site’s search ranking and reputation. The Test site’s copies of the same pages are clean."));
children.push(table(SBS, [
  ["1", "Hidden link to ed-danmark.com (Viagra) inside a hidden <div> with a hiding script", "/tender", "Clean", "Spam found", "Remove the <div id=\"ZRAvE6JQHmODPldudk4Q7l\"> block and its script."],
  ["2", "Hidden link to ed-italia.com (Cialis), text “fonte dell’articolo”, styled to look like normal text", "/organisation/code-of-conduct", "Clean", "Spam found", "Remove the link from the page content."],
  ["3", "Same Cialis link", "/the-company/consultancy", "Clean", "Spam found", "Remove the link from the page content."],
  ["4", "Same Cialis link", "/achievements/safety-awards", "Clean", "Spam found", "Remove the link; then run a full malware scan."],
]));

// Content differences
children.push(h1("4. Content that differs — Test site is out of date"));
children.push(h2("4a. Latest News / Notices block (site-wide)"));
children.push(table(SBS, [
  ["1", "Non-Supervisory notification PDF", "Site-wide notices", ["Old", "Notification-Non-Sup.pdf"], ["Different", "Notification-Non-Sup0.pdf (but this file is 404 on Live — see §5)"], "Confirm the correct file and upload it to both sites."],
  ["2", "Sale of Ammonia price notice", "Site-wide notices", ["Old", "28.09.2026 version"], ["OK", "27.11.2026 version"], "Update Test to the 27.11.2026 notice."],
  ["3", "Nomination tenders 2026", "Site-wide notices", ["Missing", "Not listed"], ["OK", "Nomination-tenders2026.pdf"], "Add to Test."],
  ["4", "Jr. Secretary recruitment notice", "Site-wide notices", ["Missing", "Not listed"], ["OK", "Website-Jr-Secy.pdf"], "Add to Test."],
]));
children.push(gap());

children.push(h2("4b. Files that exist on Live but return 404 on Test"));
const missingFiles = [
  ["2026/11/7.Insider-Trading-Policy.pdf", "/finance/investors-information"],
  ["2026/11/Preservation-and-Archival-Policy-P-31.pdf", "/finance/investors-information"],
  ["2026/11/Sale-of-Ammonia-price-MFL-Website-27.11.2026.pdf", "Site-wide notices (77 Live pages)"],
  ["2026/11/Nomination-tenders2026.pdf", "Site-wide notices (77 Live pages)"],
  ["2026/11/Website-Jr-Secy.pdf", "Site-wide notices (77 Live pages)"],
  ["2026/11/347-BM-OUTCOME-NSE-sd.pdf", "/finance/investors-information"],
  ["2026/11/MADRASFERT_13102026.html", "/finance/investors-information"],
  ["2026/03/Notification-Non-Sup0.pdf", "Site-wide notices (77 Live pages)"],
];
children.push(table(SBS, missingFiles.map((f, i) => [
  String(i + 1), f[0], f[1], ["404", "Not found"], i === 7 ? ["404", "Also missing"] : ["OK", "Available"],
  i === 7 ? "Upload the correct file to both sites." : "Copy the file from Live /wp-content/uploads/ to Test.",
])));
children.push(gap());

children.push(h2("4c. Links on Test that still point to the Live domain (31)"));
children.push(para("30 of these sit in the site-wide news/recruitment widget, so they appear on all 83 crawled Test pages. Fixing the widget once fixes every page. A visitor on the Test site who clicks these leaves the Test site."));
const xd = JSON.parse(fs.readFileSync(__dirname + "/data/crossdomain_pages.json", "utf8"));
const xdRows = Object.entries(xd).sort().map(([u, pages], i) => {
  const path = u.replace(/^https?:\/\/(www\.)?madrasfert\.co\.in/, "");
  const where = pages.length > 10 ? `Site-wide widget (${pages.length} pages)` : pages.join(", ");
  return [String(i + 1), path || "/", where, ["Points to Live", "http://madrasfert.co.in" + path], ["OK", "Own domain"],
    path === "/#mfl_featured" ? "“GO BACK TO HOME PAGE” button — change link to the Test home page." : "Change to https://mfl.bowandbaan.com" + path];
});
children.push(table(SBS, xdRows));
children.push(gap());

children.push(h2("4d. Pages the crawler found on only one site"));
children.push(table(
  [{ h: "Result", w: 0.3 }, { h: "Count", w: 0.08 }, { h: "Explanation", w: 0.62 }],
  [
    ["Found on Live only — but they DO exist on Test", "97", "Pages such as /contact-us, /tender, /news, /privacy-policy open fine on Test (HTTP 200). The crawler simply did not reach them on Test because Test’s links send visitors to the Live domain (§4c). No action beyond fixing §4c."],
    ["Found on Live only — really missing on Test", "13", "The 8 files in §4b, /vijay-organic-Manure (also 404 on Live) and 4 malformed Live URLs (see §5)."],
    ["Found on Test only — exist on Live too", "54", "Mostly gallery images and older PDFs; they exist on Live. No action."],
    ["Found on Test only — 404 on both", "28", "The /home/… “Read More” links (see §5)."],
  ]));

// Broken links
children.push(h1("5. Broken links — side by side"));
children.push(table(SBS, [
  ["1", "Message-from-Union-Council-of-Ministers-for-VAW-2026.pdf", "Home page (Test also on /home/… section pages)", ["404", "Broken"], ["404", "Broken"], "Upload the PDF or remove the link (both sites)."],
  ["2", "T-WClosure-Dec-2024.pdf", "/finance/investors-information", ["404", "Broken"], ["404", "Broken"], "Upload the PDF or remove the link (both sites)."],
  ["3", "Online recruitment form cdn3.digialm.com/…/Registration0.html", "Site-wide (83 / 77 pages)", ["404", "Broken"], ["404", "Broken"], "External form no longer exists — update or remove the link."],
  ["4", "Notification-Non-Sup0.pdf", "Site-wide (77 pages)", ["n/a", "Test links the older file"], ["404", "Broken"], "Upload the file to Live (and Test)."],
  ["5", "/vijay-organic-Manure", "Home page", ["n/a", "Not linked"], ["404", "Broken"], "Point to /vijay-organic-products or create the page."],
  ["6", "YOUR_PDF_LINK.pdf (template placeholder never replaced)", "/finance/investors-information", ["n/a", "Not present"], ["404", "Broken"], "Replace with the real PDF link."],
  ["7", "E-mail mflrovlrsmopdy@gmail.com used as a web link + broken HTML (“</a></p></p> <p class=”)", "/marketing, /marketing/regional-offices", ["n/a", "Not present"], ["Broken", "Opens a 404 page"], "Change to mailto:mflrovlrsmopdy@gmail.com and fix the HTML."],
  ["8", "28 “Read More” links using relative URLs (e.g. href=\"chemical-fertilizers\")", "/home/our-products, /home/mfl-features, /home/our-mission, /home/mfl-timeline, /home/minister-of-state, /home/mfl-google-map, /home/home-latest-news", ["404", "Broken"], ["n/a", "Same pages exist; not crawled"], "Use full URLs such as /marketing/chemical-fertilizers/ and /the-plant/future-plan/."],
  ["9", "/imunify-bot-check link (server bot protection)", "Every page", ["403", "Blocked"], ["n/a", "Not present"], "Disable/whitelist Imunify bot-check on staging."],
  ["10", "dpe.gov.in/…/Glch02c11_0.pdf", "/right-to-information-act-2005", ["n/a", "Not linked"], ["404", "Broken"], "External government file moved — update link."],
  ["11", "http://www.madrasfert.co.in (old www address)", "/right-to-information-act-2005", ["n/a", "Not linked"], ["Broken", "Does not connect"], "Change to https://madrasfert.co.in."],
  ["12", "/2019/01/02/ and /comments/feed/", "/ufaqs/particulars-of-organization", ["n/a", "Not linked"], ["404", "404 / 403"], "Remove leftover WordPress archive/feed links."],
]));
children.push(gap());
children.push(h2("Please check these by hand in a browser"));
children.push(para("These external sites blocked the automated checker. They probably work for normal visitors, but confirm once:"));
["facebook.com/mfl.chennai.1 (both sites)", "nseindia.com company tracker (both sites)", "fert.nic.in — Department of Fertilizers (both sites)",
 "onlinesbi.com SBI Collect (Live /resources)", "nvsp.in (Live /resources)"].forEach(t => children.push(bullet(t)));

// Features / buttons
children.push(h1("6. Buttons and features — side by side"));
children.push(table(SBS, [
  ["1", "Home page banner carousel — previous / next arrows", "/", ["Works", "Slides change"], ["Works", "Slides change"], "None (different slider labels only)."],
  ["2", "“GO BACK TO HOME PAGE” button", "/agm-notice-year-of-2023-2024", ["Wrong", "Goes to madrasfert.co.in"], ["Works", "Goes to Live home"], "Change Test button link to the Test home page."],
  ["3", "“GO BACK TO HOME PAGE” button", "/eps-95-circular", ["Works", "Stays on Test"], ["n/a", "Page not on Live menu"], "None."],
  ["4", "Complaint Registration Form — Submit", "/vigilance/complaint-registration-form", ["Works", "Shows validation"], ["Works", "Shows validation"], "None."],
  ["5", "Search box", "/ufaqs/… pages", ["Missing", "No search box"], ["Works", "Opens search results"], "Add the search widget to the Test sidebar."],
  ["6", "Google Translate widget (with Good/Poor translation buttons)", "~30 pages", ["Missing", "Not loaded"], ["Present", "Loaded"], "Add Google Translate to Test if it should match."],
  ["7", "RTI Act 2005 page layout", "/right-to-information-act-2005", ["Different", "Expandable sections (all 30 open correctly)"], ["Different", "37 links to separate /ufaqs pages"], "Confirm the new layout is intended."],
  ["8", "JavaScript errors while clicking", "All pages", ["OK", "None"], ["OK", "None"], "None."],
  ["9", "Corporate video page", "/azadi-ka-amrit-mahotsav", ["OK", "Loads"], ["Not tested", "Page was slow (timed out once)"], "Check Live page speed."],
]));

// What matches
children.push(h1("7. What already matches"));
["Page titles and main headings (H1) are identical on every page present on both sites.",
 "Page status (loads / 404) is the same for all shared pages.",
 "Menus, footer links and product pages lead to the same destinations (apart from the domain issue in §4c).",
 "All tested buttons respond on both sites; no JavaScript errors."].forEach(t => children.push(bullet(t)));

// Method
children.push(h1("8. How this was checked"));
[
  "Firecrawl (self-hosted) crawled both sites, collecting every page, link, button and form.",
  "Every unique link, PDF and image (1,710) was requested and its HTTP status recorded.",
  "Each page on Test was matched to the same page on Live and their links, buttons, titles and forms compared.",
  "A real browser (Playwright / Chromium) opened every page and clicked each distinct button, recording whether it navigated, opened a tab, changed the page, or did nothing.",
  "Pages found on only one site were requested directly on the other site to separate real gaps from crawler reach.",
].forEach(t => children.push(bullet(t)));

// ---------- document
const doc = new Document({
  creator: "Website QA",
  title: "Website Comparison Report",
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", run: { font: FONT, size: 44, bold: true, color: C.head }, paragraph: { spacing: { before: 0, after: 60 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: C.head }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, color: "2F5496" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
      run(`Website Comparison — ${TEST} vs ${LIVE}    Page `, { size: 16, color: "808080" }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "808080" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(b => {
  const out = process.argv[2];
  fs.writeFileSync(out, b);
  console.log("wrote", out);
});
