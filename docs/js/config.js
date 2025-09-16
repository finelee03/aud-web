(() => {
  // ① Render API 도메인으로 교체
  const API = "https://aud-api-dtd1.onrender.com";

  // 전역 상수로 노출
  window.PROD_BACKEND = API;

  // ② 모든 상대 fetch를 API 오리진으로 보정 (간단 우회)
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      const u = new URL(input, location.href);
      if (u.origin === location.origin && /^\/(?:auth|api)\//.test(u.pathname)) {
        const API = window.PROD_BACKEND || window.API_BASE;
        if (API) {
          const apiURL = new URL(u.pathname + u.search + u.hash, API);
          return _fetch(apiURL.toString(), init);
        }
      }
    } catch {}
    return _fetch(input, init);
  };

})();
