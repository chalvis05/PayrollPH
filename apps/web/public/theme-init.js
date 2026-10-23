// Apply the saved theme before first paint to avoid a light/dark flash. Loaded as a classic,
// render-blocking script (not inline) so the Content-Security-Policy can stay script-src 'self'.
(function () {
  var pref = 'system';
  try {
    var saved = localStorage.getItem('payrollph.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') pref = saved;
  } catch {
    /* storage unavailable */
  }
  var dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
