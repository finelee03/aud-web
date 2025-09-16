(() => {
  const API = window.PROD_BACKEND || window.API_BASE || window.API_ORIGIN;
  if (!API || !window.fetch) return;
  const apiOrigin = new URL(API).origin;
  const DROP = ['csrf-token','x-csrf-token','x-xsrf-token','CSRF-Token','X-CSRF-Token','X-XSRF-Token'];

  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init={}) => {
    try {
      const url = new URL(typeof input === 'string' ? input : (input?.url || ''), location.href);
      if (url.origin === apiOrigin) {
        const h = new Headers(init?.headers || {});
        DROP.forEach(k => h.delete(k));
        init = { ...init, headers: h };
      }
    } catch {}
    return origFetch(input, init);
  };

  // window.auth.apiFetch가 있으면 동일하게 정리
  try {
    if (window.auth && typeof window.auth.apiFetch === 'function') {
      const base = window.auth.apiFetch.bind(window.auth);
      window.auth.apiFetch = (p, opt={}) => {
        const h = new Headers(opt?.headers || {});
        DROP.forEach(k => h.delete(k));
        return base(p, { ...opt, headers: h });
      };
    }
  } catch {}
})();
