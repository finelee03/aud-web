const log = (msg) => {
  const el = document.getElementById("log");
  if (el) el.innerHTML += `<div>${msg}</div>`;
};

const sock = io();

sock.on("connect", () => log("[sock] connected"));

sock.on("nfc", evt => {
  log("[NFC] " + JSON.stringify(evt));
  // evt = { id, label, ts, rssi, mac, device }
});
