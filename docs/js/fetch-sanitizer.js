// docs/js/fetch-sanitizer.js
// CORS-safe: plain "csrf-token" → "X-CSRF-Token" 승격 + 크로스사이트 쿠키 동봉
(() => {
  // URL 내 ID 접두사 정리 (예: /api/gallery/g_123 → /api/gallery/123)
  function normalizeIdInUrl(u) {
    try {
      const url = new URL(u, location.href);
      url.pathname = url.pathname
        .replace(/(\/api\/gallery\/)g_([A-Za-z0-9]+)/, "$1$2")
        .replace(/(\/api\/items\/)g_([A-Za-z0-9]+)/, "$1$2");
      return url.toString();
    } catch {
      return u;
    }
  }

  function promote(headersLike) {
    try {
      const H = new Headers(headersLike || {});
      const v = H.get("csrf-token");
      if (v != null) {
        if (!H.has("X-CSRF-Token") && !H.has("x-csrf-token")) {
          H.set("X-CSRF-Token", v);
        }
        H.delete("csrf-token");
      }
      return H;
    } catch {
      return headersLike;
    }
  }

  // ── fetch 패치
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    init = init || {};

    // URL 정규화
    if (typeof input === "string") {
      input = normalizeIdInUrl(input);
    } else if (input instanceof Request) {
      input = new Request(normalizeIdInUrl(input.url), input);
    }

    // 헤더 승격
    if (init.headers) init = { ...init, headers: promote(init.headers) };
    if (input instanceof Request) {
      const ph = promote(input.headers);
      input = new Request(input, { headers: ph });
    }

    // 크로스사이트 쿠키/세션 동봉 + CORS 모드
    if (!init.credentials) init.credentials = "include";
    if (!init.mode) init.mode = "cors";

    return _fetch(input, init);
  };

  // ── XHR 패치
  const X = XMLHttpRequest.prototype;
  const _set = X.setRequestHeader;
  X.setRequestHeader = function(name, value) {
    if (String(name).toLowerCase() === "csrf-token") {
      try { _set.call(this, "X-CSRF-Token", value); } catch {}
      return;
    }
    return _set.call(this, name, value);
  };
})();
