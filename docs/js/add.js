// add.js (ES module, cleaned)

/* ───────────── Constants ───────────── */
const SELECTED_KEY = "aud:selectedLabel";            // sessionStorage
const MIRROR_KEY   = "aud:selectedLabel:mirror";     // localStorage broadcast
const EVT          = "aud:selectedLabel-changed";
const MAX_STARS    = 3;
const FALLBACK_URL = "./collect.html";

const MAP = {
  miro:   { category: "play", stars: 3 },
  whee:   { category: "asmr", stars: 1 },
  thump:  { category: "asmr", stars: 1 },
  track:  { category: "play", stars: 2 },
  echo:   { category: "asmr", stars: 2 },
  portal: { category: "play", stars: 2 },
};
const OK = ["thump","miro","whee","track","echo","portal"];

const IMG_SRC = {
  thump:"./asset/thump.png",
  miro:"./asset/miro.png",
  whee:"./asset/whee.png",
  track:"./asset/track.png",
  echo:"./asset/echo.png",
  portal:"./asset/portal.png",
};

/* ───────────── Helpers ───────────── */
const isLabel = (x) => OK.includes(String(x));

function readSelected() {
  try {
    const v = sessionStorage.getItem(SELECTED_KEY);
    return (v && OK.includes(v)) ? v : null;
  } catch { return null; }
}

/** 외부에서 재사용할 수 있도록 export 유지 */
export function setSelectedLabel(label) {
  if (!isLabel(label)) return;
  try {
    sessionStorage.setItem(SELECTED_KEY, label);
    // same-tab update
    window.dispatchEvent(new Event(EVT));
    // cross-tab broadcast (same value repeat allowed)
    if (isAuthed()) {
      localStorage.setItem(MIRROR_KEY, JSON.stringify({ label, t: Date.now() }));
    } else {
      // 혹시 남아있던 값이 있으면 치워줌(게스트는 휘발)
      try { localStorage.removeItem(MIRROR_KEY); } catch {}
    }
  } catch {}
}

function ensureReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else { fn(); }
}

function starSVG(filled) {
  const fill = filled ? "#666" : "none";
  const stroke = "#666";
  return `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M12 3.6l2.6 5.26 5.81.84-4.2 4.09.99 5.77L12 17.77 6.8 20.56l.99-5.77-4.2-4.09 5.81-.84L12 3.6z"
            fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>
    </svg>`;
}

function isAuthed(){
  try { return !!(window.auth && window.auth.isAuthed && window.auth.isAuthed()); }
  catch { return false; }
}

/* ───────────── Renderers ───────────── */
function renderLastLabel() {
  const el = document.getElementById("lastLabel");
  if (!el) return;
  const label = readSelected();
  el.textContent = label ? label.toUpperCase() : "";
  el.setAttribute("aria-live", "polite");
}

function renderCategoryRow() {
  const row = document.getElementById("categoryRow");
  if (!row) return;
  row.innerHTML = "";

  const label = readSelected();
  if (!label) return;
  const info = MAP[label] || { category: "play", stars: 0 };

  // category pill
  const pill = document.createElement("div");
  pill.className = "pill";
  const txt = document.createElement("span");
  txt.className = "pill__text";
  txt.textContent = info.category.toUpperCase();
  pill.appendChild(txt);

  // stars pill
  const starsPill = document.createElement("div");
  starsPill.className = "pill";
  const starsWrap = document.createElement("div");
  starsWrap.className = "stars";
  starsWrap.setAttribute("role", "img");
  starsWrap.setAttribute("aria-label", `${info.stars} out of ${MAX_STARS} stars`);
  for (let i = 0; i < MAX_STARS; i++) {
    starsWrap.insertAdjacentHTML("beforeend", starSVG(i < info.stars));
  }
  starsPill.appendChild(starsWrap);

  row.appendChild(pill);
  row.appendChild(starsPill);
}

function renderAddGalleryBox() {
  const box = document.getElementById("addGalleryBox");
  if (!box) return;
  box.innerHTML = "";

  const label = readSelected();
  if (!label) { box.classList.add("is-empty"); return; }

  box.classList.remove("is-empty");
  const img = document.createElement("img");
  img.alt = label;
  img.src = IMG_SRC[label];
  box.appendChild(img);
}

function syncAll() {
  renderCategoryRow();
  renderLastLabel();
  renderAddGalleryBox();
}

/* ───────────── Add-to-Gallery button ───────────── */
function getTemps(store) {
  try {
    // 우선: 공식 게터가 있으면 사용
    if (typeof store?.getTemp === "function") {
      const t = store.getTemp() || [];
      return Array.isArray(t) ? t.slice() : Array.from(t);
    }
    const t = store?.tempRegistered;
    if (!t) return [];
    return Array.isArray(t) ? t.slice() : Array.from(t);
  } catch { return []; }
}

// ✅ 내부 이동으로 표시 후 갤러리로 이동 (로그아웃 방지)
// add.js
function gotoGallery(label){
  const url = label ? `./gallery.html?label=${encodeURIComponent(label)}` : "./gallery.html";
  try { window.auth?.markNavigate?.(); } catch {}
  requestAnimationFrame(() => { location.assign(url); });
}

// 2) 게스트 전용 로컬 등록(스토어가 없는 경우에도 동작)
function guestAddLabel(label){
  const ns = (window.__STORE_NS || "default").toLowerCase();
  const KEY_COL = `collectedLabels:${ns}`;
  const KEY_TS  = `labelTimestamps:${ns}`;
  const EVT_COL = window.LABEL_COLLECTED_EVT || "label:collected-changed";

  // 등록 배열
  let arrSess = []; let arrLocal = [];
  try { arrSess  = JSON.parse(sessionStorage.getItem(KEY_COL) || "[]"); } catch {}
  try { arrLocal = JSON.parse(localStorage.getItem(KEY_COL)    || "[]"); } catch {}
  if (!arrSess.includes(label))  arrSess.push(label);
  if (!arrLocal.includes(label)) arrLocal.push(label);
  sessionStorage.setItem(KEY_COL, JSON.stringify(arrSess));
  try { localStorage.setItem(KEY_COL, JSON.stringify(arrLocal)); } catch {}

  // 타임스탬프(YYYY-MM-DD, KST)
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" })
                 .formatToParts(new Date());
  const ymd = `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}`;
  let tsSess = {}; let tsLocal = {};
  try { tsSess  = JSON.parse(sessionStorage.getItem(KEY_TS) || "{}"); } catch {}
  try { tsLocal = JSON.parse(localStorage.getItem(KEY_TS)    || "{}"); } catch {}
  tsSess[label]  = ymd;
  tsLocal[label] = ymd;
  sessionStorage.setItem(KEY_TS, JSON.stringify(tsSess));
  try { localStorage.setItem(KEY_TS, JSON.stringify(tsLocal)); } catch {}
}

// 3) 버튼 핸들러(게스트 허용 + label로 이동)
function attachAddToGalleryBtn() {
  const btn = document.getElementById("addToGalleryBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const s = window.store;
    const label = readSelected();

    // 선택값이 없으면 collect로 유도
    if (!label) {
      try { window.auth?.markNavigate?.(); } catch {}
      location.assign("./collect.html");
      return;
    }

    // ✅ 로그인/게스트 공통: 등록 → 타임스탬프 → 선택 유지 → label 페이지로 이동
    if (s?.add) { 
      try { s.add(label); } catch {}
      try {
        const parts = new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" })
                      .formatToParts(new Date());
        const ymd = `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}`;
        s.setTimestamp?.(label, ymd);
      } catch {}
    } else {
      // 🔁 스토어가 없을 경우 게스트 로컬 등록
      guestAddLabel(label);
    }

    // 선택 라벨 브로드캐스트(게스트는 same-tab만)
    try { setSelectedLabel(label); } catch {}
    gotoGallery(label);
  }, { passive: true });
}

/* ───────────── Bootstrapping ───────────── */
ensureReady(() => {
  // Initial render
  syncAll();
  attachAddToGalleryBtn();

  // Same-tab updates
  window.addEventListener(EVT, syncAll);

  // Tab return refresh
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAll();
  });

  // Cross-tab updates (mirror key)
  window.addEventListener("storage", (e) => {
    if (e.key !== MIRROR_KEY || !e.newValue) return;
    if (!isAuthed()) return;
    try {
      const { label } = JSON.parse(e.newValue);
      if (isLabel(label)) {
        sessionStorage.setItem(SELECTED_KEY, label);
        syncAll();
      }
    } catch {}
  });
});

// URL ?label=... → state 초기화, 없으면 세션/폴백 검사
(() => {
  try {
    const q = new URLSearchParams(location.search).get("label");
    if (q && isLabel(q)) {
      setSelectedLabel(q);  // 세션 + 이벤트 + 크로스탭
    } else {
      const has = sessionStorage.getItem(SELECTED_KEY);
      if (!has) location.replace(FALLBACK_URL);
    }
  } catch {
    location.replace(FALLBACK_URL);
  }
})();

// 하단 아무 곳(부트 직후 한 번만 바인딩)
(function bindAddCrossTab(){
  if (window.__addCrossTabBound) return; window.__addCrossTabBound = true;

  function isAuthed(){
    try { return !!(window.auth?.isAuthed?.()); } catch { return false; }
  }
  function isLabel(x){ return ["thump","miro","whee","track","echo","portal"].includes(String(x)); }

  window.addEventListener("storage", (e)=>{
    if (!e || e.key !== "aud:selectedLabel:mirror" || !e.newValue) return;
    if (!isAuthed()) return; // 로그인일 때만 반영
    try{
      const { label } = JSON.parse(e.newValue);
      if (isLabel(label)) {
        sessionStorage.setItem("aud:selectedLabel", label);
        window.dispatchEvent(new Event("aud:selectedLabel-changed"));
        renderLastLabel(); renderCategoryRow(); renderAddGalleryBox();
      }
    }catch{}
  });

  // 명시 로그아웃/세션만료 시 비주얼 초기화
  window.addEventListener("auth:logout", ()=>{
    try { sessionStorage.removeItem("aud:selectedLabel"); } catch {}
    renderLastLabel(); renderCategoryRow(); renderAddGalleryBox();
  });
})();
