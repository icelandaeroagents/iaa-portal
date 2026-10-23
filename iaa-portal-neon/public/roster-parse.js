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
   readWorkbook() also fills merged cells and coloured spans (a name
   merged or coloured across several days counts for each of them) and
   marks crossed-out (strikethrough) cells, which are treated as cancelled.
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

  // From styles.xml: which style indexes are struck through, and a
  // "colour key" per style index (null for no fill).
  function styleInfo(wb) {
    const info = { strike: new Set(), fill: [] };
    try {
      const f = wb.files && (wb.files["xl/styles.xml"] || wb.files["/xl/styles.xml"]);
      if (!f) return info;
      const xml = decode(f.content);
      const fontsXml = (xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/) || [])[1] || "";
      const fonts = fontsXml.match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g) || [];
      const strikeFont = fonts.map((x) => /<strike\b(?![^>]*val="(0|false)")[^>]*\/?>/.test(x));
      const fillsXml = (xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/) || [])[1] || "";
      const fills = (fillsXml.match(/<fill\b[^>]*\/>|<fill\b[^>]*>[\s\S]*?<\/fill>/g) || []).map(function (x) {
        if (!/patternType="solid"/.test(x)) return null;       // none / gray125 = no colour
        const fg = (x.match(/<fgColor\b[^>]*\/?>/) || [""])[0];
        return fg.replace(/\s+/g, " ") || null;
      });
      const xfsXml = (xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
      const xfs = xfsXml.match(/<xf\b[^>]*?(\/>|>[\s\S]*?<\/xf>)/g) || [];
      xfs.forEach(function (xf, i) {
        const fm = xf.match(/fontId="(\d+)"/);
        if (fm && strikeFont[parseInt(fm[1], 10)]) info.strike.add(i);
        const fl = xf.match(/fillId="(\d+)"/);
        info.fill[i] = fl ? fills[parseInt(fl[1], 10)] || null : null;
      });
    } catch (e) { /* formatting is optional */ }
    return info;
  }

  // Style index of every styled cell in one sheet, keyed "row,col" (absolute).
  function cellStyles(wb, sheetIndex, XLSX) {
    const map = new Map();
    try {
      const path = (wb.Directory && wb.Directory.sheets && wb.Directory.sheets[sheetIndex]) || "";
      const f = wb.files && (wb.files[path] || wb.files[path.replace(/^\//, "")]);
      if (!f) return map;
      const xml = decode(f.content);
      const re = /<c\b[^>]*>/g;
      let m;
      while ((m = re.exec(xml))) {
        const rm = m[0].match(/\br="([A-Z]+\d+)"/);
        const sm = m[0].match(/\bs="(\d+)"/);
        if (rm && sm) {
          const a = XLSX.utils.decode_cell(rm[1]);
          map.set(a.r + "," + a.c, parseInt(sm[1], 10));
        }
      }
    } catch (e) { /* formatting is optional */ }
    return map;
  }

  // → [{ name, rows: [[text…]…], flags: [[struck…]…] }]
  function readWorkbook(XLSX, data) {
    const wb = XLSX.read(data, { type: "array", bookFiles: true });
    const info = styleInfo(wb);
    return wb.SheetNames.map(function (name, si) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true });
      // sheet_to_json starts at the sheet's used area, which may not be A1.
      const origin = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s : { r: 0, c: 0 };
      const styles = cellStyles(wb, si, XLSX);
      const styleAt = (r, c) => styles.get((r + origin.r) + "," + (c + origin.c));
      const width = rows.reduce((m, row) => Math.max(m, row.length), 0);
      rows.forEach((row) => { while (row.length < width) row.push(""); });
      const flags = rows.map((row, r) => row.map((_, c) => info.strike.has(styleAt(r, c))));

      // 1. Merged cells: the name counts for every cell of the merge.
      (ws["!merges"] || []).forEach(function (mg) {
        const r0 = mg.s.r - origin.r, c0 = mg.s.c - origin.c;
        if (r0 < 0 || c0 < 0 || !rows[r0]) return;
        const top = rows[r0][c0];
        const topStruck = !!flags[r0][c0];
        for (let r = r0; r <= mg.e.r - origin.r && r < rows.length; r++) {
          for (let c = c0; c <= mg.e.c - origin.c && c < width; c++) {
            if (r === r0 && c === c0) continue;
            if (!clean(rows[r][c])) { rows[r][c] = top; flags[r][c] = topStruck; }
          }
        }
      });

      // 2. Coloured spans: a run of same-coloured cells holding a single
      //    name counts as that name for the whole run (wherever it is typed).
      rows.forEach(function (row, r) {
        let c = 0;
        while (c < width) {
          const key = info.fill[styleAt(r, c)] || null;
          let end = c;
          if (key) {
            while (end + 1 < width && (info.fill[styleAt(r, end + 1)] || null) === key) end++;
          }
          if (key && end > c) {
            // Only when the name is written once in the run (a span label like
            // "Theo"), so a coloured but empty cell next to daily names such as
            // "Cesar Cesar Cesar" is never filled in.
            const written = [];
            let struck = false;
            for (let k = c; k <= end; k++) {
              const v = clean(row[k]);
              if (v) { written.push(v); struck = struck || !!flags[r][k]; }
            }
            if (written.length === 1) {
              const names = written;
              for (let k = c; k <= end; k++) {
                if (!clean(row[k])) { row[k] = names[0]; flags[r][k] = struck; }
              }
            }
          }
          c = end + 1;
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
