(function () {
  "use strict";

  const MAX_LOGS = 500;

  function log(msg) {
    const el = document.getElementById("log");
    if (!el) return;
    const div = document.createElement("div");
    const ts = new Date().toLocaleTimeString();
    // 너무 길면 잘라서 DOM 폭주 방지
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    div.textContent = `[${ts}] ${text.length > 2000 ? text.slice(0, 2000) + "…(trunc)" : text}`;
    el.appendChild(div);
    // 오래된 로그 정리
    while (el.children.length > MAX_LOGS) el.removeChild(el.firstChild);
    // 맨 아래로 스크롤
    el.scrollTop = el.scrollHeight;
  }

  // 전역 노출 원래 함수 유지(선택)
  window.log = window.log || log;

  function attachSockHandlers(sock) {
    if (!sock || attachSockHandlers.__done) return;
    attachSockHandlers.__done = true;

    sock.on("connect",         () => log("[sock] connected"));
    sock.on("disconnect",      (r) => log("[sock] disconnected: " + r));
    sock.on("reconnect",       () => log("[sock] reconnected"));
    sock.on("reconnect_error", (e) => log("[sock] reconnect_error " + (e?.message || "")));
    sock.on("connect_error",   (e) => log("[sock] connect_error " + (e?.message || "")));

    // NFC 브로드캐스트
    sock.on("nfc", (evt) => {
      try { log("[NFC] " + JSON.stringify(evt)); }
      catch { log("[NFC] (unserializable event)"); }
    });
  }

  // 1) 이미 만들어져 있으면 즉시 부착
  if (window.sock) attachSockHandlers(window.sock);

  // 2) 나중에 준비되는 경우도 커버
  if (window.sockReady && typeof window.sockReady.then === "function") {
    window.sockReady.then(attachSockHandlers).catch(() => {});
  } else {
    window.addEventListener("sock:ready", () => {
      if (window.sock) attachSockHandlers(window.sock);
    }, { once: true });
  }
})();
