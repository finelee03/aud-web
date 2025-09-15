// /js/custom.js
(function () {
  "use strict";

  const DEST_URL = "./jibbitz.html";
  const ALL = ["bloom","tail","cap","keyring","duck","twinkle","xmas","bunny"];
  const isKind = (v) => typeof v === "string" && ALL.includes(v);

  function isAuthed() {
    try { return !!(window.auth?.isAuthed?.()) || sessionStorage.getItem("auth:flag") === "1"; }
    catch { return false; }
  }
  function currentNS() {
    if (!isAuthed()) return "default";
    try {
      const ns = (localStorage.getItem("auth:userns") || "").trim().toLowerCase();
      return ns || "default";
    } catch { return "default"; }
  }
  function plane() { return currentNS() === "default" ? sessionStorage : localStorage; }
  const KEY_SELECTED = () => `jib:selected:${currentNS()}`;

  function setSelected(kind){
    if (window.jib?.setSelected) { window.jib.setSelected(kind); return; }
    try {
      plane().setItem(KEY_SELECTED(), kind);
      window.dispatchEvent(new Event("jib:selected-changed"));
      // 선택 브로드캐스트
      const SYNC = `jib:sync:${currentNS()}`;
      localStorage.setItem(SYNC, JSON.stringify({ type:"select", k:kind, t:Date.now() }));
      try { new BroadcastChannel(`aud:sync:${currentNS()}`).postMessage({ kind:"jib:sync", payload:{ type:"select", k:kind, t:Date.now() } }); } catch {}
    } catch {}
  }

  function wireTiles() {
    const tiles = document.querySelectorAll('.tile[data-jib], .tile[aria-label], .tile'); // 범위를 약간 확대
    if (!tiles.length) return;

    tiles.forEach((tile) => {
      if (tile.__bound) return;
      tile.__bound = true;

      tile.addEventListener("click", () => {
        const kind = (tile.dataset.jib || tile.getAttribute("aria-label") || "")
          .trim().toLowerCase();
        if (!isKind(kind)) return;

        setSelected(kind);
        tile.style.pointerEvents = "none";
        window.auth?.markNavigate?.();
        const url = `${DEST_URL}?jib=${encodeURIComponent(kind)}`;
        window.location.href = url;
      }, { passive: true });
    });
  }

  // ★ 타일이 비어 있거나 1개만 있을 때 ALL을 기준으로 안전 주입
  function ensureTiles() {
    // 후보 컨테이너들(프로젝트마다 다를 수 있어 느슨하게 선택)
    const container =
      document.querySelector('#custom-jib-list') ||
      document.querySelector('.custom .tiles') ||
      document.querySelector('#all-grid') ||
      document.querySelector('.custom [role="list"]');
    if (!container) return;

    const existing = Array.from(container.querySelectorAll('.tile[aria-label], .tile[data-jib]'))
                          .map(el => (el.getAttribute('aria-label') || el.dataset.jib || '').trim().toLowerCase())
                          .filter(Boolean);
    if (existing.length >= ALL.length) return;        // 이미 충분히 그려져 있음
    if (existing.length > 1) return;                  // 최소 2개 이상 있으면 주입 생략

    // 주입: 이미 있는 건 건너뛰고 없는 것만 추가
    const mk = (kind) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', kind);
      btn.textContent = kind; // 디자인은 CSS로 대체 가능
      btn.addEventListener('click', () => {
        setSelected(kind);
        btn.style.pointerEvents = 'none';
        window.auth?.markNavigate?.();
        location.href = `${DEST_URL}?jib=${encodeURIComponent(kind)}`;
      }, { passive: true });
      return btn;
    };
    ALL.forEach(k => { if (!existing.includes(k)) container.appendChild(mk(k)); });
  }

  function heroIn() {
    const hero = document.querySelector(".custom .hero");
    if (!hero) return;
    requestAnimationFrame(() => setTimeout(() => hero.classList.add("is-in"), 0));
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(() => { ensureTiles(); wireTiles(); heroIn(); });
})();
