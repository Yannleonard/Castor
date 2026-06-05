/* ==========================================================================
   Castor — marketing site interactions (vanilla JS, no framework)
   - announcement dismiss (persisted)
   - sticky navbar scroll state
   - mobile nav toggle
   - install tabs (docker run / compose)
   - FAQ accordion (single-open)
   - copy-to-clipboard with toast
   - IntersectionObserver scroll reveals + dashboard bar animation
   ========================================================================== */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ----------------------------------------------------------------------
     1. Announcement bar (dismiss, remembered)
     ---------------------------------------------------------------------- */
  (function () {
    var bar = $("#announce");
    var close = $("#announce-close");
    if (!bar || !close) return;
    var KEY = "castor-announce-dismissed";
    try {
      if (localStorage.getItem(KEY) === "1") bar.classList.add("is-hidden");
    } catch (e) {}
    close.addEventListener("click", function () {
      bar.classList.add("is-hidden");
      try {
        localStorage.setItem(KEY, "1");
      } catch (e) {}
    });
  })();

  /* ----------------------------------------------------------------------
     2. Sticky navbar — add shadow once scrolled
     ---------------------------------------------------------------------- */
  (function () {
    var nav = $("#nav");
    if (!nav) return;
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  })();

  /* ----------------------------------------------------------------------
     3. Mobile nav toggle
     ---------------------------------------------------------------------- */
  (function () {
    var nav = $("#nav");
    var toggle = $("#nav-toggle");
    var links = $("#nav-links");
    if (!nav || !toggle || !links) return;

    var setOpen = function (open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    };

    toggle.addEventListener("click", function () {
      setOpen(!nav.classList.contains("is-open"));
    });

    // Close when a nav link or action button is clicked
    $$("a", links).forEach(function (a) {
      a.addEventListener("click", function () {
        setOpen(false);
      });
    });
    var actions = $("#nav-actions");
    if (actions) {
      $$("a", actions).forEach(function (a) {
        a.addEventListener("click", function () {
          setOpen(false);
        });
      });
    }

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) setOpen(false);
    });

    // Reset state if resized back to desktop
    window.addEventListener("resize", function () {
      if (window.innerWidth > 920 && nav.classList.contains("is-open")) setOpen(false);
    });
  })();

  /* ----------------------------------------------------------------------
     4. Install tabs
     ---------------------------------------------------------------------- */
  (function () {
    var tablist = $('[role="tablist"]');
    if (!tablist) return;
    var tabs = $$('[role="tab"]', tablist);

    function activate(tab) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute("aria-selected", selected ? "true" : "false");
        t.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) {
          panel.classList.toggle("is-active", selected);
          if (selected) {
            panel.removeAttribute("hidden");
          } else {
            panel.setAttribute("hidden", "");
          }
        }
      });
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        activate(tab);
      });
      // Arrow-key navigation for accessibility
      tab.addEventListener("keydown", function (e) {
        var idx = null;
        if (e.key === "ArrowRight") idx = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") idx = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") idx = 0;
        else if (e.key === "End") idx = tabs.length - 1;
        if (idx !== null) {
          e.preventDefault();
          tabs[idx].focus();
          activate(tabs[idx]);
        }
      });
    });
  })();

  /* ----------------------------------------------------------------------
     5. FAQ accordion — single-open
     ---------------------------------------------------------------------- */
  (function () {
    var items = $$(".faq__item");
    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (item.open) {
          items.forEach(function (other) {
            if (other !== item) other.open = false;
          });
        }
      });
    });
  })();

  /* ----------------------------------------------------------------------
     6. Copy-to-clipboard with toast
     ---------------------------------------------------------------------- */
  (function () {
    var toast = $("#toast");
    var toastMsg = $("#toast-msg");
    var toastTimer = null;

    function showToast(msg) {
      if (!toast) return;
      if (toastMsg) toastMsg.textContent = msg;
      toast.classList.add("is-visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove("is-visible");
      }, 2000);
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback for non-secure contexts
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "absolute";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }

    $$(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var targetId = btn.getAttribute("data-copy-target");
        var el = targetId && document.getElementById(targetId);
        if (!el) return;
        // innerText preserves line breaks; trim trailing whitespace
        var text = (el.innerText || el.textContent || "").replace(/\s+$/, "");
        copyText(text).then(
          function () {
            var original = btn.querySelector("svg") ? null : btn.textContent;
            btn.classList.add("is-copied");
            // Swap label text node (keep the icon)
            var labelNode = lastTextNode(btn);
            var prev = labelNode ? labelNode.nodeValue : null;
            if (labelNode) labelNode.nodeValue = "Copied!";
            showToast("Copied to clipboard");
            setTimeout(function () {
              btn.classList.remove("is-copied");
              if (labelNode && prev !== null) labelNode.nodeValue = prev;
              if (original !== null) btn.textContent = original;
            }, 1800);
          },
          function () {
            showToast("Press Ctrl/⌘+C to copy");
          }
        );
      });
    });

    function lastTextNode(node) {
      var nodes = node.childNodes;
      for (var i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) return nodes[i];
      }
      return null;
    }
  })();

  /* ----------------------------------------------------------------------
     7. Scroll reveals + dashboard bar fill (IntersectionObserver)
     ---------------------------------------------------------------------- */
  (function () {
    var reveals = $$(".reveal");

    // Animate dashboard bars from their data-w when the dashboard enters view
    function fillBars(scope) {
      $$(".bar__fill", scope).forEach(function (el) {
        var w = el.getAttribute("data-w");
        if (w) el.style.width = w;
      });
    }

    if (prefersReduced || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) {
        el.classList.add("is-visible");
      });
      fillBars(document);
      return;
    }

    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          if (entry.target.querySelector && entry.target.querySelector(".bar__fill")) {
            fillBars(entry.target);
          }
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );

    reveals.forEach(function (el) {
      io.observe(el);
    });

    // Kick the hero dashboard bars shortly after load (it may already be in view)
    var dash = $(".dash");
    if (dash) {
      setTimeout(function () {
        fillBars(dash);
      }, 350);
    }
  })();

  /* ----------------------------------------------------------------------
     8. Current year (footer safety, in case copy is reused)
     ---------------------------------------------------------------------- */
  (function () {
    $$("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  })();
})();
