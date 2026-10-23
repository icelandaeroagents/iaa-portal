/* Iceland Aero Agents – Staff Portal
   Roster reader. Takes the rows of one spreadsheet tab (an array of rows,
   each an array of cell texts) and finds the roster blocks laid out like
   "Vaktir IAA.xlsx":

     | October , 2026 | Thu | Fri | Sat | …      ← month header + weekdays
     |                | 1   | 2   | 3   | …      ← day numbers
     | 0630-1830      | Atli| Beggi -1600 | …    ← one row per shift / duty
     | BIAR RESP.     | AUÐUR | …
     …                                          ← block ends at the next
                                                  month header or a row
                                                  containing "SOD"

   Returns [{ dates: ["2026-10-01", …], rows: [{ label, values: [...], struck?: [...] }] }].
   readWorkbook() also fills merged cells (a name merged across several
   days counts for each of them) and marks crossed-out (strikethrough)
   cells, which are treated as cancelled.
   Works in the browser (window.IAARosterParse) and in Node. */

(function (root) {
  "use strict";

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december"];

  function clean(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function monthHeader(text) {
    const m = clean(text).match(/^([A-Za-z]+)\s*,?\s*(\d{4})$/);
    if (!m) return null;
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    return idx === -1 ? null : { month: idx, year: parseInt(m[2], 10) };
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // ------------------------------------------------------------------
  // Reading the Excel file with SheetJS
  // ------------------------------------------------------------------
  function decode(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }

  // Style indexes (s="…") whose font is struck through.
  function struckStyles(wb) {
    const out = new Set();
    try {
      const f = wb.files && (wb.files["xl/styles.xml"] || wb.files["/xl/styles.xml"]);
      if (!f) return out;
      const xml = decode(f.content);
      const fontsXml = (xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/) || [])[1] || "";
      const fonts = fontsXml.match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g) || [];
      const strikeFont = fonts.map((x) => /<strike\b(?![^>]*val="(0|false)")[^>]*\/?>/.test(x));
      const xfsXml = (xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
      const xfs = xfsXml.match(/<xf\b[^>]*?(\/>|>[\s\S]*?<\/xf>)/g) || [];
      xfs.forEach(function (xf, i) {
        const m = xf.match(/fontId="(\d+)"/);
        if (m && strikeFont[parseInt(m[1], 10)]) out.add(i);
      });
    } catch (e) { /* formatting is optional */ }
    return out;
  }

  // Cells (as "r,c") whose style is struck through, for one sheet.
  function struckCells(wb, sheetIndex, styles, XLSX) {
    const cells = new Set();
    if (!styles.size) return cells;
    try {
      const path = (wb.Directory && wb.Directory.sheets && wb.Directory.sheets[sheetIndex]) || "";
      const f = wb.files && (wb.files[path] || wb.files[path.replace(/^\//, "")]);
      if (!f) return cells;
      const xml = decode(f.content);
      const re = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>/g;
      let m;
      while ((m = re.exec(xml))) {
        const sm = m[0].match(/\bs="(\d+)"/);
        if (sm && styles.has(parseInt(sm[1], 10))) {
          const a = XLSX.utils.decode_cell(m[1]);
          cells.add(a.r + "," + a.c);
        }
      }
    } catch (e) { /* formatting is optional */ }
    return cells;
  }

  // → [{ name, rows: [[text…]…], flags: [[struck…]…] }]
  function readWorkbook(XLSX, data) {
    const wb = XLSX.read(data, { type: "array", bookFiles: true });
    const styles = struckStyles(wb);
    return wb.SheetNames.map(function (name, si) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true });
      const struck = struckCells(wb, si, styles, XLSX);
      const flags = rows.map((row, r) => row.map((_, c) => struck.has(r + "," + c)));
      (ws["!merges"] || []).forEach(function (mg) {
        const top = (rows[mg.s.r] || [])[mg.s.c];
        const topStruck = !!((flags[mg.s.r] || [])[mg.s.c]);
        for (let r = mg.s.r; r <= mg.e.r; r++) {
          rows[r] = rows[r] || [];
          flags[r] = flags[r] || [];
          for (let c = mg.s.c; c <= mg.e.c; c++) {
            if (r === mg.s.r && c === mg.s.c) continue;
            if (!clean(rows[r][c])) { rows[r][c] = top; flags[r][c] = topStruck; }
          }
        }
      });
      return { name: name, rows: rows, flags: flags };
    });
  }

  function blocks(rows, flags) {
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const head = monthHeader(row[c]);
        if (!head) continue;
        const dayRow = rows[r + 1] || [];
        // Day numbers sit in the columns to the right of the header.
        const cols = [];
        const dates = [];
        let month = head.month;
        let year = head.year;
        let prev = 0;
        for (let k = c + 1; k < dayRow.length; k++) {
          const d = parseInt(clean(dayRow[k]), 10);
          if (!d || d < 1 || d > 31) {
            if (cols.length) break;
            continue;
          }
          if (d < prev) { month += 1; if (month > 11) { month = 0; year += 1; } }
          prev = d;
          cols.push(k);
          dates.push(`${year}-${pad(month + 1)}-${pad(d)}`);
        }
        if (!cols.length) continue;

        const bodyRows = [];
        for (let rr = r + 2; rr < rows.length; rr++) {
          const line = rows[rr] || [];
          if (line.some((v) => clean(v).toUpperCase() === "SOD")) break;
          if (line.some((v) => monthHeader(v))) break;
          const label = clean(line[c]);
          const values = cols.map((k) => clean(line[k]));
          if (!label && values.every((v) => !v)) continue;
          const entry = { label: label, values: values };
          const fl = cols.map((k) => !!(flags && flags[rr] && flags[rr][k] && clean(line[k])));
          if (fl.some(Boolean)) entry.struck = fl;
          bodyRows.push(entry);
        }
        if (bodyRows.length) out.push({ dates: dates, rows: bodyRows });
        r += 1; // the day-number row (often merged with the header) is done
        break; // one header per row
      }
    }
    return out;
  }

  // Everything scheduled on one date, across a sheet's blocks.
  function day(sheetBlocks, isoDate) {
    for (const b of sheetBlocks) {
      const i = b.dates.indexOf(isoDate);
      if (i === -1) continue;
      return b.rows
        .filter((row) => !(row.struck && row.struck[i]))   // crossed out = cancelled
        .map((row) => ({ label: row.label, value: row.values[i] }))
        .filter((x) => x.value && !/^y(\/n)?$/i.test(x.value));
    }
    return null;
  }

  function range(sheetBlocks) {
    const all = sheetBlocks.reduce((a, b) => a.concat(b.dates), []).sort();
    return all.length ? { from: all[0], to: all[all.length - 1] } : null;
  }

  const api = { readWorkbook: readWorkbook, blocks: blocks, day: day, range: range };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IAARosterParse = api;
})(typeof window !== "undefined" ? window : this);
