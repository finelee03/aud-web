// docs/js/fetch-sanitizer.js
// CORS-safe: plain "csrf-token" 을 "X-CSRF-Token"으로 승격(없으면 제거)
// fetch와 XMLHttpRequest 모두 패치
(() => {
  function promote(headersLike) {
    try {
      const H = new Headers(headersLike || {});
      const v = H.get('csrf-token');
      if (v != null) {
        if (!H.has('X-CSRF-Token') && !H.has('x-csrf-token')) {
          H.set('X-CSRF-Token', v);
        }
        H.delete('csrf-token');           // plain 이름은 제거
      }
      return H;
    } catch {
      return headersLike;
    }
  }

  // --- fetch 패치 (Request 객체/일반 옵션 둘 다 처리) ---
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    init = init || {};

    // 1) init.headers 승격
    if (init.headers) init = { ...init, headers: promote(init.headers) };

    // 2) input이 Request 이고 그 안에 'csrf-token'이 있으면 복제하여 승격
    if (input instanceof Request) {
      const ph = promote(input.headers);
      // init.headers가 있으면 init이 우선하므로, input도 정리해 둠
      input = new Request(input, { headers: ph });
    }

    return _fetch(input, init);
  };

  // --- XHR 패치 ---
  const X = XMLHttpRequest.prototype;
  const _set = X.setRequestHeader;
  X.setRequestHeader = function(name, value) {
    if (String(name).toLowerCase() === 'csrf-token') {
      try { _set.call(this, 'X-CSRF-Token', value); } catch {}
      return; // 원래 헤더는 막는다
    }
    return _set.call(this, name, value);
  };
})();
