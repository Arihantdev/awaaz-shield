(function () {
  var T = window.TERMS_TEXT, C = window.TERMS_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var sel = document.getElementById("lang");
  function pick() {
    var saved = null; try { saved = localStorage.getItem("terms.lang"); } catch (e) {}
    var want = qs.get("lang") || saved || (navigator.language || "en").slice(0, 2);
    return T[want] ? want : "en";
  }
  function slug(i) { return "s" + (i + 1); }
  function render(code) {
    var d = T[code] || T.en;
    document.documentElement.lang = code;
    document.title = "Awaaz Shield: " + d.title;
    document.getElementById("title").textContent = d.title;
    document.getElementById("sub").textContent = d.sub;
    document.getElementById("lang-label").textContent = d.langLabel;
    document.getElementById("ver-label").textContent = d.version;
    document.getElementById("ver").textContent = qs.get("v") || C.VERSION || "";
    document.getElementById("back").textContent = d.back;
    var toc = document.getElementById("toc"), box = document.getElementById("sections");
    toc.textContent = ""; box.textContent = "";
    d.sections.forEach(function (s, i) {
      var a = document.createElement("a"); a.href = "#" + slug(i); a.textContent = s.h; toc.appendChild(a);
      var sec = document.createElement("section"); sec.id = slug(i);
      var h = document.createElement("h2"); h.textContent = s.h; sec.appendChild(h);
      s.p.forEach(function (t) { var p = document.createElement("p"); p.textContent = t; sec.appendChild(p); });
      box.appendChild(sec);
    });
    var c = document.getElementById("contact");
    if (C.CONTACT_EMAIL) { c.hidden = false; c.textContent = ""; var a2 = document.createElement("a"); a2.href = "mailto:" + C.CONTACT_EMAIL; a2.textContent = C.CONTACT_EMAIL; c.appendChild(a2); } else { c.hidden = true; }
    sel.value = code;
  }
  sel.addEventListener("change", function () { try { localStorage.setItem("terms.lang", sel.value); } catch (e) {} render(sel.value); });
  render(pick());
})();
