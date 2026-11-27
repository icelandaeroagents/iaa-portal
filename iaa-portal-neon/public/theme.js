/* Iceland Aero Agents – Staff Portal
   Day / Night: applied before the page draws, so it never flashes the
   wrong colours. "auto" (the default) follows the device's own setting. */
(function () {
  try {
    var t = localStorage.getItem("iaa-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* storage off: follow the device */ }
})();
