// /public/js/logo-guard.js  — single guard + silent nav ping
(() => {
  "use strict";

  // --- API 라우터: /auth/*, /api/* 는 PROD_BACKEND로 보냄 ---
  const API_ORIGIN = window.PROD_BACKEND || window.API_BASE || null;
  const toAPI = (p) => {
    try {
      const u = new URL(p, location.href);
      if (API_ORIGIN && /^\/(?:auth|api)\//.test(u.pathname)) {
        const t = new URL(API_ORIGIN);
        t.pathname = u.pathname; t.search = u.search; t.hash = u.hash;
        return t.toString();
      }
      return u.toString();
    } catch { return p; }
  };

  const SELECTOR_LIST = [
    "#site-logo", "#logo",
    ".logo", ".logo a",
    ".logo-cta", ".logo-cta a",
    'a[rel="home"]', '[data-role="logo"]',
    "header.nav .logo-cta a"
  ];
  const SELECTOR = SELECTOR_LIST.join(", ");

  const NAV_KEY       = "auth:navigate";
  const AUTH_FLAG_KEY = "auth:flag";
  const FORCE_SAME_TAB = true;

  const absURL = (rel) => {
    try { return new URL(rel, location.href).toString(); }
    catch { return rel; }
  };

  // 404 안 남기는 조용한 nav-ping (중복 방지 + 로컬 호스트는 생략)
  let __navPingOnce = false;
  function navPingSilent() {
    if (__navPingOnce) return;
    __navPingOnce = true;

    const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (isLocal) return;

    try {
      const blob = new Blob(
        [JSON.stringify({ t: Date.now(), path: location.pathname })],
        { type: "application/json" }
      );
      if (navigator.sendBeacon && navigator.sendBeacon(toAPI("/auth/nav"), blob)) return;
    } catch {}

    try {
      const useNoCors = !API_ORIGIN; // 백엔드 없으면 GH Pages라 404 숨기기용
      fetch(toAPI("/auth/nav"), {
        method: "POST",
        keepalive: true,
        mode: useNoCors ? "no-cors" : "cors",
        credentials: useNoCors ? "omit" : "include",
        headers: useNoCors ? { "content-type": "text/plain" }
                            : { "content-type": "application/json" },
        body: useNoCors ? "" : "{}"
      }).catch(() => {});
    } catch {}
  }

  // location.assign/replace 패치: 모든 내부 이동에 네비 마크 남김
  (function hookLocation() {
    try {
      if (Location.prototype && Location.prototype.__audPatchedNav) return;
      const patch = (fn) => {
        const orig = location[fn].bind(location);
        location[fn] = function (href) {
          try {
            window.auth?.markNavigate?.();
            sessionStorage.setItem(NAV_KEY, String(Date.now()));
          } catch {}
          return orig(href);
        };
      };
      patch("assign"); patch("replace");
      if (Location.prototype) Location.prototype.__audPatchedNav = true; // ← 추가
    } catch {}
  })();

  function computeLogoDest() {
    const mine  = absURL("mine.html");
    const login = absURL("login.html");
    // 빠른 체감 반응: window.auth.isAuthed() 우선, 초기 부팅 동안엔 세션 플래그 폴백
    const authed = !!(window.auth?.isAuthed?.() || sessionStorage.getItem(AUTH_FLAG_KEY) === "1");
    if (authed) return mine;
    const u = new URL(login);
    u.searchParams.set("next", mine);
    return u.toString();
  }

  function attachClickGuard(a) {
    if (!a || a.dataset.logoGuard === "1") return;
    a.dataset.logoGuard = "1";

    if (FORCE_SAME_TAB) a.setAttribute("target", "_self");
    // 비-앵커도 지원
    if (a.tagName !== "A") {
      a.setAttribute("role", "link");
      if (!a.hasAttribute("tabindex")) a.tabIndex = 0;
      a.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); a.click(); }
      }, { capture: true });
    }

    a.addEventListener("click", (e) => {
      if (!FORCE_SAME_TAB && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
      e.preventDefault();
      try { history.scrollRestoration = "manual"; } catch {}

      try {
        window.auth?.markNavigate?.();
        sessionStorage.setItem(NAV_KEY, String(Date.now()));
      } catch {}

      try {
        if (window.auth?.isAuthed?.()) {
          sessionStorage.setItem(AUTH_FLAG_KEY, "1");
        } else if (sessionStorage.getItem(AUTH_FLAG_KEY) === "1") {
          sessionStorage.setItem(AUTH_FLAG_KEY, "1");
        }
      } catch {}

      navPingSilent();
      location.assign(computeLogoDest());
    }, { capture: true });
  }

  function updateLogoHref() {
    const links = document.querySelectorAll(SELECTOR);
    if (!links.length) return;
    const dest = computeLogoDest();
    links.forEach((a) => {
      if (a.getAttribute("href") !== dest) a.setAttribute("href", dest);
      attachClickGuard(a);
    });
  }

  function observeLogoContainer() {
    try {
      const root = document.body;
      const mo = new MutationObserver(updateLogoHref);
      mo.observe(root, { subtree: true, childList: true });
      window.addEventListener("pagehide", () => { try { mo.disconnect(); } catch {} }, { once: true });
    } catch {}
  }

  function boot(){ updateLogoHref(); observeLogoContainer(); }
  (document.readyState === "loading")
    ? document.addEventListener("DOMContentLoaded", boot, { once: true })
    : boot();

  try { window.dispatchEvent(new Event("logo-guard:ready")); } catch {}

  window.addEventListener("auth:state",  updateLogoHref, { passive: true });
  window.addEventListener("auth:logout", updateLogoHref, { passive: true });
  window.addEventListener("storage", (ev) => {
    if (ev.key === AUTH_FLAG_KEY || ev.key === "auth:ping") updateLogoHref();
  }, { passive: true });
  
})();
