// aud.js (ES module, patched for "UNKNOWN only" category + mobile tap toggle)

/* ───────────── Constants ───────────── */
const SELECTED_KEY = "aud:selectedLabel";
const MIRROR_KEY   = "aud:selectedLabel:mirror";
const EVT          = "aud:selectedLabel-changed";
const FALLBACK_URL = "./gallery.html";

const OK = ["thump","miro","whee","track","echo","portal"];

// 우선 검은 버전 시도 → 실패하면 일반 png로 폴백
const IMG_SRC = {
  thump:"./asset/thumpblack.png",
  miro:"./asset/miroblack.png",
  whee:"./asset/wheeblack.png",
  track:"./asset/trackblack.png",
  echo:"./asset/echoblack.png",
  portal:"./asset/portalblack.png",
};

/* ───────────── Helpers ───────────── */
const isLabel = (x) => OK.includes(String(x));

function readSelected() {
  try {
    const v = sessionStorage.getItem(SELECTED_KEY);
    return (v && OK.includes(v)) ? v : null;
  } catch { return null; }
}

export function setSelectedLabel(label) {
  if (!isLabel(label)) return;
  try {
    sessionStorage.setItem(SELECTED_KEY, label);
    window.dispatchEvent(new Event(EVT)); // same-tab
    if (window.auth?.isAuthed?.()) {
      localStorage.setItem(MIRROR_KEY, JSON.stringify({ label, t: Date.now() }));
    } else {
      try { localStorage.removeItem(MIRROR_KEY); } catch {}
    }
  } catch {}
}

function ensureReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else { fn(); }
}

/* ───────────── Renderers ───────────── */
function renderLastLabel() {
  const el = document.getElementById("lastLabel");
  if (!el) return;
  el.textContent = "AUD";   // ← 고정
  el.setAttribute("aria-live", "polite");
}

// ★ 카테고리는 항상 'UNKNOWN' 1개 pill만 렌더 (별 표시 제거)
function renderPill() {
  const row = document.getElementById("categoryRow");
  if (!row) return;
  row.innerHTML = "";

  const pill = document.createElement("div");
  pill.className = "pill";
  const txt = document.createElement("span");
  txt.className = "pill__text";
  txt.textContent = "UNKNOWN";
  pill.appendChild(txt);

  row.append(pill);
}

function renderAddGalleryBox() {
  const box = document.getElementById("audGalleryBox"); // ✅ HTML id 확인
  if (!box) return;
  box.innerHTML = "";

  const label = readSelected();
  if (!label) { box.classList.add("is-empty"); return; }

  box.classList.remove("is-empty");
  const img = document.createElement("img");
  img.alt = label;

  // 1차 경로(black) → 실패 시 일반 png로 폴백
  img.src = IMG_SRC[label] || `./asset/${label}.png`;
  img.addEventListener("error", () => {
    // 폴백도 실패하면 빈 상태로 처리
    if (img.dataset.fallbackTried === "1") {
      box.classList.add("is-empty");
      img.remove();
      return;
    }
    img.dataset.fallbackTried = "1";
    img.src = `./asset/${label}.png`;
  });

  box.appendChild(img);
}

function syncAll() {
  renderPill();
  renderLastLabel();
  renderAddGalleryBox();
}

/* ───────────── Aud-to-Gallery button ───────────── */
function attachAddToGalleryBtn() {
  const btn = document.getElementById("audToGalleryBtn");
  if (!btn) return;
  if (btn.dataset.collectNavBound === "1") return;
  btn.dataset.collectNavBound = "1";

  const COLLECT_URL = "./collect.html";
  btn.addEventListener("click", () => {
    requestAnimationFrame(() => { location.assign(COLLECT_URL); });
  });
}

/* ───────────── Mobile tap toggle: blur ↔ sharp ─────────────
   - 터치 환경(hover:none)에서만 토글 이벤트를 바인딩
   - .is-sharp 클래스를 토글하여 CSS와 연동
   - 접근성: role="button", tabindex, aria-pressed 자동 부여
---------------------------------------------------------------- */
function attachMobileBlurToggle(){
  const box = document.getElementById('audGalleryBox');
  if (!box) return;
  if (box.dataset.blurToggleBound === '1') return;

  const isTouchEnv = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (!isTouchEnv) return;

  // 접근성 속성 부여
  box.setAttribute('role', 'button');
  if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '0');

  const syncAria = () => {
    const pressed = box.classList.contains('is-sharp') ? 'true' : 'false';
    box.setAttribute('aria-pressed', pressed);
  };
  syncAria();

  const toggleSharp = () => { box.classList.toggle('is-sharp'); syncAria(); };

  // 터치/펜 우선: pointerup에서 토글 (마우스 제외)
  box.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    toggleSharp();
  });

  // 외부 키보드 대응(Enter/Space)
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSharp(); }
  });

  box.dataset.blurToggleBound = '1';
}

/* ───────────── Bootstrapping ───────────── */
ensureReady(() => {
  document.title = "AUD";
  // ✅ 선택 라벨이 없으면 기본값을 넣어 이미지는 항상 보이게 유지
  if (!readSelected()) {
    const q = new URLSearchParams(location.search).get("label");
    if (q && isLabel(q)) setSelectedLabel(q);
    else setSelectedLabel(OK[0]); // e.g. "thump"
  }

  syncAll();
  attachAddToGalleryBtn();
  attachMobileBlurToggle();  // ★ 추가: 모바일 탭 토글 활성화

  // same-tab 즉시 반영
  window.addEventListener(EVT, syncAll);

  // cross-tab 갱신 반영
  window.addEventListener("storage", (e) => {
    if (e.key === MIRROR_KEY && e.newValue) {
      try {
        const { label } = JSON.parse(e.newValue);
        if (isLabel(label)) {
          sessionStorage.setItem(SELECTED_KEY, label);
          syncAll();
        }
      } catch {}
    }
  });
});

// URL ?label=... → state 초기화만(리다이렉트 없음)
(() => {
  try {
    const q = new URLSearchParams(location.search).get("label");
    if (q && isLabel(q)) setSelectedLabel(q);
  } catch {}
})();

(function bindAudCrossTab(){
  if (window.__audCrossTabBound) return; window.__audCrossTabBound = true;

  window.addEventListener("storage", (e)=>{
    if (e?.key !== MIRROR_KEY || !e.newValue) return;
    if (!window.auth?.isAuthed?.()) return;
    try{ const { label } = JSON.parse(e.newValue);
      if (isLabel(label)) { sessionStorage.setItem(SELECTED_KEY, label); syncAll(); }
    }catch{}
  });

  window.addEventListener("auth:logout", ()=>{
    try { sessionStorage.removeItem(SELECTED_KEY); } catch {}
    syncAll();
  });
})();