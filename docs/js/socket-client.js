const log = (msg) => {
  const el = document.getElementById("log");
  if (!el) return;
  const div = document.createElement("div");
  div.textContent = String(msg);
  el.appendChild(div);
};

// 이미 IIFE에서 window.sock을 만들었으므로 그것만 사용
const sock = window.sock;
sock?.on("connect", () => log("[sock] connected"));
sock?.on("connect_error", (err) => log("[sock] connect_error " + (err?.message || "")));
sock?.on("nfc", (evt) => log("[NFC] " + JSON.stringify(evt)));