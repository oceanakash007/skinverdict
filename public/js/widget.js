/* SkinVerdict retailer widget.
   Add to any product page:
     <script src="https://YOUR-SKINVERDICT-URL/js/widget.js" defer></script>
     <div data-skinverdict data-name="Product name" data-ingredients="Aqua, Niacinamide, ..."></div>
   It renders a "Check against my skin" button that opens SkinVerdict with the product pre-filled. */
(function () {
  var me = document.currentScript;
  var origin = me ? new URL(me.src).origin : location.origin;
  function mount(el) {
    if (el.__sv) return;
    el.__sv = true;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "✨ Check against my skin";
    b.setAttribute("style", "font:600 14px system-ui,sans-serif;padding:11px 18px;border:0;border-radius:999px;cursor:pointer;color:#fff;background:linear-gradient(120deg,#2fbf8f,#8b6cf6 55%,#ff8a72);box-shadow:0 8px 20px -10px rgba(139,108,246,.8)");
    b.addEventListener("click", function () {
      var q = "name=" + encodeURIComponent((el.getAttribute("data-name") || "").slice(0, 120)) + "&ing=" + encodeURIComponent((el.getAttribute("data-ingredients") || "").slice(0, 3000)) + "&src=widget";
      window.open(origin + "/#decide?" + q, "_blank", "noopener");
    });
    var note = document.createElement("div");
    note.textContent = "Personal verdict from your own skin scan · powered by YouCam AI";
    note.setAttribute("style", "font:12px system-ui,sans-serif;color:#667;margin-top:6px");
    el.appendChild(b);
    el.appendChild(note);
  }
  function scan() { document.querySelectorAll("[data-skinverdict]").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
