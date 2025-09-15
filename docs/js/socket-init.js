// public/js/socket-init.js (hardened + autosubscribe)
(function () {
  "use strict";

  // ---- idempotent guard ----
  if (window.__sockInitDone) return;
  window.__sockInitDone = true;

  // ---- small helpers ----
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else { fn(); }
  }

  // 외부에서 await 가능한 Promise
  let _resolveReady;
  const sockReady = new Promise((res) => (_resolveReady = res));
  window.sockReady = sockReady;

  onReady(function () {
    const sock = io(window.PROD_BACKEND, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 8000,
      path: "/socket.io",
      withCredentials: false
    });

    // 전역 공개
    window.sock = sock;

    sock.on("connect", () => {
      window.dispatchEvent(new Event("sock:ready"));
      _resolveReady?.(sock);
      // 재연결 시 자동 재구독
      if (subscribed.size) {
        const labels = Array.from(subscribed);
        try { sock.emit("subscribe", { labels }); } catch {}
      }
    });

    // ---- 구독/해제 + 재구독 상태 관리 ----
    const subscribed = new Set();

    function normalizeLabels(ls) {
      if (Array.isArray(ls)) return ls.filter(Boolean).map(String);
      if (ls != null) return [String(ls)];
      return [];
    }

    window.sockSubscribe = function (labels) {
      const arr = normalizeLabels(labels);
      if (!arr.length) return;
      arr.forEach((lb) => subscribed.add(lb));
      try { sock.emit("subscribe", { labels: arr }); } catch {}
    };

    window.sockUnsubscribe = function (labels) {
      const arr = normalizeLabels(labels);
      if (!arr.length) return;
      arr.forEach((lb) => subscribed.delete(lb));
      try { sock.emit("unsubscribe", { labels: arr }); } catch {}
    };

    // ---- 필요하다면 탭 종료 시 연결 정리 ----
    // window.addEventListener("pagehide", () => { try { sock.close(); } catch {} });
    // window.addEventListener("beforeunload", () => { try { sock.close(); } catch {} });
  });
})();
