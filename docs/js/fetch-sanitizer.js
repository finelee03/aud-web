(()=> {
  const orig = window.fetch;
  const isBad = (name) => String(name||'').toLowerCase() === 'csrf-token'; // ⬅️ 이것만 제거
  window.fetch = async (input, init = {}) => {
    const req = new Request(input, init);
    const h = new Headers(req.headers);
    for (const k of [...h.keys()]) if (isBad(k)) h.delete(k);
    return orig(new Request(req, { headers: h }), init);
  };
})();
