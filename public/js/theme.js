// Applies the saved/OS theme before first paint (loaded in <head> to avoid a flash).
(function () {
  var t = null;
  try { t = localStorage.getItem("sv_theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
})();
