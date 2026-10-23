/* Iceland Aero Agents – Staff Portal
   Reports section: submit internal reports (with photos), read previous
   reports, and – for management – follow them up.
   The portal shell (app.js) calls IAAReports.render(main, ctx). */

(function () {
  "use strict";

  const TYPES = [
    ["incident", "Incident"],
    ["near_miss", "Near miss"],
    ["injury", "Injury"],
    ["aircraft_damage", "Aircraft damage"],
    ["equipment_damage", "Equipment (GSE) damage"],
    ["hazard", "Safety hazard"],
    ["security", "Security"],
    ["customer_complaint", "Customer complaint"],
    ["other", "Other"]
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const SEVERITY = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
  const SEVERITY_LABEL = Object.fromEntries(SEVERITY);
  const STATUS = [["new", "New"], ["under_review", "Under review"], ["actions_agreed", "Actions agreed"], ["closed", "Closed"]];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const MAX_PHOTOS = 6;
  const PHOTO_EDGE = 1600;

  let filters = { station: "All", type: "All", status: "All" };
  let notice = null;
  let lastSubmitted = null;

  window.IAAReports = { render: render };

  async function render(main, ctx) {
    const parts = location.hash.replace(/^#\/reports\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "new") return showForm(main, ctx);
    if (parts[0] === "sent") return showSent(main, ctx);
    if (parts[0] && /^\d+$/.test(parts[0])) return showReport(main, ctx, parts[0]);
    return showList(main, ctx);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function number(id) {
    return "R-" + String(id).padStart(4, "0");
  }

  function fmt(iso, withTime) {
    if (!iso) return "";
    const opts = { day: "numeric", month: "short", year: "numeric", timeZone: "Atlantic/Reykjavik" };
    if (withTime !== false) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
    try { return new Date(iso).toLocaleString("en-GB", opts); } catch (e) { return iso; }
  }

  function localNow() {
    const d = new Date();
    d.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }

  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  function statusChip(ctx, status) {
    return ctx.h("span", { class: "chip chip-status-" + status }, STATUS_LABEL[status] || status);
  }

  function severityChip(ctx, sev) {
    if (!sev) return ctx.h("span", { class: "sub" }, "–");
    return ctx.h("span", { class: "chip chip-sev-" + sev }, SEVERITY_LABEL[sev]);
  }

  // Reads an image file, shrinks it to at most PHOTO_EDGE pixels on its
  // longest side and returns it as base64 JPEG.
  function preparePhoto(file) {
    return new Promise(function (resolve, reject) {
      const fail = function () { reject(new Error(`“${file.name}” couldn’t be read. Use a JPEG or PNG photo.`)); };
      const reader = new FileReader();
      reader.onerror = fail;
      reader.onload = function () {
        const img = new Image();
        img.onerror = fail;
        img.onload = function () {
          const scale = Math.min(1, PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const hgt = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = hgt;
          canvas.getContext("2d").drawImage(img, 0, 0, w, hgt);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ mime: "image/jpeg", data: dataUrl.split(",")[1], width: w, height: hgt, preview: dataUrl, name: file.name });
        };
        img.src = reader.result; // a data: address, which the security settings allow
      };
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------------
  // List of reports
  // ------------------------------------------------------------------
  async function showList(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    fill(main, pageHead("Reports"), h("p", { class: "empty" }, "Loading reports…"));

    const res = await ctx.db
      .from("reports")
      .select("id, created_at, report_type, occurred_at, station_code, location, severity, status, reporter_display, injuries, damage")
      .order("occurred_at", { ascending: false });
    if (res.error) throw res.error;
    const all = res.data || [];
    const shown = all.filter((r) =>
      (filters.station === "All" || r.station_code === filters.station) &&
      (filters.type === "All" || r.report_type === filters.type) &&
      (filters.status === "All" || r.status === filters.status)
    );

    function filterSelect(id, label, key, options) {
      return h(
        "div",
        { class: "field" },
        h("label", { for: id }, label),
        h(
          "select",
          { id: id, onchange: function (e) { filters[key] = e.target.value; showList(main, ctx); } },
          h("option", { value: "All", selected: filters[key] === "All" }, "All"),
          options.map((o) => h("option", { value: o[0], selected: filters[key] === o[0] }, o[1]))
        )
      );
    }

    const rows = shown.map((r) =>
      h(
        "tr",
        { class: "row-link" },
        h("td", null, h("a", { href: "#/reports/" + r.id, class: "report-no" }, number(r.id))),
        h("td", null, fmt(r.occurred_at)),
        h("td", null, TYPE_LABEL[r.report_type] || r.report_type,
          (r.injuries || r.damage) ? h("span", { class: "sub" }, [r.injuries ? "Injuries" : null, r.damage ? "Damage" : null].filter(Boolean).join(", ")) : null),
        h("td", null, r.station_code || "–", r.location ? h("span", { class: "sub" }, r.location) : null),
        h("td", null, severityChip(ctx, r.severity)),
        h("td", null, statusChip(ctx, r.status))
      )
    );

    fill(
      main,
      h(
        "div",
        { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Reports"), h("p", null, "Incidents, near misses, hazards and other internal reports. Everyone on the staff can read them.")),
        h("a", { class: "btn", href: "#/reports/new" }, "New report")
      ),
      noticeBox(ctx),
      h(
        "div",
        { class: "row" },
        filterSelect("f-station", "Station", "station", state.stations.map((s) => [s.code, s.code])),
        filterSelect("f-type", "Type", "type", TYPES),
        filterSelect("f-status", "Status", "status", STATUS)
      ),
      h(
        "section",
        { class: "panel" },
        shown.length
          ? h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                null,
                h("thead", null, h("tr", null, h("th", null, "Report"), h("th", null, "Date and time"), h("th", null, "Type"), h("th", null, "Station"), h("th", null, "Severity"), h("th", null, "Status"))),
                h("tbody", null, rows)
              )
            )
          : h("p", { class: "empty" }, all.length ? "No reports match these filters." : "No reports yet. Use New report to submit the first one.")
      )
    );
  }

  // ------------------------------------------------------------------
  // New report
  // ------------------------------------------------------------------
  function showForm(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    const photos = [];
    const mine = state.profile.station_codes || [];
    const stations = state.stations.filter((s) => s.active);
    const orderedStations = stations.filter((s) => mine.indexOf(s.code) !== -1).concat(stations.filter((s) => mine.indexOf(s.code) === -1));

    const f = {};
    function text(id, attrs) { f[id] = h("input", Object.assign({ id: "r-" + id, type: "text", autocomplete: "off" }, attrs || {})); return f[id]; }
    function area(id, attrs) { f[id] = h("textarea", Object.assign({ id: "r-" + id, rows: "3" }, attrs || {})); return f[id]; }
    function field(id, label, input, help, required) {
      return h(
        "div",
        { class: "field field-wide" },
        h("label", { for: "r-" + id }, label, required ? h("span", { class: "req" }, " (required)") : null),
        help ? h("span", { class: "help" }, help) : null,
        input
      );
    }
    function yesNo(name, label, detailsId, detailsLabel) {
      const yes = h("input", { type: "radio", name: name, value: "yes" });
      const no = h("input", { type: "radio", name: name, value: "no", checked: true });
      const details = area(detailsId, { rows: "2" });
      const detailsField = h("div", { class: "field field-wide is-hidden" }, h("label", { for: "r-" + detailsId }, detailsLabel), details);
      const toggle = function () { detailsField.classList.toggle("is-hidden", !yes.checked); };
      yes.addEventListener("change", toggle);
      no.addEventListener("change", toggle);
      f[name] = yes;
      return h(
        "div",
        { class: "field field-wide" },
        h("span", { class: "field-label" }, label),
        h("div", { class: "choice-row", role: "radiogroup", "aria-label": label },
          h("label", { class: "choice" }, no, h("span", null, "No")),
          h("label", { class: "choice" }, yes, h("span", null, "Yes"))),
        detailsField
      );
    }

    f.type = h("select", { id: "r-type", required: true },
      h("option", { value: "", selected: true }, "Choose…"),
      TYPES.map((t) => h("option", { value: t[0] }, t[1])));
    f.occurred = h("input", { id: "r-occurred", type: "datetime-local", required: true, value: localNow(), max: localNow() });
    f.station = h("select", { id: "r-station" },
      orderedStations.map((s, i) => h("option", { value: s.code, selected: i === 0 }, `${s.code} – ${s.name}`)),
      h("option", { value: "" }, "Not at a station"));
    const severityInputs = SEVERITY.map((s) => h("input", { type: "radio", name: "severity", value: s[0] }));
    f.hide = h("input", { type: "checkbox", id: "r-hide" });

    // Photos
    const photoInput = h("input", { id: "r-photos", type: "file", accept: "image/*", multiple: true, class: "file-input" });
    const photoList = h("div", { class: "photo-grid" });
    const photoStatus = h("p", { class: "status", role: "status" });
    function drawPhotos() {
      photoList.replaceChildren();
      photos.forEach(function (p, i) {
        photoList.append(
          h("figure", { class: "photo" },
            h("img", { src: p.preview, alt: "Photo " + (i + 1) }),
            h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { photos.splice(i, 1); drawPhotos(); } }, "Remove"))
        );
      });
      photoInput.disabled = photos.length >= MAX_PHOTOS;
    }
    photoInput.addEventListener("change", async function () {
      const files = Array.from(photoInput.files || []);
      photoInput.value = "";
      for (const file of files) {
        if (photos.length >= MAX_PHOTOS) { setStatus(photoStatus, `You can attach up to ${MAX_PHOTOS} photos.`, true); break; }
        try {
          setStatus(photoStatus, "Preparing photo…");
          photos.push(await preparePhoto(file));
          setStatus(photoStatus, "");
        } catch (err) {
          setStatus(photoStatus, err.message, true);
        }
      }
      drawPhotos();
    });

    const formStatus = h("p", { class: "status", role: "status" });
    const submit = h("button", { class: "btn", type: "submit" }, "Submit report");

    const form = h(
      "form",
      {
        class: "report-form",
        novalidate: true,
        onsubmit: async function (e) {
          e.preventDefault();
          if (!f.type.value) { setStatus(formStatus, "Choose the report type.", true); f.type.focus(); return; }
          if (!f.occurred.value) { setStatus(formStatus, "Enter when it happened.", true); f.occurred.focus(); return; }
          if (!f.description.value.trim()) { setStatus(formStatus, "Describe what happened.", true); f.description.focus(); return; }
          const occurred = new Date(f.occurred.value);
          if (isNaN(occurred.getTime())) { setStatus(formStatus, "The date and time isn’t valid.", true); return; }

          const sev = severityInputs.find((x) => x.checked);
          const val = (el) => (el.value.trim() ? el.value.trim() : null);
          const row = {
            report_type: f.type.value,
            occurred_at: occurred.toISOString(),
            station_code: f.station.value || null,
            location: val(f.location),
            description: f.description.value.trim(),
            people_involved: val(f.people),
            aircraft_registration: val(f.reg) ? val(f.reg).toUpperCase() : null,
            aircraft_type: val(f.actype),
            flight_number: val(f.flight) ? val(f.flight).toUpperCase() : null,
            operator: val(f.operator),
            equipment: val(f.equipment),
            witnesses: val(f.witnesses),
            conditions: val(f.conditions),
            injuries: f.injuries.checked,
            injury_details: f.injuries.checked ? val(f.injury_details) : null,
            damage: f.damage.checked,
            damage_details: f.damage.checked ? val(f.damage_details) : null,
            consequences: val(f.consequences),
            immediate_actions: val(f.actions),
            severity: sev ? sev.value : null,
            suggestion: val(f.suggestion),
            reporter_display: f.hide.checked ? "withheld" : null
          };

          submit.disabled = true;
          setStatus(formStatus, "Submitting…");
          const ins = await ctx.db.from("reports").insert(row).select("id").single();
          if (ins.error) {
            submit.disabled = false;
            setStatus(formStatus, "The report wasn’t submitted: " + ins.error.message, true);
            return;
          }
          const id = ins.data.id;

          let photoFails = 0;
          for (let i = 0; i < photos.length; i++) {
            setStatus(formStatus, `Uploading photo ${i + 1} of ${photos.length}…`);
            const p = photos[i];
            const up = await ctx.db.from("report_photos").insert({ report_id: id, mime: p.mime, data: p.data, width: p.width, height: p.height });
            if (up.error) photoFails += 1;
          }

          setStatus(formStatus, "Emailing management…");
          let emailed = false;
          try {
            const r = await fetch("/api/report-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) });
            const j = await r.json();
            emailed = r.ok && (j.status === "sent" || /already/.test(j.status || ""));
          } catch (err) {
            emailed = false;
          }

          lastSubmitted = { id: id, photos: photos.length - photoFails, photoFails: photoFails, emailed: emailed };
          go("#/reports/sent");
        }
      },

      h("section", { class: "panel", "aria-labelledby": "s1" },
        h("h2", { id: "s1" }, "What happened"),
        h("div", { class: "form-grid" },
          field("type", "Report type", f.type, null, true),
          field("occurred", "Date and time it happened", f.occurred, "Iceland time.", true),
          field("station", "Station", f.station),
          field("location", "Location", text("location", { placeholder: "e.g. Stand 3, Apron 1 North, FBO lounge, vehicle" }))
        ),
        field("description", "Description", area("description", { rows: "5" }), "What happened, in the order it happened.", true),
        field("people", "Who was involved", area("people", { rows: "2", placeholder: "e.g. tug driver, marshaller, aircraft crew, passenger, fuel contractor" }),
          "All staff can read reports, so describe people by their role where you can. Management can always ask for names.")
      ),

      h("section", { class: "panel", "aria-labelledby": "s2" },
        h("h2", { id: "s2" }, "Aircraft, equipment and conditions"),
        h("p", { class: "fineprint" }, "Fill in what applies and leave the rest empty."),
        h("div", { class: "form-grid" },
          field("reg", "Aircraft registration", text("reg", { placeholder: "e.g. N123AB", autocapitalize: "characters" })),
          field("actype", "Aircraft type", text("actype", { placeholder: "e.g. G650" })),
          field("flight", "Flight number or callsign", text("flight", { autocapitalize: "characters" })),
          field("operator", "Operator or customer", text("operator")),
          field("equipment", "Equipment involved", text("equipment", { placeholder: "e.g. GPU 2, air-stairs, tug, vehicle" })),
          field("witnesses", "Witnesses", text("witnesses"))
        ),
        field("conditions", "Conditions at the time", area("conditions", { rows: "2", placeholder: "e.g. strong crosswind, ice on apron, darkness, low visibility" }))
      ),

      h("section", { class: "panel", "aria-labelledby": "s3" },
        h("h2", { id: "s3" }, "Outcome"),
        yesNo("injuries", "Was anyone injured?", "injury_details", "Injury details"),
        yesNo("damage", "Was anything damaged?", "damage_details", "What was damaged, and how"),
        field("consequences", "Consequences", area("consequences", { placeholder: "e.g. delay to departure, cost, customer impact" })),
        field("actions", "Immediate actions taken", area("actions")),
        h("div", { class: "field field-wide" },
          h("span", { class: "field-label" }, "How serious was it, in your view?"),
          h("div", { class: "choice-row", role: "radiogroup", "aria-label": "Severity" },
            SEVERITY.map((s, i) => h("label", { class: "choice" }, severityInputs[i], h("span", null, s[1]))))),
        field("suggestion", "Suggestion for improvement", area("suggestion"), "What would stop this from happening again?")
      ),

      h("section", { class: "panel", "aria-labelledby": "s4" },
        h("h2", { id: "s4" }, "Photos"),
        h("p", { class: "fineprint" }, `Up to ${MAX_PHOTOS} photos. They’re attached to the email to management and can be seen by staff with the report.`),
        h("label", { for: "r-photos", class: "btn btn-quiet file-label" }, "Add photos"),
        photoInput,
        photoList,
        photoStatus
      ),

      h("section", { class: "panel", "aria-labelledby": "s5" },
        h("h2", { id: "s5" }, "Submit"),
        h("label", { class: "choice" }, f.hide, h("span", null, "Withhold my name from other staff. Management will still see who reported it.")),
        h("div", { class: "row" }, submit, h("a", { class: "btn btn-quiet", href: "#/reports" }, "Cancel")),
        formStatus
      )
    );

    form.addEventListener("input", function () {
      if (formStatus.classList.contains("is-error")) setStatus(formStatus, "");
    });

    fill(main, pageHead("New report", "Report anything that went wrong, nearly went wrong, or could go wrong."), form);
    drawPhotos();
  }

  function showSent(main, ctx) {
    const { h, fill } = ctx;
    const s = lastSubmitted;
    if (!s) return go("#/reports");
    fill(
      main,
      h("div", { class: "page-head" }, h("h1", null, `Report ${number(s.id)} submitted`), h("p", null, "Thank you for reporting.")),
      h(
        "section",
        { class: "panel" },
        h("ul", { class: "plain-list" },
          h("li", null, s.emailed ? "Management has been emailed." : "Management will be emailed within the next few minutes."),
          s.photos ? h("li", null, `${s.photos} ${s.photos === 1 ? "photo" : "photos"} attached.`) : null,
          s.photoFails ? h("li", { class: "is-error" }, `${s.photoFails} ${s.photoFails === 1 ? "photo" : "photos"} couldn’t be uploaded. Open the report to add them again within 2 hours.`) : null),
        h("div", { class: "row" },
          h("a", { class: "btn", href: "#/reports/" + s.id }, "View the report"),
          h("a", { class: "btn btn-quiet", href: "#/reports" }, "Back to reports"))
      )
    );
  }

  // ------------------------------------------------------------------
  // One report
  // ------------------------------------------------------------------
  async function showReport(main, ctx, id) {
    const { h, fill, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, h("p", { class: "empty" }, "Loading report…"));

    const [rRes, pRes, whoRes] = await Promise.all([
      ctx.db.from("reports").select("*").eq("id", id),
      ctx.db.from("report_photos").select("id, mime, data, width, height").eq("report_id", id).order("id"),
      ctx.db.from("report_reporters").select("*").eq("report_id", id)
    ]);
    if (rRes.error) throw rRes.error;
    const r = (rRes.data || [])[0];
    if (!r) {
      notice = { text: "That report doesn’t exist.", isError: true };
      return go("#/reports");
    }
    const photos = pRes.error ? [] : (pRes.data || []);
    const who = whoRes.error ? null : (whoRes.data || [])[0];
    const isReporter = who && who.reporter_id === state.profile.id;
    const station = state.stations.find((s) => s.code === r.station_code);

    function fact(label, value) {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      return [h("dt", null, label), h("dd", { class: "prewrap" }, value)];
    }

    const facts = h(
      "dl",
      { class: "facts report-facts" },
      fact("Type", TYPE_LABEL[r.report_type]),
      fact("Date and time", fmt(r.occurred_at) + " (Iceland time)"),
      fact("Station", station ? `${station.code} – ${station.name}` : r.station_code || "Not at a station"),
      fact("Location", r.location),
      fact("Severity", SEVERITY_LABEL[r.severity] || "Not given"),
      fact("Who was involved", r.people_involved),
      fact("Aircraft", [r.aircraft_registration, r.aircraft_type].filter(Boolean).join(", ")),
      fact("Flight number or callsign", r.flight_number),
      fact("Operator or customer", r.operator),
      fact("Equipment involved", r.equipment),
      fact("Witnesses", r.witnesses),
      fact("Conditions", r.conditions),
      fact("Injuries", r.injuries ? "Yes" + (r.injury_details ? ": " + r.injury_details : "") : "No"),
      fact("Damage", r.damage ? "Yes" + (r.damage_details ? ": " + r.damage_details : "") : "No"),
      fact("Consequences", r.consequences),
      fact("Immediate actions taken", r.immediate_actions),
      fact("Suggestion for improvement", r.suggestion),
      fact("Reported by", who ? who.reporter_name + (who.hide_name ? " (name withheld from other staff)" : "") : r.reporter_display),
      fact("Submitted", fmt(r.created_at))
    );

    // Photos
    const canAddPhotos = isManagement || (isReporter && Date.now() - new Date(r.created_at).getTime() < 2 * 3600 * 1000);
    const photoStatus = h("p", { class: "status", role: "status" });
    const addInput = h("input", { id: "add-photos", type: "file", accept: "image/*", multiple: true, class: "file-input" });
    addInput.addEventListener("change", async function () {
      const files = Array.from(addInput.files || []);
      addInput.value = "";
      for (const file of files) {
        try {
          setStatus(photoStatus, "Uploading…");
          const p = await preparePhoto(file);
          const up = await ctx.db.from("report_photos").insert({ report_id: r.id, mime: p.mime, data: p.data, width: p.width, height: p.height });
          if (up.error) { setStatus(photoStatus, up.error.message, true); return; }
        } catch (err) {
          setStatus(photoStatus, err.message, true);
          return;
        }
      }
      showReport(main, ctx, id);
    });

    const photoPanel = (photos.length || canAddPhotos)
      ? h(
          "section",
          { class: "panel", "aria-labelledby": "ph-h" },
          h("h2", { id: "ph-h" }, `Photos: ${photos.length}`),
          photos.length
            ? h("div", { class: "photo-grid" }, photos.map((p, i) =>
                h("a", { class: "photo", href: "data:" + p.mime + ";base64," + p.data, download: `${number(r.id)}-photo-${i + 1}.jpg`, title: "Download photo " + (i + 1) },
                  h("img", { src: "data:" + p.mime + ";base64," + p.data, alt: "Photo " + (i + 1) + " for report " + number(r.id) }))))
            : null,
          canAddPhotos
            ? h("div", null, h("label", { for: "add-photos", class: "btn btn-quiet file-label" }, "Add photos"), addInput)
            : null,
          photoStatus
        )
      : null;

    fill(
      main,
      h("a", { class: "back-link", href: "#/reports" }, "All reports"),
      h(
        "div",
        { class: "page-head page-head-row" },
        h("div", null, h("h1", null, `${number(r.id)} · ${TYPE_LABEL[r.report_type]}`), h("p", null, `${r.station_code || "No station"}${r.location ? " · " + r.location : ""}`)),
        statusChip(ctx, r.status)
      ),
      noticeBox(ctx),
      h("section", { class: "panel" }, h("h2", null, "Description"), h("p", { class: "prewrap" }, r.description)),
      h("section", { class: "panel" }, h("h2", null, "Details"), facts),
      photoPanel,
      isManagement ? await managementPanel(main, ctx, r) : null
    );
  }

  async function managementPanel(main, ctx, r) {
    const { h, setStatus, state } = ctx;
    const [notesRes, peopleRes] = await Promise.all([
      ctx.db.from("report_notes").select("*").eq("report_id", r.id).order("created_at"),
      ctx.db.from("profiles").select("id, full_name, email, role, active").eq("role", "management")
    ]);
    const notes = notesRes.data || [];
    const managers = (peopleRes.data || []).filter((p) => p.active);

    const status = h("select", { id: "m-status" }, STATUS.map((s) => h("option", { value: s[0], selected: r.status === s[0] }, s[1])));
    const owner = h("select", { id: "m-owner" },
      h("option", { value: "", selected: !r.owner_id }, "Nobody yet"),
      managers.map((p) => h("option", { value: p.id, selected: r.owner_id === p.id }, p.full_name || p.email)));
    const flag = h("input", { type: "checkbox", id: "m-flag", checked: r.authority_flag });
    const saveStatus = h("p", { class: "status", role: "status" });
    const save = h("button", {
      class: "btn",
      type: "button",
      onclick: async function () {
        const changes = { status: status.value, owner_id: owner.value || null, authority_flag: flag.checked };
        save.disabled = true;
        const { error } = await ctx.db.from("reports").update(changes).eq("id", r.id);
        save.disabled = false;
        if (error) { setStatus(saveStatus, error.message, true); return; }
        await ctx.logEvent("report_followup_updated", { report_id: r.id, before: { status: r.status, owner_id: r.owner_id, authority_flag: r.authority_flag }, after: changes });
        notice = { text: "Follow-up saved." };
        showReport(main, ctx, String(r.id));
      }
    }, "Save follow-up");

    const noteBox = h("textarea", { id: "m-note", rows: "3", placeholder: "e.g. spoke to the team, agreed actions, outcome" });
    const noteStatus = h("p", { class: "status", role: "status" });
    const addNote = h("button", {
      class: "btn btn-quiet",
      type: "button",
      onclick: async function () {
        const note = noteBox.value.trim();
        if (!note) { setStatus(noteStatus, "Write a note first.", true); return; }
        addNote.disabled = true;
        const { error } = await ctx.db.from("report_notes").insert({ report_id: r.id, note: note });
        addNote.disabled = false;
        if (error) { setStatus(noteStatus, error.message, true); return; }
        showReport(main, ctx, String(r.id));
      }
    }, "Add note");

    const emailLine = r.notified_at
      ? `Emailed to management on ${fmt(r.notified_at)}.`
      : r.notify_error
        ? "The email hasn’t gone out yet: " + r.notify_error
        : "The email is waiting to be sent. It goes out within 10 minutes.";
    const resendStatus = h("p", { class: "status", role: "status" });
    const resend = h("button", {
      class: "btn btn-quiet btn-small",
      type: "button",
      onclick: async function () {
        if (r.notified_at && !confirm("Send the email for this report again?")) return;
        resend.disabled = true;
        const up = await ctx.db.from("reports").update({ notified_at: null, notify_error: null, notify_claimed_at: null }).eq("id", r.id);
        if (up.error) { resend.disabled = false; setStatus(resendStatus, up.error.message, true); return; }
        try {
          const res = await fetch("/api/report-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
          const j = await res.json();
          notice = { text: j.status === "sent" ? "Email sent again." : "The email couldn’t be sent. Check the email settings in Vercel.", isError: j.status !== "sent" };
        } catch (err) {
          notice = { text: "The email couldn’t be sent. It will be retried within 10 minutes.", isError: true };
        }
        showReport(main, ctx, String(r.id));
      }
    }, r.notified_at ? "Send email again" : "Send email now");

    return h(
      "section",
      { class: "panel panel-management", "aria-labelledby": "mg-h" },
      h("h2", { id: "mg-h" }, "Management follow-up"),
      h("p", { class: "fineprint" }, "Only management can see this section."),
      h("div", { class: "row" },
        h("div", { class: "field" }, h("label", { for: "m-status" }, "Status"), status),
        h("div", { class: "field" }, h("label", { for: "m-owner" }, "Owner"), owner)),
      h("label", { class: "choice" }, flag, h("span", null, "May need reporting to Samgöngustofa (EU 376/2014: within 72 hours of becoming aware)")),
      r.closed_at ? h("p", { class: "fineprint" }, "Closed on " + fmt(r.closed_at) + ".") : null,
      h("div", { class: "row" }, save),
      saveStatus,
      h("h3", null, "Notes"),
      notes.length
        ? h("ul", { class: "notes" }, notes.map((n) => h("li", null, h("p", { class: "prewrap" }, n.note), h("span", { class: "sub" }, `${n.author_name || "Management"} · ${fmt(n.created_at)}`))))
        : h("p", { class: "empty" }, "No notes yet."),
      h("div", { class: "field field-wide" }, h("label", { for: "m-note" }, "New note"), noteBox),
      h("div", { class: "row" }, addNote),
      noteStatus,
      h("h3", null, "Email"),
      h("p", { class: r.notify_error && !r.notified_at ? "status is-error" : "fineprint" }, emailLine),
      h("div", { class: "row" }, resend),
      resendStatus
    );
  }
})();
