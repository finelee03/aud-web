(function () {
  "use strict";

  const MAX_LOGS = 500;

  // 안전 stringify
  function safeStringify(v) {
    try { return typeof v === "string" ? v : JSON.stringify(v); }
    catch { return "[unserializable]"; }
  }

  const pendingLogs = [];
  function flushPendingLogs() {
    const el = document.getElementById("log");
    if (!el || pendingLogs.length === 0) return;
    for (const m of pendingLogs.splice(0)) _appendLog(el, m);
    el.scrollTop = el.scrollHeight;
  }

  function _appendLog(el, text) {
    const div = document.createElement("div");
    const ts = new Date().toLocaleTimeString();
    const t = text.length > 2000 ? text.slice(0, 2000) + "…(trunc)" : text;
    div.textContent = `[${ts}] ${t}`;
    el.appendChild(div);
    while (el.children.length > MAX_LOGS) el.removeChild(el.firstChild);
  }

  function log(msg) {
    const el = document.getElementById("log");
    const text = safeStringify(msg);
    if (!el) { pendingLogs.push(text); return; }
    _appendLog(el, text);
    el.scrollTop = el.scrollHeight;
  }
  window.log = window.log || log;

  // 소켓별 1회 부착
  const attached = new WeakSet();
  function attachSockHandlers(sock) {
    if (!sock || attached.has(sock)) return;
    attached.add(sock);

    sock.on("connect",         () => log("[sock] connected"));
    sock.on("disconnect",      (r) => log("[sock] disconnected: " + r));
    sock.on("reconnect_error", (e) => log("[sock] reconnect_error " + (e?.message || "")));
    sock.on("connect_error",   (e) => log("[sock] connect_error " + (e?.message || "")));

    // 필요 시 매니저 레벨 이벤트도 확인
    if (sock.io) {
      sock.io.on("reconnect_attempt", (n) => log("[sock.io] reconnect_attempt " + n));
      sock.io.on("reconnect", () => log("[sock.io] reconnect"));
    }

    sock.on("nfc", (evt) => log("[NFC] " + safeStringify(evt)));
  }

  // 최초/이후 준비 케이스 모두 커버
  if (window.sock) attachSockHandlers(window.sock);

  if (window.sockReady && typeof window.sockReady.then === "function") {
    window.sockReady.then((s) => { attachSockHandlers(s); flushPendingLogs(); }).catch(() => {});
  } else {
    window.addEventListener("sock:ready", () => {
      if (window.sock) { attachSockHandlers(window.sock); flushPendingLogs(); }
    }, { once: true });
  }

  // DOM이 나중에 그려지는 경우도 처리
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", flushPendingLogs, { once: true });
  } else {
    flushPendingLogs();
  }
})();
