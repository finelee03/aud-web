// docs/js/config.js
(() => {
  // Render API Origin
  const API = "https://aud-api-dtd1.onrender.com";

  // 전역 호환
  window.PROD_BACKEND = API;
  window.API_BASE = API;

  const _fetch = window.fetch.bind(window);

  // /auth/... 또는 /api/... 가 "어디에 있든" 잡아낸다. (예: /aud-web/auth/me)
  const isApiPath = (pathname) => /(?:^|\/)(?:auth|api)\//.test(pathname);

  // Request | (url, init) → 새 Request(init 병합, 쿠키 동반)
  function toProxiedRequest(input, init, targetURL) {
    // 원본을 Request로 통일
    const baseReq = input instanceof Request ? input : new Request(input, init);

    // 헤더 병합
    const headers = new Headers(baseReq.headers);
    if (init && init.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));

    // 메서드/바디
    const method = (init && init.method) || baseReq.method || "GET";
    const outInit = {
      method,
      headers,
      mode: "cors",
      credentials: "include",
      redirect: init?.redirect ?? baseReq.redirect,
      cache: init?.cache ?? baseReq.cache,
      referrer: init?.referrer ?? baseReq.referrer,
      referrerPolicy: init?.referrerPolicy ?? baseReq.referrerPolicy,
      integrity: init?.integrity ?? baseReq.integrity,
      keepalive: init?.keepalive ?? baseReq.keepalive,
      signal: init?.signal ?? baseReq.signal,
    };
    if (!/^get|head$/i.test(method)) {
      // body는 init 우선, 없으면 원본 Request의 body 복제
      outInit.body = init?.body ?? baseReq.body ?? null;
    }
    return new Request(targetURL, outInit);
  }

  window.fetch = function(input, init) {
    try {
      // 요청 URL 계산 (Request|string|URL 모두 지원)
      const urlStr = input instanceof Request ? input.url : String(input);
      const u = new URL(urlStr, location.href);

      // 같은 오리진에서 /auth|/api 로 시작(또는 포함)하면 Render API로 프록시
      if (u.origin === location.origin && isApiPath(u.pathname) && API) {
        const target = new URL(u.pathname + u.search + u.hash, API).toString();
        return _fetch(toProxiedRequest(input, init, target));
      }
    } catch {
      // URL 파싱 실패 시 원본 fetch로 폴백
    }
    return _fetch(input, init);
  };
})();
