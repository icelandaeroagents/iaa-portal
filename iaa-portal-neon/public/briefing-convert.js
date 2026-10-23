/* Iceland Aero Agents – Staff Portal
   Briefing conversion helpers, shared by the upload page (browser) and
   any server-side publishing. Works on the HTML that mammoth produces
   from a briefing .docx:
     – meta(rawHtml, fileName) → { issueNo, issueDate, sections }
     – clean(rawHtml)          → the web version: cover block and
                                 Signatures table removed, headings
                                 shifted down one level, empty lines gone */

(function (root) {
  "use strict";

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  function text(html) {
    return String(html)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|td|th|tr|li|div|h[1-6])>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|\u00a0/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // The cover is everything before the first main heading.
  function splitCover(raw) {
    const i = raw.search(/<h1[\s>]/i);
    return i === -1 ? ["", raw] : [raw.slice(0, i), raw.slice(i)];
  }

  function meta(raw, fileName) {
    const name = String(fileName || "");
    const parts = splitCover(raw);
    const cover = text(parts[0]);
    let issueNo = null;
    let issueDate = null;

    // 1. Names like IAA_Briefing_05_2026-02-15.docx decide everything.
    let m = name.match(/briefing[\s_-]*0*(\d{1,4})[\s_-]+(\d{4}-\d{2}-\d{2})/i);
    if (m) { issueNo = parseInt(m[1], 10); issueDate = m[2]; }

    // 2. Otherwise read the cover: "#22" and "July 12th, 2026".
    if (!issueNo) {
      m = cover.match(/#\s?(\d{1,4})\b/);
      if (m) issueNo = parseInt(m[1], 10);
    }
    if (!issueNo) {
      m = name.match(/(?:^|[_\s#-])0*(\d{1,4})[_\s-]*weekly/i) || name.match(/^_?0*(\d{1,4})[_\s-]/);
      if (m) issueNo = parseInt(m[1], 10);
    }
    if (!issueDate) {
      m = cover.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
      if (m && MONTHS[m[1].toLowerCase()]) {
        issueDate = `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(parseInt(m[2], 10))}`;
      }
    }

    const sections = [];
    const re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
    let h;
    const body = cutSignatures(parts[1]);
    while ((h = re.exec(body))) {
      const t = text(h[1]);
      if (t && !/^\[.*\]$/.test(t)) sections.push(t);
    }
    return { issueNo: issueNo, issueDate: issueDate, sections: sections };
  }

  function cutSignatures(html) {
    const i = html.search(/<p[^>]*>\s*(<[^>]+>\s*)*Signatures\s*:?/i);
    return i === -1 ? html : html.slice(0, i);
  }

  function clean(raw) {
    let html = splitCover(raw)[1];
    html = cutSignatures(html);
    // Empty paragraphs and trailing line breaks.
    html = html.replace(/<p[^>]*>(\s|&nbsp;|\u00a0|<br\s*\/?>)*<\/p>/gi, "");
    html = html.replace(/(<br\s*\/?>\s*)+<\/p>/gi, "</p>");
    // h1 → h2, h2 → h3, … (the portal page has its own h1).
    html = html.replace(/<(\/?)h([1-5])(\s|>)/gi, function (_, slash, level, after) {
      return "<" + slash + "h" + (parseInt(level, 10) + 1) + after;
    });
    return html.trim();
  }

  const api = { meta: meta, clean: clean, text: text };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IAABriefingConvert = api;
})(typeof window !== "undefined" ? window : this);
