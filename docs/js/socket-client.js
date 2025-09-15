const log = (msg) => {
  const el = document.getElementById("log");
  if (!el) return;
  const div = document.createElement("div");
  div.textContent = String(msg);
  el.appendChild(div);
};

const sock = (window.io)
  ? window.io({
      // 필요 시 전역에 API_ORIGIN(예: https://api.example.com) 주입
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"]
    })
  : null;

sock?.on("connect", () => log("[sock] connected"));
sock?.on("connect_error", (err) => log("[sock] connect_error " + err?.message));

sock.on("connect", () => log("[sock] connected"));

sock.on("nfc", evt => {
  log("[NFC] " + JSON.stringify(evt));
  // evt = { id, label, ts, rssi, mac, device }
});
