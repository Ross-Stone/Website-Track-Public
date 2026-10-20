// Applies the saved theme before first paint so there is no flash (FR-SET-03). External file: the CSP forbids inline scripts.
(function () {
  try {
    var t = localStorage.getItem('track.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* storage unavailable: keep the default */
  }
})();
