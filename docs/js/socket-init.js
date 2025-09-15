// public/js/socket-init.js (hardened + autosubscribe)
(function () {
  "use strict";

  // ---- idempotent guard ----
  if (window.__sockInitDone) return;
  window.__sockInitDone = true;

  // 선택: 쿠키 인증 소켓이면 true 로 전역 세팅 (서버 CORS-credentials 허용 필요)
  const SOCK_WITH_CREDENTIALS =
    typeof window.SOCK_WITH_CREDENTIALS === "boolean" ? window.SOCK_WITH_CREDENTIALS : false;

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
    if (!window.io) {
      console.warn("[socket-init] socket.io script not loaded; skipping init");
      return;
    }
    const ORIGIN = window.PROD_BACKEND || undefined; // 없으면 same-origin
    const sock = window.io(ORIGIN, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 8000,
      path: "/socket.io",
      withCredentials: SOCK_WITH_CREDENTIALS
    });

    // 전역 공개
    window.sock = sock;
    window.sockIsConnected = () => !!(sock && sock.connected);

    // ---- 구독 상태는 connect 핸들러보다 먼저 선언 (TDZ 레이스 방지) ----
    const subscribed = new Set();

    function resubscribeAll() {
      if (!subscribed.size) return;
      const labels = Array.from(subscribed);
      try {
        sock.emit("subscribe", { labels }, (ack) => {
          if (ack && ack.ok === false) console.warn("[socket-init] resubscribe failed", ack);
        });
      } catch {}
    }

    sock.on("connect", () => {
      window.dispatchEvent(new CustomEvent("sock:ready", { detail: { reconnected: !!sock.io?.recovered } }));
      _resolveReady?.(sock); // idempotent
      resubscribeAll();
    });
    sock.on("reconnect", () => {
      window.dispatchEvent(new CustomEvent("sock:reconnected"));
      resubscribeAll();
    });
    sock.on("connect_error", (err) => {
      window.dispatchEvent(new CustomEvent("sock:error", { detail: { message: err?.message } }));
    });
    sock.on("disconnect", (reason) => {
      window.dispatchEvent(new CustomEvent("sock:down", { detail: { reason } }));
    });

    // ---- 구독/해제 + 재구독 상태 관리 ----
    function normalizeLabels(ls) {
      if (Array.isArray(ls)) return [...new Set(ls.filter(Boolean).map(String))];
      if (ls != null) return [String(ls)];
      return [];
    }

    window.sockSubscribe = function (labels) {
      const arr = normalizeLabels(labels);
      if (!arr.length) return;
      arr.forEach((lb) => subscribed.add(lb));
      try {
        sock.emit("subscribe", { labels: arr }, (ack) => {
          if (ack && ack.ok === false) console.warn("[socket-init] subscribe failed", ack);
        });
      } catch {}
    };

    window.sockUnsubscribe = function (labels) {
      const arr = normalizeLabels(labels);
      if (!arr.length) return;
      arr.forEach((lb) => subscribed.delete(lb));
      try {
        sock.emit("unsubscribe", { labels: arr }, (ack) => {
          if (ack && ack.ok === false) console.warn("[socket-init] unsubscribe failed", ack);
        });
      } catch {}
    };
    
    window.sockUnsubscribeAll = function () {
      if (!subscribed.size) return;
      const arr = Array.from(subscribed);
      subscribed.clear();
      try { sock.emit("unsubscribe", { labels: arr }); } catch {}
    };

    // ---- 필요하다면 탭 종료 시 연결 정리 ----
    // window.addEventListener("pagehide", () => { try { sock.close(); } catch {} });
    // window.addEventListener("beforeunload", () => { try { sock.close(); } catch {} });
  });
})();
