/* ========================================================================== *
 * 0) CONSTANTS
 * ========================================================================== */
// === store.js API (authed 동기화) ===
// ---- store adapter (safe) ----
// 이 블록으로 기존 storeTsGet/Set, storeHeartGet/Inc 를 대체하세요.

/* ---- user namespace (per-account) ---- */
const USER_NS = (() => {
  try {
    return (localStorage.getItem("auth:userns") || "default").trim().toLowerCase();
  } catch { return "default"; }
})();
window.SDF_NS = USER_NS; // 다른 모듈들이 참조

/* ---- gallery prefix (local store namespace) ---- */
/* 기존: const GALLERY_PREFIX = "mine:";  → 계정별로 분리 */
const GALLERY_PREFIX = `mine:${USER_NS}:`;

const TS_KEY = "aud:label:timestamp";
const HEARTS_KEY = "aud:label:hearts";

const _S = () => (window.store
  && typeof window.store.getTimestamp === "function"
  && typeof window.store.setTimestamp === "function"
  && typeof window.store.getHeart === "function"
  && typeof window.store.incrementHeart === "function")
  ? window.store
  : null;

// timestamp
const storeTsGet = (lb) => _S()?.getTimestamp(lb) ?? (()=>{
  try { return JSON.parse(localStorage.getItem(TS_KEY)||"{}")[lb] || null; } catch { return null; }
})();
const storeTsSet = (lb, ymd) => { if (_S()) return _S().setTimestamp(lb, ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return;
  try { const obj = JSON.parse(localStorage.getItem(TS_KEY)||"{}"); obj[lb]=ymd; localStorage.setItem(TS_KEY, JSON.stringify(obj)); } catch {}
};

// hearts
const storeHeartGet = (lb) => _S()?.getHeart(lb) ?? (()=>{
  try { return +JSON.parse(localStorage.getItem(HEARTS_KEY)||"{}")[lb] || 0; } catch { return 0; }
})();
const storeHeartInc = (lb) => { if (_S()) return _S().incrementHeart(lb);
  try { const obj = JSON.parse(localStorage.getItem(HEARTS_KEY)||"{}"); obj[lb] = (+obj[lb]||0)+1; localStorage.setItem(HEARTS_KEY, JSON.stringify(obj)); return obj[lb]; } catch { return 0; }
};


/* ---- boot meta ---- */
const BOOT_META_NAME = "app-boot";
const BOOT_SEEN_KEY  = "aud:boot:seen";

/* ---- storage keys (used elsewhere too) ---- */
const SELECTED_KEY = "aud:selectedLabel";          // sessionStorage
const MIRROR_KEY   = "aud:selectedLabel:mirror";   // localStorage broadcast
const EVT          = "aud:selectedLabel-changed";
const FALLBACK_URL = pageHref("mine.html");

/* ---- app data (map, stars, assets) ---- */
const MAX_STARS = 3;
const OK = ["thump", "miro", "whee", "track", "echo", "portal"];

const MAP = {
  miro:   { category: "play", stars: 3 },
  whee:   { category: "asmr", stars: 1 },
  thump:  { category: "asmr", stars: 1 },
  track:  { category: "play", stars: 2 },
  echo:   { category: "asmr", stars: 2 },
  portal: { category: "play", stars: 2 },
};

const IMG_SRC = {
  thump:  "./asset/thump.png",
  miro:   "./asset/miro.png",
  whee:   "./asset/whee.png",
  track:  "./asset/track.png",
  echo:   "./asset/echo.png",
  portal: "./asset/portal.png",
};

/* ---- boot-time clear (runs once per server boot id) ---- */
(function maybeBootClear(){
  // auth 준비 헬퍼
  function whenAuthReady(cb){
    if (window.auth && typeof window.auth.onChange === "function") {
      const off = window.auth.onChange((s) => {
        if (s && s.ready) { off(); cb(!!s.authed); }
      });
    } else {
      // 보수적: 인증 미확정이면 파괴적 작업 금지
      window.addEventListener("auth:state", (e) => {
        cb(!!e?.detail?.authed);
      }, { once: true });
    }
  }

  whenAuthReady((isAuthed)=>{
    if (isAuthed) return;           // 로그인 상태면 초기화 스킵

    try {
      // 1) 현재 부트 아이디 읽기
      const bootId = (document.querySelector(`meta[name="${BOOT_META_NAME}"]`)?.content || "").trim();
      if (!bootId) return;

      // 2) 이전 부트 아이디와 동일하면 스킵
      const prev = localStorage.getItem(BOOT_SEEN_KEY);
      if (prev === bootId) return;

      // 3) 게스트 전용 초기화
      try { localStorage.removeItem(HEARTS_KEY); } catch {}
      try { localStorage.removeItem(TS_KEY); } catch {}

      // 갤러리 네임스페이스 정리
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(GALLERY_PREFIX) && !/:canvas$/.test(k)) keys.push(k);
      }
      keys.forEach(k => { try { localStorage.removeItem(k); } catch {} });

      // 4) 부트 아이디 기록
      localStorage.setItem(BOOT_SEEN_KEY, bootId);
    } catch {}
  });
})();

// [PATCH][CONST] new-session sentinel (기존 그대로)
const SESSION_ALIVE_KEY = "aud:session:alive"; // sessionStorage only

// [PATCH] 새 탭/창 진입 시 초기화도 "게스트일 때만"
(function resetOnNewSession(){
  function whenAuthReady(cb){
    let fired = false;
    const done = (authed)=>{ if (fired) return; fired = true; try{ cb(!!authed); }catch{} };
    if (window.auth?.getUser) {
      window.auth.getUser().then(u => done(!!u)).catch(()=> done(false));
    } else {
      const onState = (e)=>{ done(!!e?.detail?.authed); window.removeEventListener("auth:state", onState); };
      window.addEventListener("auth:state", onState, { once: true });
    }
  }

  whenAuthReady((isAuthed) => {
    try {
      if (!sessionStorage.getItem(SESSION_ALIVE_KEY)) {
        const hasFlag = sessionStorage.getItem("auth:flag") === "1";
        if (!isAuthed && !hasFlag) {
          // ★ 여기서만 갤러리 네임스페이스 초기화 수행
          const PREFIX = (typeof GALLERY_PREFIX === "string" ? GALLERY_PREFIX : "mine:");
          const rm = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIX)) rm.push(k);
          }
          rm.forEach(k => { try { localStorage.removeItem(k); } catch {} });
          try { localStorage.removeItem(HEARTS_KEY); } catch {}
          try { localStorage.removeItem(TS_KEY); } catch {}
        }
        sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
      }
    } catch {}
  });

})();

// [NEW] 접두사 계산 + 페이지 경로 생성기
function ghPrefix() {
  const seg = location.pathname.split("/").filter(Boolean);
  const repo = seg[0] || "";
  return (repo && !/\.html?$/i.test(repo)) ? `/${repo}/` : "/";
}
function pageHref(rel = "") {
  return ghPrefix() + String(rel).replace(/^\//, "");
}


/* ========================================================================== *
 * 1) SMALL UTILS (safe JSON, clamp, DPR, etc.)
 * ========================================================================== */
const isLabel = (x) => OK.includes(String(x));

function ensureReady(fn){
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ========================================================================== *
 * 2) STATE HELPERS (selected label + cross-tab broadcast)
 * ========================================================================== */
function whenStoreReady(fn){
  if (window.store) fn();
  else window.addEventListener("store:ready", fn, { once: true });
}

function readSelected(){
  try {
    const v = sessionStorage.getItem(SELECTED_KEY);
    return (v && isLabel(v)) ? v : null;
  } catch { return null; }
}
if (typeof window !== "undefined") {
  window.SELECTED_KEY = SELECTED_KEY;               // "aud:selectedLabel"
  window.MIRROR_KEY   = MIRROR_KEY;                 // "aud:selectedLabel:mirror"
  window.EVT          = EVT;                        // "aud:selectedLabel-changed"
  window.OK           = OK;                         // ["thump","miro",...]
  window.readSelected = readSelected;               // 함수 포인터
}

// 외부에서 재사용 가능(세션 + same-tab 이벤트 + cross-tab broadcast)
function setSelectedLabel(label) {
  if (!isLabel(label)) return;
  try {
    sessionStorage.setItem(SELECTED_KEY, label);
    window.dispatchEvent(new Event(EVT));
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ label, t: Date.now() }));
    renderLabelGalleryBox();  // 라벨별 갤러리 박스 업데이트
  } catch {}
}
if (typeof window !== "undefined") window.setSelectedLabel = setSelectedLabel;

/* ========================================================================== *
 * 3) UI RENDERERS (헤더/카테고리/갤러리박스/타임스탬프/하트)
 * ========================================================================== */
function starSVG(filled){
  const fill = filled ? "#666" : "none";
  const stroke = "#666";
  return `
<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
  <path d="M12 3.6l2.6 5.26 5.81.84-4.2 4.09.99 5.77L12 17.77 6.8 20.56l.99-5.77-4.2-4.09 5.81-.84L12 3.6z"
        fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>
</svg>`;
}

function renderLastLabel(){
  const el = document.getElementById("lastLabel");
  if (!el) return;
  const label = readSelected();
  el.textContent = label ? label.toUpperCase() : "";
  el.setAttribute("aria-live", "polite");
}

function renderCategoryRow(){
  const row = document.getElementById("categoryRow");
  if (!row) return;
  row.innerHTML = "";

  const label = readSelected();
  if (!label) return;

  const info = MAP[label] || { category: "play", stars: 0 };

  const pill = document.createElement("div");
  pill.className = "pill";
  const txt = document.createElement("span");
  txt.className = "pill__text";
  txt.textContent = info.category.toUpperCase();
  pill.appendChild(txt);

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

  row.append(pill, starsPill);
}

function renderLabelGalleryBox(){
  const box = document.getElementById("labelmineGalleryBox");
  if (!box) return;
  box.innerHTML = "";

  const label = readSelected();
  if (!label) { 
    box.classList.add("is-empty"); 
    return; 
  }

  box.classList.remove("is-empty");
  const img = document.createElement("img");
  img.alt = label;
  img.src = IMG_SRC[label];
  box.appendChild(img);
}

/* ---- timestamp ---- */
const isValidYMD = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymdToDate  = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const todayYMD   = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const getTs = (label) => storeTsGet(label);
const setTs = (label, ymd) => { if (isValidYMD(ymd)) storeTsSet(label, ymd); };

function renderTimestamp(){
  const root = document.getElementById("timestamp");
  if (!root) return;

  const dataLabel = root.dataset.label || null;
  const dataDate  = root.dataset.date  || null;

  const selected = readSelected();
  const effectiveLabel = (dataLabel && isLabel(dataLabel)) ? dataLabel : selected;
  // 선택 라벨이 없다면(= 기본 상태) 아무것도 렌더하지 않음
  if (!effectiveLabel) {
    root.textContent = "";
    root.dataset.state = "empty";
    return;
  }

  if (isValidYMD(dataDate) && getTs(effectiveLabel) !== dataDate) {
    setTs(effectiveLabel, dataDate);
  }

  let ymd = isValidYMD(dataDate) ? dataDate : getTs(effectiveLabel);
  if (!isValidYMD(ymd)) {
    // 폴백 날짜 주입 대신, 해당 라벨의 TS가 없으면 화면에 날짜를 비우고 종료
    root.textContent = "";
    return;
  }

  const d = ymdToDate(ymd);
  root.textContent = isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" }).toUpperCase();
}

// hearts → store.js로 위임
const heartColorFromCount = (c) => {
  const t = 1 - Math.exp(-(c||0)/14);
  return `hsl(350, ${88 - 6*t}%, ${86 - 28*t}%)`;
};
const heartColorWhileClicked = (c) => {
  const t = Math.max(0.85, 1 - Math.exp(-(c||0)/14));
  return `hsl(350, ${88 - 6*t}%, ${86 - 30*t}%)`;
};

const getHeartCount = (label) => storeHeartGet(label) || 0;
const incHeart = (label) => storeHeartInc(label);

function createHeartSVG({ filled, color = "#777" }){
  const svg  = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d","M12.01 6.001C6.5 1 1 8 5.782 13.001L12.011 20l6.23-7C23 8 17.5 1 12.01 6.002Z");
  path.setAttribute("fill", filled ? color : "none");
  path.setAttribute("stroke", filled ? color : "#777");
  path.setAttribute("stroke-width", filled ? "0" : "1.5");
  svg.appendChild(path);
  return svg;
}

function renderHeartButton(){
  const root = document.getElementById("heartButton");
  if (!root) return;
  root.innerHTML = "";

  const label = readSelected();
  const count = label ? getHeartCount(label) : 0;
  const showFilled = count > 0;

  root.classList.toggle("is-disabled", !label);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", label ? `Like ${label}` : "Like");
  btn.style.cursor = label ? "pointer" : "default";

  let icon = createHeartSVG({ filled: showFilled, color: showFilled ? heartColorFromCount(count) : "#777" });
  btn.appendChild(icon);

  const num = document.createElement("span");
  num.textContent = String(count);

  let timerId;
  btn.addEventListener("click", () => {
    if (!label) return;

    const nBefore = getHeartCount(label);
    const tempColor = heartColorWhileClicked(nBefore + 1);
    const tempIcon  = createHeartSVG({ filled: true, color: tempColor });
    btn.replaceChildren(tempIcon);
    icon = tempIcon;

    // store.js에 누적 반영 → 서버 동기화 경유
    incHeart(label);

    const nAfter = getHeartCount(label);
    num.textContent = String(nAfter);

    clearTimeout(timerId);
    timerId = setTimeout(() => {
      const finalIcon = createHeartSVG({ filled: true, color: heartColorFromCount(nAfter) });
      btn.replaceChildren(finalIcon);
      icon = finalIcon;
    }, 420);

    // (옵션) 다른 위젯이 듣도록 이벤트 쏘고 싶다면:
    // window.dispatchEvent(new Event("label:hearts-changed"));
  });

  root.append(btn, num);
}

/* ========================================================================== *
 * 4) PAGE COMPOSE
 * ========================================================================== */
function renderLabelStory(){ /* noop */ }

function syncAll(){
  renderCategoryRow();
  renderLastLabel();
  renderLabelGalleryBox();
  renderTimestamp();
  renderHeartButton();
  renderLabelStory();
}


// ✅ 초기 부팅 시 store 준비 후 렌더/바인딩
ensureReady(() => whenStoreReady(async () => {
  const me = await (window.auth?.getUser?.().catch(() => null));
  if (!me) {
    const ret = encodeURIComponent(location.href);
    location.replace(`${pageHref('login.html')}?next=${ret}`);
    return;
  }
  syncAll();

  // same-tab
  window.addEventListener(EVT, syncAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAll();
  });
  window.addEventListener("pageshow", syncAll); // BFCache 복귀 대비

  // ✅ store가 브로드캐스트하는 변경 이벤트 수신 (이미 있던 라인 유지)
  window.addEventListener("label:hearts-changed",     () => { try { syncAll(); } catch {} });
  window.addEventListener("label:timestamps-changed", () => { try { syncAll(); } catch {} });

  // cross-tab: 선택 라벨 미러 수신 (기존 유지)
  window.addEventListener("storage", (e) => {
    if (!e) return;
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
}));

// URL ?label=... 처리 + 폴백 라우팅
(() => {
  try {
    const q = new URLSearchParams(location.search).get("label");
    if (q && isLabel(q)) {
      setSelectedLabel(q);          // ← mine에서 넘어온 선택을 먼저 반영
    } else if (!sessionStorage.getItem(SELECTED_KEY)) {
      location.replace(FALLBACK_URL);
    }
  } catch {
    location.replace(FALLBACK_URL);
  }
})();

// ensureReady polyfill on window (idempotent)
(function attachEnsureReady(){
  if (!window.ensureReady){
    window.ensureReady = (fn)=>{
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true });
      else fn();
    };
  }
})();

/* ========================================================================== *
 * /js/sdf-utils-and-store.js
 * Core utilities, icons, and local gallery store (with alpha-safe PNG saving)
 * ========================================================================== */
(function initSDFUtilsAndStore(){
  const SDF = (window.SDF = window.SDF || {});

  /** DOM ready helper */
  SDF.ensureReady = function ensureReady(cb){
    if (document.readyState === "complete" || document.readyState === "interactive") cb();
    else document.addEventListener("DOMContentLoaded", cb, { once: true });
  };

  /** Shared events & keys */
  SDF.GALLERY_EVENT = "sdf:gallery-changed";

  /** @namespace Utils */
  SDF.Utils = (function(){
    /** Clamp a value */
    function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

    /** Normalize wheel delta to pixels (why: cross-browser CTRL+wheel zoom feels consistent) */
    function wheelDeltaPx(evt){
      if ("deltaY" in evt) {
        if (evt.deltaMode === 1) return evt.deltaY * 16;
        if (evt.deltaMode === 2) return evt.deltaY * 16 * 16;
        return evt.deltaY;
      }
      const L = 16;
      const P = 800;
      const dm = evt.deltaMode || 0;
      const scale = dm === 1 ? L : dm === 2 ? P : 1;
      const abs = Math.abs(evt.deltaY) > Math.abs(evt.deltaX) ? evt.deltaY : evt.deltaX;
      return abs * scale;
    }

    function hexToRgb(hex){
      const h = hex.replace("#","");
      const r = parseInt(h.length===3 ? h[0]+h[0] : h.substring(0,2), 16);
      const g = parseInt(h.length===3 ? h[1]+h[1] : h.substring(2,4), 16);
      const b = parseInt(h.length===3 ? h[2]+h[2] : h.substring(4,6), 16);
      return [r,g,b];
    }

    const rgbToHex = (r,g,b) => `#${[r,g,b].map(n=>n.toString(16).padStart(2,"0")).join("")}`;

    function hsvToRgb(h,s,v){
      const c=v*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c;
      let rr=0,gg=0,bb=0;
      if (0<=h && h<60) [rr,gg,bb]=[c,x,0];
      else if (h<120)   [rr,gg,bb]=[x,c,0];
      else if (h<180)   [rr,gg,bb]=[0,c,x];
      else if (h<240)   [rr,gg,bb]=[0,x,c];
      else if (h<300)   [rr,gg,bb]=[x,0,c];
      else              [rr,gg,bb]=[c,0,x];
      return { r:Math.round((rr+m)*255), g:Math.round((gg+m)*255), b:Math.round((bb+m)*255) };
    }

    function rgbToHsv(r,g,b){
      const r1=r/255, g1=g/255, b1=b/255;
      const max=Math.max(r1,g1,b1), min=Math.min(r1,g1,b1), d=max-min;
      let h=0;
      if(d!==0){
        switch(max){
          case r1: h=60*(((g1-b1)/d)%6); break;
          case g1: h=60*(((b1-r1)/d)+2); break;
          case b1: h=60*(((r1-g1)/d)+4); break;
        }
      }
      if(h<0) h+=360;
      const v=max;
      const s=max===0?0:d/max;
      return {h,s,v};
    }

    function dataURLtoBlob(dataURL){
      const [meta, data] = dataURL.split(",");
      const mime = /data:(.*);base64/.exec(meta)[1];
      const bin = atob(data);
      const len = bin.length;
      const u8 = new Uint8Array(len);
      for(let i=0;i<len;i++) u8[i]=bin.charCodeAt(i);
      return new Blob([u8], {type:mime});
    }

    function blobToImage(blob){
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = fr.result;
        };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    }

    function makeThumbnail(dataURL, tw, th){
      return new Promise((resolve)=>{
        const img = new Image();
        img.onload = ()=>{
          const c = document.createElement("canvas");
          c.width = tw; c.height = th;
          const ctx = c.getContext("2d");
          ctx.fillStyle="#fff"; ctx.fillRect(0,0,tw,th); // why: predictable preview bg
          const s = Math.min(tw/img.width, th/img.height);
          const w = Math.round(img.width*s), h=Math.round(img.height*s);
          const x = Math.round((tw - w)/2), y=Math.round((th - h)/2);
          ctx.drawImage(img, x, y, w, h);
          resolve(c.toDataURL("image/jpeg", 0.9));
        };
        img.src = dataURL;
      });
    }

    function el(tag, attrs={}, ...children){
      const n = document.createElement(tag);
      for(const k in attrs){
        if (k==="style"){ n.setAttribute("style", attrs[k]); }
        else if (k in n){ n[k] = attrs[k]; }
        else { n.setAttribute(k, attrs[k]); }
      }
      for(const ch of children){
        if (typeof ch === "string") n.append(document.createTextNode(ch));
        else if (ch) n.append(ch);
      }
      return n;
    }

    return { clamp, wheelDeltaPx, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, dataURLtoBlob, blobToImage, makeThumbnail, el, trimAndPadToSquare, canvasToBlob };
  })();

  function trimAndPadToSquare(srcCanvas, { padding = 0.08, size = 1024, bg = null } = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a !== 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) { // 완전 빈 캔버스
    const out = document.createElement('canvas'); out.width = size; out.height = size; return out;
  }

  const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
  const side  = Math.max(bboxW, bboxH);
  const padPx = Math.round(side * Math.max(0, Math.min(padding, 0.45)));

  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const octx = out.getContext('2d');
  if (bg) { octx.fillStyle = bg; octx.fillRect(0, 0, size, size); }

  octx.imageSmoothingQuality = 'high';
  const scale = (size - padPx * 2) / side;
  const dw = Math.round(bboxW * scale), dh = Math.round(bboxH * scale);
  const dx = Math.round((size - dw) / 2), dy = Math.round((size - dh) / 2);

  octx.drawImage(srcCanvas, minX, minY, bboxW, bboxH, dx, dy, dw, dh);
  return out;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise(res => canvas.toBlob(b => res(b), type, quality));
}

  /** @namespace Icons */
  SDF.Icons = (function(){
    const ns = "http://www.w3.org/2000/svg";
    const mk = (size=18, view="0 0 24 24") => {
      const s=document.createElementNS(ns,"svg");
      s.setAttribute("width",size);
      s.setAttribute("height",size);
      s.setAttribute("viewBox",view);
      s.setAttribute("fill","none");
      s.setAttribute("aria-hidden","true");
      return s;
    };
    function check(size=18){
      const svg = mk(size); const p = document.createElementNS(ns,"path");
      p.setAttribute("d","M20 6L9 17l-5-5"); p.setAttribute("stroke","currentColor"); p.setAttribute("stroke-width","3"); p.setAttribute("stroke-linecap","round"); p.setAttribute("stroke-linejoin","round"); svg.append(p); return svg;
    }
    function reset(size=18, { strokeWidth=2, clockwise=true }={}){
      const svg = mk(size); const g = document.createElementNS(ns,"g");
      g.setAttribute("stroke","currentColor"); g.setAttribute("stroke-width",String(strokeWidth)); g.setAttribute("stroke-linecap","round"); g.setAttribute("stroke-linejoin","round");
      if(!clockwise) g.setAttribute("transform","scale(-1,1) translate(-24,0)");
      const path=document.createElementNS(ns,"path"); path.setAttribute("d","M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"); g.appendChild(path); svg.appendChild(g); return svg;
    }
    function imp(size=18, { strokeWidth=2 }={}){
      const svg = mk(size); const p=document.createElementNS(ns,"path");
      p.setAttribute("d","M12 11v5m0 0 2-2m-2 2-2-2M3 6v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1Zm2 2v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8H5Z");
      p.setAttribute("stroke","currentColor"); p.setAttribute("stroke-width",String(strokeWidth)); p.setAttribute("stroke-linecap","round"); p.setAttribute("stroke-linejoin","round"); svg.append(p); return svg;
    }
    function pen(size=18, { strokeWidth=2 }={}){
      const svg = mk(size); const p1=document.createElementNS(ns,"path"), p2=document.createElementNS(ns,"path");
      p1.setAttribute("d","M12 20h9"); p1.setAttribute("stroke","currentColor"); p1.setAttribute("stroke-width",String(strokeWidth)); p1.setAttribute("stroke-linecap","round");
      p2.setAttribute("d","M16.5 3.5l4 4L8 20l-4 1 1-4 11.5-13.5z"); p2.setAttribute("stroke","currentColor"); p2.setAttribute("stroke-width",String(strokeWidth)); p2.setAttribute("stroke-linejoin","round"); svg.append(p1,p2); return svg;
    }
    function eraser(size=18, { strokeWidth=2 }={}){
      const svg = mk(size); const p1=document.createElementNS(ns,"path"), p2=document.createElementNS(ns,"path");
      p1.setAttribute("d","M3 17l8-8 6 6-5 5H7z"); p2.setAttribute("d","M12 9l3-3 5 5-3 3");
      for (const p of [p1,p2]){ p.setAttribute("stroke","currentColor"); p.setAttribute("stroke-width",String(strokeWidth)); p.setAttribute("stroke-linejoin","round"); }
      svg.append(p1,p2); return svg;
    }
    function x(size=16){ const svg=mk(size); const p=document.createElementNS(ns,"path"); p.setAttribute("d","M6 6l12 12M18 6L6 18"); p.setAttribute("stroke","currentColor"); p.setAttribute("stroke-width","1.5"); p.setAttribute("stroke-linecap","round"); svg.append(p); return svg; }

    function palette(size=18, { strokeWidth=2 } = {}){
      const svg = mk(size, "0 0 24 24");
      // 실루엣 형태(채움)로 명확하게 보이도록 구성
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d",
        "M12 2a10 10 0 1 0 9.5 13.4c.28-.92-.47-1.8-1.42-1.8h-1.5a2.5 2.5 0 0 1-2.5-2.5c0-1.38-1.12-2.5-2.5-2.5h-.5A2.5 2.5 0 0 1 12 2Z" +
        "M7.5 7.75a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5Zm4 2.75a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5Zm-5 4a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5Zm8 1.5a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5Z"
      );
      p.setAttribute("fill", "currentColor");
      svg.appendChild(p);
      return svg;
    }

    return { check, reset, import: imp, pen, eraser, x, palette }; // ← [PATCH] palette 포함
  })();

  /** @namespace Store - Local gallery with alpha-preserving PNG */
  SDF.Store = (function(){
    const { makeThumbnail, dataURLtoBlob } = SDF.Utils;
    const STORAGE_PREFIX = (window.SDF_NS
      ? `mine:${window.SDF_NS}:`
      : (() => {
          try {
            const ns = (localStorage.getItem("auth:userns") || "default").trim().toLowerCase();
            return `mine:${ns}:`;
          } catch { return "mine:default:"; }
        })()
    );

    function _key(label){ return `${STORAGE_PREFIX}${label}`; }

    function _load(label){
      try { const raw = localStorage.getItem(_key(label)); return raw ? JSON.parse(raw) : []; }
      catch { return []; }
    }
    function _save(label, arr){ try { localStorage.setItem(_key(label), JSON.stringify(arr)); } catch {} }

    function getGallery(label){
      const arr = _load(label);
      return arr.map(({ id, thumbDataURL, createdAt }) => ({ id, thumbDataURL, createdAt: createdAt || new Date().toISOString() }));
    }

    // [CHANGE] 기존: const dataURL = canvas.toDataURL("image/png");
    async function addToGalleryFromCanvas(canvas, label){
      const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;

      // 🔴 정규화: 트림+패딩+정사각(1024)
      const norm = SDF.Utils.trimAndPadToSquare(canvas, { padding: 0.08, size: 1024 });

      const dataURL = norm.toDataURL("image/png"); // alpha 유지
      const thumbDataURL = await makeThumbnail(dataURL, 320, 240);

      const arr = _load(label);
      arr.unshift({ id, dataURL, thumbDataURL, createdAt: new Date().toISOString() });
      _save(label, arr);
      window.dispatchEvent(new CustomEvent(SDF.GALLERY_EVENT, { detail: { kind: "add", label, id } }));
      return id;
    }

    async function removeFromGallery(id, label){
      const arr = _load(label);
      const idx = arr.findIndex(x => x.id === id);
      if (idx >= 0){ arr.splice(idx, 1); _save(label, arr); window.dispatchEvent(new CustomEvent(SDF.GALLERY_EVENT, { detail: { kind: "remove", label, id } })); }
    }

    async function getBlob(id, label){
      try {
        const arr = _load(label);
        const hit = arr.find(x => x.id === id);
        if (hit?.dataURL) return dataURLtoBlob(hit.dataURL);
      } catch {}
      return null;
    }

    // Flexible fetch for various store adapters
    async function getGalleryBlobFlexible(id, label){
      const S = window.store || {};
      if (typeof S.getBlob === "function") {
        try { const b = (S.getBlob.length >= 2) ? await S.getBlob(id, label) : await S.getBlob(id); if (b) return b; } catch {}
      }
      for (const fn of ["getOriginalBlob","getImageBlob"]) {
        if (typeof S[fn] === "function") { try { const b = await S[fn](id, label); if (b) return b; } catch {} }
      }
      if (typeof S.getItem === "function") {
        try {
          const item = (S.getItem.length >= 2) ? await S.getItem(id, label) : await S.getItem(id);
          if (item) {
            if (item.blob)     return item.blob;
            if (item.dataURL)  return dataURLtoBlob(item.dataURL);
            if (item.url && /^data:/.test(item.url)) return dataURLtoBlob(item.url);
          }
        } catch {}
      }
      if (typeof S.getDataURL === "function") {
        try { const du = (S.getDataURL.length >= 2) ? await S.getDataURL(id, label) : await S.getDataURL(id); if (du) return dataURLtoBlob(du); } catch {}
      }
      // Fallback: read our own gallery data
      try {
        const list = getGallery(label);
        const hit = Array.isArray(list) ? list.find(x => x.id === id) : null;
        if (hit?.dataURL) return dataURLtoBlob(hit.dataURL);
      } catch {}
      return null;
    }

    // Expose adapter on window.store for compatibility
    (function exposeAdapter(){
      const w = window; if (!w.store) w.store = {};
      const tgt = w.store;
      if (!tgt.getGallery)             tgt.getGallery = (label)=>getGallery(label);
      if (!tgt.getBlob)                tgt.getBlob = (id, label)=>getBlob(id, label);
      if (!tgt.removeFromGallery)      tgt.removeFromGallery = (id,label)=>removeFromGallery(id,label);
      if (!tgt.addToGalleryFromCanvas) tgt.addToGalleryFromCanvas = (canvas,label)=>addToGalleryFromCanvas(canvas, label);
      if (!w.getGalleryBlobFlexible)   w.getGalleryBlobFlexible = getGalleryBlobFlexible;
      w.GALLERY_EVENT = SDF.GALLERY_EVENT;
    })();

    return { getGallery, addToGalleryFromCanvas, removeFromGallery, getBlob, getGalleryBlobFlexible, _key };
  })();
})();



// /js/sdf-simpledraw.js
// SimpleDraw core (Vanilla JS) — alpha-preserving save/import
// Requires: sdf-utils-and-store.js (window.SDF)

(function SimpleDrawModule(){
  const SDF = window.SDF || {};
  const ensureReady = (SDF.ensureReady || ((cb)=>document.addEventListener("DOMContentLoaded", cb, {once:true})));
  const { clamp, wheelDeltaPx, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, dataURLtoBlob, blobToImage, makeThumbnail, el } = SDF.Utils || {};
  const Icons = SDF.Icons || {};

  ensureReady(() => {
    (function SimpleDrawEmbedded(){
      const TB_H = 48, TB_ITEM = 40;
      const TB_PAD_V = Math.max(0, Math.floor((TB_H - TB_ITEM) / 2));
      const TB_PAD_H = 15;
      const OFF_DPR = 1;

      const DEFAULTS = {
        heightPx: 560,
        widthPercentVW: 80,
        offscreenInit: 4096,
        offscreenMax: 32768,
        growMargin: 256,
        growFactor: 2,
        minZoom: 0.25,
        maxZoom: 4,
        wheelZoomCoeff: 0.004,
        keyZoomStep: 1.5,
      };

      const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
      const OFF_INIT_SAFE = isMobile ? Math.min(DEFAULTS.offscreenInit, 2048) : DEFAULTS.offscreenInit;
      const OFF_MAX_SAFE  = isMobile ? Math.min(DEFAULTS.offscreenMax,   8192) : DEFAULTS.offscreenMax;

      const wrap       = document.getElementById("sdf-wrap");
      const screen     = document.getElementById("sdf-screen");
      const btnImport  = document.getElementById("sdf-import-btn");
      const btnSave    = document.getElementById("sdf-save-btn");
      const btnReset   = document.getElementById("sdf-reset-btn");
      const toolbar    = document.getElementById("sdf-toolbar");
      const tHandle    = document.getElementById("sdf-handle");
      const btnPen     = document.getElementById("sdf-pen");
      const btnEraser  = document.getElementById("sdf-eraser");
      const btnColor   = document.getElementById("sdf-color-btn");
      const chipColor  = document.getElementById("sdf-color-chip");
      const inputSize  = document.getElementById("sdf-size");
      let sctx = null;

      if (!(wrap && screen)) return;
      if (btnSave && btnSave.tagName === "BUTTON") btnSave.type = "button";

      let portalRoot = document.getElementById("sdf-portal-root");
      if (!portalRoot) { portalRoot = document.createElement("div"); portalRoot.id = "sdf-portal-root"; document.body.appendChild(portalRoot); }

      let mode = "pen";
      let size = 12;
      let color = "#111111";
      let pickerOpen = false;
      let repaintQueued = false;
      function requestRepaint(){ if (repaintQueued) return; repaintQueued = true; requestAnimationFrame(()=>{ repaintQueued = false; repaint(); }); }

      let importOpen = false;
      let importItems = [];

      let dpr = 1, viewW = 0, zoom = 1, scrollX = 0, scrollY = 0;
      let isDrawing = false, lastWorld = null;
      let offscreen = null;
      let offSize = { w: OFF_INIT_SAFE, h: OFF_INIT_SAFE };

      const pointers = new Map();
      const nav = { active:false, startZoom:1, startScrollX:0, startScrollY:0, startDist:null, anchorWorld:null };

      let tbPos = null, collapsed = false, draggingTB = null;
      const DRAG_TOL = 6;

      const OK = (window.OK || []);
      const EVT = (window.EVT || "sdf:selected-change");
      const MIRROR_KEY = (window.MIRROR_KEY || "sdf:mirror");
      const SELECTED_KEY = (window.SELECTED_KEY || "sdf:selected");
      const readSelected = (window.readSelected || (()=>null));

      let currentLabel = readSelected?.() || null;
      window.addEventListener?.(EVT, () => { currentLabel = readSelected?.(); });
      window.addEventListener("storage", (e) => { if (e.key === SELECTED_KEY || e.key === MIRROR_KEY) currentLabel = readSelected?.(); });

      function keyForPersist(label){
        const ns = (window.SDF_NS || (localStorage.getItem("auth:userns") || "default"))
                    .trim().toLowerCase();
        return `mine:${ns}:${label}:canvas`;
      }

      let saveTimer = null;
      const scheduleSave = () => { if (saveTimer) cancelAnimationFrame(saveTimer); saveTimer = requestAnimationFrame(saveState); };
      
      let idleSaveTimer = null;
      function scheduleSaveIdle(delayMs = 180){
      // why: avoid expensive offscreen.toDataURL() while the user is still zooming/panning
      if (idleSaveTimer) clearTimeout(idleSaveTimer);
      idleSaveTimer = setTimeout(()=>{ idleSaveTimer = null; scheduleSave(); }, delayMs);
      }

      let _flushLock = false;
      function flushPendingSave(){
      if (_flushLock) return;
      _flushLock = true;
      try {
      if (idleSaveTimer) { clearTimeout(idleSaveTimer); idleSaveTimer = null; }
      if (saveTimer) { cancelAnimationFrame(saveTimer); saveTimer = null; }
      // why: make sure latest zoom/scroll is persisted even if RAF is throttled
      saveState();
      } finally {
      _flushLock = false;
      }
      }
      window.addEventListener("pagehide", flushPendingSave);
      window.addEventListener("visibilitychange", ()=>{ if (document.visibilityState === "hidden") flushPendingSave(); });
      window.addEventListener("beforeunload", flushPendingSave);

      function saveState() {
        if (!offscreen) return;
        try {
          const labelForPersist = resolveEffectiveLabel();
          const dataURL = offscreen.toDataURL("image/png"); // alpha preserved
          localStorage.setItem(
            keyForPersist(labelForPersist),
            JSON.stringify({ w: offSize.w, h: offSize.h, dataURL, zoom, scrollX, scrollY, tbPos, collapsed })
          );
        } catch {}
      }

      async function loadState() {
        try {
          const labelForPersist = resolveEffectiveLabel();
          const raw = localStorage.getItem(keyForPersist(labelForPersist));
          if (!raw) return;
          const obj = JSON.parse(raw);
          if (!obj?.dataURL) return;

          offSize = { w: obj.w || OFF_INIT_SAFE, h: obj.h || OFF_INIT_SAFE };
          offscreen = document.createElement("canvas");
          offscreen.width = Math.floor(offSize.w * OFF_DPR);
          offscreen.height = Math.floor(offSize.h * OFF_DPR);
          const ctx = offscreen.getContext("2d");
          ctx.setTransform(OFF_DPR, 0, 0, OFF_DPR, 0, 0);
          await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0); resolve(); }; img.onerror = reject; img.src = obj.dataURL; });

          if (typeof obj.zoom === "number") zoom = obj.zoom;
          if (typeof obj.scrollX === "number") scrollX = obj.scrollX;
          if (typeof obj.scrollY === "number") scrollY = obj.scrollY;

          if (obj.tbPos) {
            tbPos = obj.tbPos; toolbar.classList.add("is-floating");
            Object.assign(toolbar.style, { left: `${tbPos.x}px`, top: `${tbPos.y}px`, bottom: "auto", transform: "none" });
          }
          if (typeof obj.collapsed === "boolean") { collapsed = obj.collapsed; toolbar.classList.toggle("is-collapsed", collapsed); }

          repaint(); updateCursor();
        } catch {}
      }

      (function hookFormPersistenceClear(){
        const form = screen.closest?.("form") || null; if (!form) return;
        form.addEventListener("reset", () => { try { const labelForPersist = resolveEffectiveLabel(); localStorage.removeItem(keyForPersist(labelForPersist)); } catch {} });
      })();

      // ===== Placement (ghost) =====
      let placing = { active: false, img: null, wx: 0, wy: 0, w: 0, h: 0 };
      function startPlacement(img, opt = {}) {
      const fit = opt.fit || "none"; // none | width | height | max
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      let w = naturalW, h = naturalH; // default: 1:1
      if (fit === "width"){
      const vwW = viewW / zoom; const s = vwW / w; w = Math.round(w * s); h = Math.round(h * s);
      } else if (fit === "height"){
      const vwH = DEFAULTS.heightPx / zoom; const s = vwH / h; w = Math.round(w * s); h = Math.round(h * s);
      } else if (fit === "max"){
      const vwW = viewW / zoom, vwH = DEFAULTS.heightPx / zoom; const s = Math.min(vwW / w, vwH / h); w = Math.round(w * s); h = Math.round(h * s);
      }


      placing.active = true; placing.img = img; placing.w = w; placing.h = h;
      const rect = screen.getBoundingClientRect();
      const centerLocal = { x: rect.width / 2, y: rect.height / 2 };
      const centerWorld = localToWorld(centerLocal.x, centerLocal.y);
      placing.wx = centerWorld.x - placing.w / 2; placing.wy = centerWorld.y - placing.h / 2;
      ensureCapacityForWorldRect(placing.wx, placing.wy, placing.w, placing.h);
      repaint();
      }
      function commitPlacement() {
        if (!placing.active || !placing.img) return;
        ensureCapacityForWorldRect(placing.wx, placing.wy, placing.w, placing.h);
        const octx = offscreen.getContext("2d"); octx.setTransform(OFF_DPR, 0, 0, OFF_DPR, 0, 0);
        const off = worldToOff(placing.wx, placing.wy); octx.drawImage(placing.img, off.x, off.y);
        placing.active = false; placing.img = null; repaint(); scheduleSave();
      }

      // ===== init & observers =====
      setup();
      const ro = new ResizeObserver(setup); ro.observe(wrap);
      window.addEventListener("resize", setup); window.addEventListener("orientationchange", setup);
      loadState();

      // ===== keyboard =====
      window.addEventListener("keydown", (e)=>{
        const k = e.key.toLowerCase();
        if (k === "e") setMode("eraser");
        if (k === "p") setMode("pen");
        if ((e.ctrlKey||e.metaKey) && (k==="=" || k==="+")) zoomAtCenter(DEFAULTS.keyZoomStep);
        if ((e.ctrlKey||e.metaKey) && k==="-")              zoomAtCenter(1/DEFAULTS.keyZoomStep);
        if ((e.ctrlKey||e.metaKey) && k==="0")              resetZoom();
        if (placing.active && k === "escape")               cancelPlacement();
      });

      // ===== wheel / pan / pinch =====
      wrap.addEventListener("wheel", (evt)=>{
        evt.preventDefault();
        if (evt.ctrlKey || evt.metaKey || evt.deltaZ){ const dy = wheelDeltaPx(evt); const scale = Math.exp(-dy * DEFAULTS.wheelZoomCoeff); zoomAtPoint(scale, evt.clientX, evt.clientY, wrap); return; }
        const dx = evt.shiftKey ? evt.deltaY : evt.deltaX; const dy = evt.deltaY;
        if (dx!==0 || dy!==0){ scrollX += dx / zoom; scrollY += dy / zoom; requestRepaint(); scheduleSaveIdle(); }
      }, {passive:false});

      // ===== UI bindings =====
      btnPen?.addEventListener("click", ()=> setMode("pen"));
      btnEraser?.addEventListener("click", ()=> setMode("eraser"));
      inputSize?.addEventListener("input", ()=>{ size = clamp(+inputSize.value||12, 1, 200); updateCursor(); });

      btnColor?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); pickerOpen ? closeColorPicker() : openColorPicker(); });

      if (btnImport) {
        if (btnImport.tagName === "BUTTON") btnImport.type = "button";
        if (!btnImport.classList.contains("sdf-import-btn")) btnImport.classList.add("sdf-import-btn");
        btnImport.innerHTML = ""; btnImport.append(Icons.import?.(24, { strokeWidth: 2 }) || document.createTextNode("Import"));
        const onImportClick = (e) => { e.preventDefault(); e.stopPropagation(); openImport(); };
        btnImport.addEventListener("pointerdown", (e)=>e.stopPropagation());
        btnImport.addEventListener("click", onImportClick, { passive:false });
        btnImport.addEventListener("pointerup", onImportClick, { passive:false });
        btnImport.addEventListener("touchend", onImportClick, { passive:false });
      }

      btnSave?.addEventListener("click", async (e) => {
      e.preventDefault();
      const me = await (window.auth?.getUser?.().catch(() => null));
      if (!me) {
        const ret = encodeURIComponent(location.href);
        location.replace(`${pageHref('login.html')}?next=${ret}`);
        return;
      }onSaveToGallery();
      });
      btnReset?.addEventListener("click", onResetCanvas);

      screen.addEventListener("pointerdown", onPointerDownCanvas);
      screen.addEventListener("pointermove", onPointerMoveCanvas);
      screen.addEventListener("pointerup", onPointerUpCanvas);
      screen.addEventListener("pointerleave", onPointerUpCanvas);
      screen.addEventListener("pointercancel", onPointerUpCanvas);
      screen.addEventListener("lostpointercapture", onPointerUpCanvas);

      screen.addEventListener("dblclick", (e)=>{ const scale = e.shiftKey ? 1/1.5 : 1.5; zoomAtPoint(scale, e.clientX, e.clientY, screen); });
      screen.addEventListener("contextmenu", e=> e.preventDefault());

      tHandle?.addEventListener("pointerdown", (e)=>{
        const rect = toolbar.getBoundingClientRect(); const wrapRect = wrap.getBoundingClientRect();
        draggingTB = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY, isDragging: false };
        if (!tbPos){ const x = (wrapRect.width - rect.width) / 2; const y = wrapRect.height - rect.height - 16; tbPos = { x, y }; toolbar.classList.add("is-floating"); Object.assign(toolbar.style, { left: `${tbPos.x}px`, top: `${tbPos.y}px`, bottom: "auto", transform: "none" }); scheduleSave(); }
        window.addEventListener("pointermove", onToolbarMove);
        window.addEventListener("pointerup", onToolbarUp);
        window.addEventListener("pointercancel", onToolbarUp);
      });
      tHandle?.addEventListener("pointerup", ()=>{ if (draggingTB && !draggingTB.isDragging){ collapsed = !collapsed; toolbar.classList.toggle("is-collapsed", collapsed); scheduleSave(); } });

      // ===== core impl =====
      function setup(){
        const rect = wrap.getBoundingClientRect(); const cssW = Math.max(1, Math.floor(rect.width)); viewW = cssW;
        dpr = Math.min(2, Math.max(window.devicePixelRatio||1, 1));
        Object.assign(screen.style, { width: `${cssW}px`, height: `${DEFAULTS.heightPx}px` });
        screen.width  = Math.floor(cssW * dpr); screen.height = Math.floor(DEFAULTS.heightPx * dpr);
        sctx = screen.getContext("2d", { alpha: true, desynchronized: true }); // why: UI can draw white but saved image stays transparent
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!offscreen){ offscreen = document.createElement("canvas"); offscreen.width = Math.floor(offSize.w * OFF_DPR); offscreen.height = Math.floor(offSize.h * OFF_DPR); offscreen.getContext("2d").setTransform(OFF_DPR, 0, 0, OFF_DPR, 0, 0); }
        repaint(); updateCursor(); if (chipColor) chipColor.style.background = color;
        injectToolbarIcons();
      }

      function setMode(m){ mode = m; btnPen?.classList.toggle("is-active", m==="pen"); btnEraser?.classList.toggle("is-active", m==="eraser"); updateCursor(); }

      function zoomAtCenter(scale){ const rect = wrap.getBoundingClientRect(); zoomAtPoint(scale, rect.left + rect.width/2, rect.top + DEFAULTS.heightPx/2, wrap); }

      function resetZoom(){
        const rect = wrap.getBoundingClientRect(); const targetZoom = 1; const prevZoom = zoom; if (prevZoom === targetZoom) return;
        const cx = rect.left + rect.width/2; const cy = rect.top  + DEFAULTS.heightPx/2;
        const worldX = scrollX + (cx - rect.left) / prevZoom; const worldY = scrollY + (cy - rect.top ) / prevZoom;
        scrollX = worldX - (cx - rect.left) / targetZoom; scrollY = worldY - (cy - rect.top ) / targetZoom; zoom = targetZoom;
        requestRepaint(); requestUpdateCursor(); scheduleSave();
      }

      function zoomAtPoint(scale, clientX, clientY, el){
        const next = clamp(zoom * scale, DEFAULTS.minZoom, DEFAULTS.maxZoom); if (next === zoom) return;
        const rect = el.getBoundingClientRect(); const px = clientX - rect.left; const py = clientY - rect.top;
        const worldBeforeX = scrollX + px / zoom; const worldBeforeY = scrollY + py / zoom;
        scrollX = worldBeforeX - px / next; scrollY = worldBeforeY - py / next; zoom = next;
        requestRepaint(); requestUpdateCursor(); scheduleSaveIdle();
      }

      const localToWorld = (x,y) => ({ x: scrollX + x/zoom, y: scrollY + y/zoom });
      const worldToLocal = (wx,wy) => ({ x: (wx - scrollX) * zoom, y: (wy - scrollY) * zoom });
      const worldToOff   = (wx,wy) => ({ x: wx + offSize.w/2, y: wy + offSize.h/2 });

      function ensureCapacityForWorld(wx, wy){
        const { w, h } = offSize; const { x:ox, y:oy } = worldToOff(wx, wy);
        const needW = ox < DEFAULTS.growMargin || ox > w - DEFAULTS.growMargin;
        const needH = oy < DEFAULTS.growMargin || oy > h - DEFAULTS.growMargin;
        if (!needW && !needH) return false;
        const newW = needW ? Math.min(OFF_MAX_SAFE, Math.max(w * DEFAULTS.growFactor, w + 1024)) : w;
        const newH = needH ? Math.min(OFF_MAX_SAFE, Math.max(h * DEFAULTS.growFactor, h + 1024)) : h;
        if (newW === w && newH === h) return false;
        const old = offscreen; const next = document.createElement("canvas");
        next.width  = Math.floor(newW * OFF_DPR); next.height = Math.floor(newH * OFF_DPR);
        const nctx = next.getContext("2d"); nctx.setTransform(1,0,0,1,0,0);
        const dxDev = Math.floor(((newW - w)/2) * OFF_DPR); const dyDev = Math.floor(((newH - h)/2) * OFF_DPR);
        nctx.drawImage(old, dxDev, dyDev);
        offscreen = next; offSize = { w:newW, h:newH }; return true;
      }
      function ensureCapacityForWorldRect(wx, wy, ww, wh){ ensureCapacityForWorld(wx, wy); ensureCapacityForWorld(wx + ww, wy); ensureCapacityForWorld(wx, wy + wh); ensureCapacityForWorld(wx + ww, wy + wh); }

      function beginStroke(wx, wy){
        ensureCapacityForWorld(wx, wy);
        const octx = offscreen.getContext("2d"); octx.setTransform(OFF_DPR,0,0,OFF_DPR,0,0);
        if (mode === "eraser") { octx.globalCompositeOperation = "destination-out"; octx.strokeStyle = "rgba(0,0,0,1)"; octx.lineWidth = size * 1.2; octx.lineCap = "round"; octx.lineJoin = "round"; }
        else { octx.globalCompositeOperation = "source-over"; const [r, g, b] = hexToRgb(color); octx.strokeStyle = `rgba(${r},${g},${b},1)`; octx.lineWidth = size; octx.lineCap = "round"; octx.lineJoin = "round"; }
        const {x:ox, y:oy} = worldToOff(wx, wy); octx.beginPath(); octx.moveTo(ox, oy); isDrawing = true; lastWorld = { x:wx, y:wy };
      }
      function strokeTo(wx, wy){
        if (!isDrawing) return; const grew = ensureCapacityForWorld(wx, wy);
        const octx = offscreen.getContext("2d"); octx.setTransform(OFF_DPR,0,0,OFF_DPR,0,0);
        if (grew && lastWorld){ const {x:lx, y:ly} = lastWorld; const prev = worldToOff(lx, ly); octx.beginPath(); octx.moveTo(prev.x, prev.y); }
        const {x:ox, y:oy} = worldToOff(wx, wy); octx.lineTo(ox, oy); octx.stroke(); lastWorld = { x:wx, y:wy }; requestRepaint();
      }
      function endStroke(){ if (!isDrawing) return; offscreen.getContext("2d").closePath(); isDrawing = false; lastWorld = null; scheduleSave(); }

      function onPointerDownCanvas(e){
        e.preventDefault();
        if (placing.active) { const rect = screen.getBoundingClientRect(); const local = { x:e.clientX - rect.left, y:e.clientY - rect.top }; const world = localToWorld(local.x, local.y); placing.wx = world.x - placing.w/2; placing.wy = world.y - placing.h/2; commitPlacement(); return; }
        screen.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { id:e.pointerId, x:e.clientX, y:e.clientY, type:e.pointerType });
        if (pointers.size >= 2){ const rect = wrap.getBoundingClientRect(); const center = getPointersCenter(); const dist = Math.max(1, getPointersDistance()); const px = center.x - rect.left; const py = center.y - rect.top; const anchorWorldX = scrollX + px / zoom; const anchorWorldY = scrollY + py / zoom; if (isDrawing) endStroke(); Object.assign(nav, { active: true, startZoom: zoom, startScrollX: scrollX, startScrollY: scrollY, startDist: dist, anchorWorld: { x:anchorWorldX, y:anchorWorldY } }); return; }
        const rect = screen.getBoundingClientRect(); const local = { x:e.clientX - rect.left, y:e.clientY - rect.top }; const world = localToWorld(local.x, local.y); beginStroke(world.x, world.y);
      }
      function onPointerMoveCanvas(e){
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { id:e.pointerId, x:e.clientX, y:e.clientY, type:e.pointerType });
        if (placing.active){ e.preventDefault(); const rect = screen.getBoundingClientRect(); const local = { x:e.clientX - rect.left, y:e.clientY - rect.top }; const world = localToWorld(local.x, local.y); placing.wx = world.x - placing.w/2; placing.wy = world.y - placing.h/2; requestRepaint(); return; }
        if (nav.active && pointers.size >= 2){ e.preventDefault(); const rect = wrap.getBoundingClientRect(); const center = getPointersCenter(); const dist = Math.max(1, getPointersDistance()); const startZoom = nav.startZoom; const startDist = nav.startDist; const anchor = nav.anchorWorld; const scale = dist / startDist; const nextZoom = clamp(startZoom * scale, DEFAULTS.minZoom, DEFAULTS.maxZoom); const px = center.x - rect.left; const py = center.y - rect.top; scrollX = anchor.x - px / nextZoom; scrollY = anchor.y - py / nextZoom; zoom = nextZoom; requestRepaint(); requestUpdateCursor(); scheduleSaveIdle(); return; }
        if (isDrawing){ e.preventDefault(); const rect = screen.getBoundingClientRect(); const local = { x:e.clientX - rect.left, y:e.clientY - rect.top }; const world = localToWorld(local.x, local.y); strokeTo(world.x, world.y); }
      }
      function onPointerUpCanvas(e){ e.preventDefault(); pointers.delete(e.pointerId); if (nav.active){ if (pointers.size < 2){ Object.assign(nav, { active:false, startDist:null, anchorWorld:null });scheduleSave(); } return; } endStroke(); }

      function getPointersCenter(){ const pts = [...pointers.values()]; const sum = pts.reduce((acc,p)=>({x:acc.x+p.x, y:acc.y+p.y}), {x:0,y:0}); const n = Math.max(1, pts.length); return { x: sum.x/n, y: sum.y/n }; }
      function getPointersDistance(){ const pts = [...pointers.values()]; if (pts.length < 2) return 0; const a = pts[0], b=pts[1]; return Math.hypot(a.x-b.x, a.y-b.y); }

      function repaint(){
        if (!sctx) return; const cssW = viewW; sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sctx.clearRect(0, 0, cssW, DEFAULTS.heightPx); sctx.fillStyle = "transparent"; sctx.fillRect(0, 0, cssW, DEFAULTS.heightPx);
        if (offscreen){
          const OFF_W = offSize.w, OFF_H = offSize.h; const vwX = scrollX, vwY = scrollY; const vwW = cssW / zoom, vwH = DEFAULTS.heightPx / zoom;
          const offWorldX = -OFF_W/2, offWorldY = -OFF_H/2; const offWorldW = OFF_W, offWorldH = OFF_H;
          const ix  = Math.max(vwX, offWorldX); const iy  = Math.max(vwY, offWorldY); const ix2 = Math.min(vwX+vwW, offWorldX+offWorldW); const iy2 = Math.min(vwY+vwH, offWorldY+offWorldH); const iw = ix2 - ix, ih = iy2 - iy;
          if (iw > 0 && ih > 0){
            const sxCss = ix + OFF_W/2; const syCss = iy + OFF_H/2; const swCss = iw, shCss = ih;
            const sxDev = Math.floor(sxCss * OFF_DPR); const syDev = Math.floor(syCss * OFF_DPR); const swDev = Math.floor(swCss * OFF_DPR); const shDev = Math.floor(shCss * OFF_DPR);
            const dxCss = (ix - vwX) * zoom; const dyCss = (iy - vwY) * zoom; const dwCss = iw * zoom; const dhCss = ih * zoom;
            sctx.drawImage(offscreen, sxDev, syDev, swDev, shDev, dxCss, dyCss, dwCss, dhCss);
          }
        }
        if (placing.active && placing.img){ const tl = worldToLocal(placing.wx, placing.wy); sctx.save(); sctx.globalAlpha = 0.5; sctx.drawImage(placing.img, tl.x, tl.y, placing.w * zoom, placing.h * zoom); sctx.restore(); }
      }

      function injectToolbarIcons(){ try { const bPen = document.getElementById("sdf-pen"); const bEra = document.getElementById("sdf-eraser"); if (bPen){ bPen.innerHTML = ""; bPen.append(Icons.pen?.(24,{ strokeWidth:2 }) || document.createTextNode("Pen")); } if (bEra){ bEra.innerHTML = ""; bEra.append(Icons.eraser?.(24,{ strokeWidth:2 }) || document.createTextNode("Eraser")); } } catch {} }

      function resolveEffectiveLabel() {
        try {
          const sel = (typeof readSelected === "function" ? readSelected() : null) || currentLabel; if (sel && typeof sel === "string") return sel;
          const skey = (window.SELECTED_KEY || "sdf:selected"); const fromSS = sessionStorage.getItem(skey); if (fromSS) return fromSS;
          if (Array.isArray(window.OK) && window.OK.length) return window.OK[0];
        } catch {}
        return "default";
      }

      function exportViewportCanvas(){
      const cssW = Math.max(1, Math.floor(viewW));
      const cssH = DEFAULTS.heightPx;
      const vwX = scrollX, vwY = scrollY; // viewport origin in world units
      const worldW = Math.max(1, Math.floor(cssW / zoom)); // 1:1 export width in world px
      const worldH = Math.max(1, Math.floor(cssH / zoom)); // 1:1 export height in world px


      const out = document.createElement("canvas");
      out.width = worldW; out.height = worldH; // 🔴 key: no CSS zoom baked in
      const ctx = out.getContext("2d", { alpha: true });
      if (!offscreen) return out;


      const OFF_W = offSize.w, OFF_H = offSize.h;
      const offWorldX = -OFF_W/2, offWorldY = -OFF_H/2;


      // intersect visible world rect with offscreen world rect
      const ix = Math.max(vwX, offWorldX);
      const iy = Math.max(vwY, offWorldY);
      const ix2 = Math.min(vwX + worldW, offWorldX + OFF_W);
      const iy2 = Math.min(vwY + worldH, offWorldY + OFF_H);
      const iw = ix2 - ix, ih = iy2 - iy;
      if (iw <= 0 || ih <= 0) return out;


      // source rect in offscreen (device) pixels
      const sxCss = ix + OFF_W/2; const syCss = iy + OFF_H/2;
      const swCss = iw; const shCss = ih;
      const sxDev = Math.floor(sxCss * OFF_DPR);
      const syDev = Math.floor(syCss * OFF_DPR);
      const swDev = Math.floor(swCss * OFF_DPR);
      const shDev = Math.floor(shCss * OFF_DPR);


      // dest rect in *world* pixels (1:1)
      const dx = ix - vwX; const dy = iy - vwY; const dw = iw; const dh = ih;
      ctx.clearRect(0, 0, worldW, worldH);
      ctx.drawImage(offscreen, sxDev, syDev, swDev, shDev, dx, dy, dw, dh);


      // include ghost placement at 1:1 if active
      if (placing.active && placing.img){
      const tlx = placing.wx - vwX; const tly = placing.wy - vwY;
      ctx.drawImage(placing.img, Math.round(tlx), Math.round(tly));
      }
      return out;
      }

      function __visibleCanvases(root){
      const list = Array.from((root||document).querySelectorAll("canvas"));
      return list.filter((c)=>{
      const cs = getComputedStyle(c);
      return cs.display !== "none" && cs.visibility !== "hidden" && c.width > 0 && c.height > 0;
      });
      }
      function __mergeVisibleCanvases(root){
      const target = root || document;
      const canvases = __visibleCanvases(target);
      if (!canvases.length) return null;
      const rect = (document.getElementById("sdf-screen") || target).getBoundingClientRect();
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(rect.width * dpr));
      out.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = out.getContext("2d");
      for (const c of canvases){ try { ctx.drawImage(c, 0, 0, out.width, out.height); } catch {} }
      return out;
      }

      // [PATCH][helper] quick blank-check (sample few pixels)
      function isCanvasBlank(canvas){
      try {
      const ctx = canvas.getContext("2d");
      const w = Math.max(1, canvas.width|0), h = Math.max(1, canvas.height|0);
      const pts = [
      [0,0], [w-1,0], [0,h-1], [w-1,h-1], [w>>1, h>>1], [w>>2, h>>2], [(w*3)>>2, (h*3)>>2]
      ];
      for (const [x,y] of pts){
      const d = ctx.getImageData(Math.max(0,x), Math.max(0,y), 1, 1).data;
      if (d[3] !== 0 || d[0] || d[1] || d[2]) return false;
      }
      } catch {}
      return true;
      }


      // [PATCH][helper] collect visible canvases under the draw screen
      function visibleCanvasesUnderScreen(){
      const root = document.getElementById("sdf-screen")?.parentElement || document;
      const list = Array.from(root.querySelectorAll("canvas"));
      return list.filter((c)=>{
      try {
      const cs = getComputedStyle(c);
      return cs.display !== "none" && cs.visibility !== "hidden" && c.width>0 && c.height>0;
      } catch { return false; }
      });
      }


      // [PATCH][helper] merge multi-layer canvases as a faithful snapshot
      function mergeFromScreen(){
      const screen = document.getElementById("sdf-screen");
      if (!screen) return null;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const out = document.createElement("canvas");
      // Prefer device size to keep sharpness after zoom
      out.width = screen.width || Math.max(1, Math.round(screen.getBoundingClientRect().width * dpr));
      out.height = screen.height || Math.max(1, Math.round(screen.getBoundingClientRect().height * dpr));
      const ctx = out.getContext("2d");
      for (const c of visibleCanvasesUnderScreen()){
      try { ctx.drawImage(c, 0, 0, out.width, out.height); } catch {}
      }
      return out;
      }


      // [PATCH][helper] robust snapshot: try 1) exporter 2) DOM-merge fallback
      async function snapshotCanvas(){
      try {
      const c = exportViewportCanvas();
      if (c && !isCanvasBlank(c)) return c;
      } catch {}
      const merged = mergeFromScreen();
      return merged || document.querySelector("canvas") || null;
      }

      async function onSaveToGallery(){
        const label = resolveEffectiveLabel();
        const canSave = window.store && typeof window.store.addToGalleryFromCanvas === "function";
        if (!canSave){ console.warn("[Save] store/addToGalleryFromCanvas 없음"); return; }
        const prevHTML = btnSave?.innerHTML; const prevDisabled = btnSave?.disabled;
        if (btnSave){ btnSave.disabled = true; btnSave.setAttribute("aria-busy","true"); btnSave.textContent = "Saving..."; }
        try {
          let snap = null;
          try { snap = exportViewportCanvas?.(); } catch {}
          if (!snap || !(snap instanceof HTMLCanvasElement) || snap.width===0 || snap.height===0){
            // Fallback: WYSIWYG merge of currently visible canvases (post-zoom safe)
            snap = __mergeVisibleCanvases(document.getElementById("sdf-screen") || document);
            if (!snap) throw new Error("No canvas to snapshot");
          }
          await window.store.addToGalleryFromCanvas(snap, label);
          if (btnSave){ btnSave.textContent = ""; btnSave.append(Icons.check?.() || document.createTextNode("OK")); btnSave.classList.add("is-active"); setTimeout(()=>{ btnSave.classList.remove("is-active"); btnSave.textContent = "Save"; }, 900); }
        } catch (err) {
          console.error("[Save] 실패:", err);
          if (btnSave){ btnSave.textContent = "Error"; btnSave.classList.add("is-active"); setTimeout(()=>{ btnSave.classList.remove("is-active"); btnSave.innerHTML = prevHTML || "Save"; }, 1200); }
        } finally {
          if (btnSave){ btnSave.disabled = prevDisabled || false; btnSave.removeAttribute("aria-busy"); }
        }
      }

      async function onResetCanvas(){ if (!offscreen) return; offscreen.getContext("2d").clearRect(0, 0, offSize.w, offSize.h); try { localStorage.removeItem(keyForPersist(resolveEffectiveLabel())); } catch {} repaint(); if (btnReset){ btnReset.textContent = ""; btnReset.append(Icons.reset?.() || document.createTextNode("↻")); btnReset.classList.add("is-active"); setTimeout(()=>{ btnReset.classList.remove("is-active"); btnReset.textContent = "Reset"; }, 1000); } }

      async function openImport(){
        const ws = window.store; if (!ws || typeof ws.getGallery !== "function") { console.warn("[Import] store.getGallery가 없습니다."); return; }
        const candidates = Array.from(new Set([ (typeof readSelected === "function" ? readSelected() : null) || null, currentLabel || null, (typeof resolveEffectiveLabel === "function" ? resolveEffectiveLabel() : null) || null, ...(Array.isArray(OK) ? OK : []), "default" ].filter(Boolean)));
        let picked = null; let items = [];
        for (const lb of candidates) { try { const list = ws.getGallery(lb) || []; if (Array.isArray(list) && list.length) { picked = lb; items = list; break; } } catch {} }
        if (!picked || !items.length) { console.warn("[Import] 불러올 갤러리 이미지가 없습니다. 후보=", candidates); return; }
        currentLabel = picked; importItems = items; setImportOpen(true);
      }

      function setImportOpen(next){ if (next === importOpen) return; importOpen = next; if (importOpen) renderImportModal(); else removeImportModal(); }

      function renderImportModal(){
        removeImportModal();
        const backdrop = el("div",{ class:"sdf-modal-backdrop", "data-import":"backdrop" });
        const modal    = el("div",{ class:"sdf-modal", onclick:(e)=>e.stopPropagation() });
        const head     = el("div",{ class:"sdf-modal-head" });
        const title    = el("h3",{ class:"sdf-modal-title" },"Gallery");
        const btnClose = el("button",{ class:"sdf-modal-close", title:"닫기", "aria-label":"close", onclick:()=>setImportOpen(false) }, Icons.x?.(16) || document.createTextNode("×"));
        head.append(title, btnClose);
        const body = el("div",{ class:"sdf-modal-body" });
        if (!importItems.length){ body.append(el("div",{ class:"sdf-empty" },"저장된 이미지가 없습니다.")); }
        else {
          const grid = el("div",{ class:"sdf-grid" });
          const choose = (id)=> onPick(id);
          importItems.forEach(it => { const btn = el("button", { type: "button" }); btn.dataset.id = it.id; btn.addEventListener("click", (e)=> onPick(it.id, e)); const img = el("img", { src: it.thumbDataURL, alt: "", draggable: false }); btn.append(img); grid.append(btn); });
          body.append(grid);
        }
        modal.append(head, body); backdrop.append(modal); backdrop.addEventListener("click", (e)=>{ if (e.target === backdrop) setImportOpen(false); }); 
        // [PATCH] Asset(갤러리) 모달 전역 X (고정 버튼)
        const fixedClose = el(
          "button",
          { class: "im-head-close", type: "button", onclick: () => setImportOpen(false) },
          el("span", { class: "im-x" })
        );
        backdrop.append(fixedClose);

        portalRoot.append(backdrop);
        const escCloseOnce = (e) => { if (e.key === "Escape"){ setImportOpen(false); window.removeEventListener("keydown", escCloseOnce); } }; window.addEventListener("keydown", escCloseOnce);
      }
      function removeImportModal(){ const node = portalRoot.querySelector('[data-import="backdrop"]'); node?.remove(); }
      function onPick(id, evt){
      const opt = (evt?.shiftKey) ? { fit: "width" } : { fit: "none" }; // Shift=fit width
      loadGalleryItemToCanvas(id, opt);
      }
      async function loadGalleryItemToCanvas(id, opt){
      if (!currentLabel) return;
      try {
      const blob = await getGalleryBlobFlexible(id, currentLabel);
      if (!blob) return;
      const img = await blobToImage(blob);
      startPlacement(img, opt || { fit: "none" }); // 🔴 default preserve original
      setImportOpen(false);
      } catch (e) { console.warn("[Import] failed:", e); }
      }
      // ===== Color Picker (wheel) =====
      function makeColorWheel(size, initHex, initV = 1, onChange) {
        const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size; canvas.style.display = "block"; canvas.style.borderRadius = "50%"; canvas.style.touchAction = "none";
        const initRGB = hexToRgb(initHex); const initHSV = rgbToHsv(initRGB[0], initRGB[1], initRGB[2]); const state = { h: initHSV.h, s: initHSV.s, v: (typeof initV === "number" ? clamp(initV, 0, 1) : initHSV.v) };
        const pointer = { x: size / 2, y: size / 2 };
        (function syncPointer(){ const cx = size / 2, cy = size / 2, radius = size / 2 - 1; const theta = (state.h / 360) * Math.PI * 2; pointer.x = cx + Math.cos(theta) * state.s * radius; pointer.y = cy + Math.sin(theta) * state.s * radius; })();
        function currentHex() { const { r, g, b } = hsvToRgb(state.h, state.s, state.v); return rgbToHex(r, g, b); }
        function render() {
          const ctx = canvas.getContext("2d"); const dpr = Math.max(window.devicePixelRatio || 1, 1); canvas.style.width = `${size}px`; canvas.style.height = `${size}px`; const W = Math.floor(size * dpr), H = Math.floor(size * dpr); canvas.width = W; canvas.height = H;
          const img = ctx.createImageData(W, H), data = img.data; const cx = W / 2, cy = H / 2, radius = Math.min(W, H) / 2;
          for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) { const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy), idx = (y * W + x) * 4; if (dist > radius) { data[idx + 3] = 0; continue; } let theta = Math.atan2(dy, dx); if (theta < 0) theta += Math.PI * 2; const h = (theta / (Math.PI * 2)) * 360; const s = dist / radius; const { r, g, b } = hsvToRgb(h, s, state.v); data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255; } }
          ctx.putImageData(img, 0, 0);
          ctx.beginPath(); ctx.arc(cx, cy, radius - 0.5 * dpr, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0,0,0,0.06)"; ctx.lineWidth = 1 * dpr; ctx.stroke();
          ctx.save(); ctx.scale(dpr, dpr); ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 3, 0, Math.PI * 2); ctx.lineWidth = 0.5; ctx.strokeStyle = "#111"; ctx.stroke(); ctx.restore();
        }
        render();
        let dragging = false; canvas.addEventListener("pointerdown", e => { dragging = true; pick(e); }); canvas.addEventListener("pointermove", e => { if (dragging) pick(e); }); ["pointerup", "pointercancel", "pointerleave"].forEach(t => canvas.addEventListener(t, () => { dragging = false; }));
        function pick(e) { const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top; const cx = size / 2, cy = size / 2, maxR = size / 2 - 1; const dx = x - cx, dy = y - cy; const dist = Math.hypot(dx, dy); const clampedR = Math.min(dist, maxR); let theta = Math.atan2(dy, dx); if (theta < 0) theta += Math.PI * 2; state.h = (theta / (Math.PI * 2)) * 360; state.s = clampedR / maxR; pointer.x = cx + Math.cos(theta) * clampedR; pointer.y = cy + Math.sin(theta) * clampedR; render(); if (typeof onChange === "function") onChange(currentHex(), { ...state }); }
        function setV(v) { state.v = clamp(v, 0, 1); render(); if (typeof onChange === "function") onChange(currentHex(), { ...state }); }
        function setHSV({ h, s, v }) { if (typeof h === "number") state.h = ((h % 360) + 360) % 360; if (typeof s === "number") state.s = clamp(s, 0, 1); if (typeof v === "number") state.v = clamp(v, 0, 1); const cx = size / 2, cy = size / 2, radius = size / 2 - 1; const theta = (state.h / 360) * Math.PI * 2; const px = cx + Math.cos(theta) * state.s * radius; const py = cy + Math.sin(theta) * state.s * radius; pointer.x = px; pointer.y = py; render(); }
        function getHSV() { return { ...state }; }
        return { el: canvas, setV, setHSV, getHSV };
      }

      function positionColorPanel(){ if (!pickerOpen) return; const panel = document.getElementById("sdf-color-panel"); if (!panel) return; const br = btnColor.getBoundingClientRect(); const px = br.left + br.width / 2; const py = br.bottom + 10; panel.style.setProperty("--pop-x", px + "px"); panel.style.setProperty("--pop-y", py + "px"); }

      function openColorPicker(){
        if (pickerOpen) return; pickerOpen = true;
        const panel = el("div", { id: "sdf-color-panel", class: "sdf-color-panel" });
        const [cr, cg, cb] = hexToRgb(color); const initHSV = rgbToHsv(cr, cg, cb); let currentV = 1;
        const wheel = makeColorWheel(180, color, currentV, (hex, hsv) => { color = hex; if (chipColor) chipColor.style.background = color; currentV = hsv.v; requestUpdateCursor(); updateSliderBg(hsv.h, hsv.s); slider.value = Math.round(currentV * 100); });
        const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.max = 100; slider.value = 100; slider.className = "sdf-brightness"; slider.addEventListener("input", () => { currentV = slider.value / 100; wheel.setV(currentV); });
        function updateSliderBg(h, s){ const left  = rgbToHex(...Object.values(hsvToRgb(h, s, 0))); const right = rgbToHex(...Object.values(hsvToRgb(h, s, 1))); slider.style.background = `linear-gradient(to right, ${left}, ${right})`; }
        updateSliderBg(initHSV.h, initHSV.s);
        panel.append(wheel.el, slider); panel.addEventListener("click", (e)=> e.stopPropagation()); portalRoot.append(panel);
        positionColorPanel(); window.addEventListener("resize", positionColorPanel); window.addEventListener("scroll", positionColorPanel, true);
      }
      function closeColorPicker(){ const panel = document.getElementById("sdf-color-panel"); if (panel) panel.remove(); pickerOpen = false; window.removeEventListener("resize", positionColorPanel); window.removeEventListener("scroll", positionColorPanel, true); }

      function updateCursor(){
        const SCALE = 1.0, MIN_R = 1.5, MAX_R = 40, RING_WIDTH = 2;
        const baseLineWidth = (mode === "eraser") ? (size * 1.2) : size; const lineWidthScreenPx = baseLineWidth * zoom;
        const r = Math.max(MIN_R, Math.min(MAX_R, Math.round((lineWidthScreenPx * SCALE) / 2))); const pad = 2; const C = (r + pad) * 2 + 1;
        const c = document.createElement("canvas"); c.width = C; c.height = C; const ctx = c.getContext("2d"); ctx.clearRect(0, 0, C, C); ctx.translate(C / 2, C / 2);
        if (mode === "eraser") { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = RING_WIDTH; ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke(); }
        const url = c.toDataURL("image/png"); const hx = (C / 2); const hy = (C / 2); screen.style.cursor = `url(${url}) ${hx} ${hy}, crosshair`;
      }
      let cursorQueued = false; function requestUpdateCursor(){ if (cursorQueued) return; cursorQueued = true; requestAnimationFrame(()=>{ cursorQueued = false; updateCursor(); }); }

      function onToolbarMove(e){ if (!draggingTB) return; const wrapRect = wrap.getBoundingClientRect(); const nx = clamp(e.clientX - draggingTB.dx - wrapRect.left, 0, wrapRect.width  - toolbar.offsetWidth ); const ny = clamp(e.clientY - draggingTB.dy - wrapRect.top,  0, DEFAULTS.heightPx - toolbar.offsetHeight); if (Math.hypot(e.clientX - draggingTB.startX, e.clientY - draggingTB.startY) > DRAG_TOL){ draggingTB.isDragging = true; } tbPos = { x: nx, y: ny }; toolbar.classList.add("is-floating"); Object.assign(toolbar.style, { left: `${tbPos.x}px`, top: `${tbPos.y}px`, bottom: "auto", transform: "none" }); if (pickerOpen) positionColorPanel(); }
      function onToolbarUp(){ window.removeEventListener("pointermove", onToolbarMove); window.removeEventListener("pointerup", onToolbarUp); window.removeEventListener("pointercancel", onToolbarUp); draggingTB = null; scheduleSave(); closeColorPicker(); }

    })();
  });
})();

// /js/sdf-gallery-horizontal.js
// GalleryHorizontal (vanilla) — window.SDF / window.store 기반
// - 중복된 render/이벤트 블록 통합
// - 스코프/의존성 정리
// - 누락된 SVG_SELECT 추가
// - aria-pressed, title, lazy 로딩 등 소소한 접근성 강화

// /js/sdf-gallery-horizontal.js
// GalleryHorizontal (vanilla) — window.SDF / window.store 기반
// - 선택 버튼(gh-selectBtn) 및 관련 상태/이벤트 완전 제거
// - 삭제/다운로드/갤러리 갱신만 유지

(function GalleryHorizontalModule() {
  const SDF = window.SDF || {};
  const ensureReady =
    SDF.ensureReady ||
    ((cb) =>
      document.readyState === "loading"
        ? document.addEventListener("DOMContentLoaded", cb, { once: true })
        : cb());

  ensureReady(() => {
    // ----- 기본 노드 -----
    const rail = document.getElementById("gh-rail");
    const host = document.querySelector(".gh-outer");
    if (!rail || !host) return;

    // ----- 외부에서 주입되는 키/이벤트 -----
    const OK = Array.isArray(window.OK) ? window.OK : [];
    const SELECTED_KEY = window.SELECTED_KEY || "aud:selectedLabel";
    const GALLERY_EVENT =
      window.GALLERY_EVENT || (SDF && SDF.GALLERY_EVENT) || "sdf:gallery-changed";
    const EVT = window.EVT || "aud:selectedLabel-changed";
    const MIRROR_KEY = window.MIRROR_KEY || "aud:selectedLabel:mirror";

    // ----- 환경/유틸 -----
    const isTouch = (() => {
      try {
        const ua = navigator.userAgent || "";
        const mtp = (navigator.maxTouchPoints || 0) > 1;
        return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || mtp;
      } catch {
        return false;
      }
    })();

    const fmtDate = (iso) => {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y} / ${m} / ${day}`;
    };

    const SVG_TRASH = `
<svg class="gh-icon gh-icon--trash" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="3 6 5 6 21 6"></polyline>
  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
  <path d="M10 11v6"></path>
  <path d="M14 11v6"></path>
  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
</svg>`;

    const SVG_DOWNLOAD = `
<svg class="gh-icon" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
  <polyline points="7 10 12 15 17 10"></polyline>
  <line x1="12" y1="15" x2="12" y2="3"></line>
</svg>`;

    // ----- store adapter helpers -----
    const getItems = async (label) => {
      const S = window.store;
      if (!label || !S || typeof S.getGallery !== "function") return [];
      try {
        return S.getGallery(label) || [];
      } catch {
        return [];
      }
    };

    const getBlobForDownload = async (id, label) => {
      const S = window.store || {};
      try {
        if (typeof S.getBlob === "function") {
          const b =
            S.getBlob.length >= 2 ? await S.getBlob(id, label) : await S.getBlob(id);
          if (b) return b;
        }
        if (typeof window.getGalleryBlobFlexible === "function") {
          const b = await window.getGalleryBlobFlexible(id, label);
          if (b) return b;
        }
      } catch {}
      return null;
    };

    // ----- 라벨 결정 -----
    const resolveEffectiveLabel = () => {
      try {
        const sel =
          typeof window.readSelected === "function" ? window.readSelected() : null;
        if (sel && typeof sel === "string") return sel;

        const fromSS = sessionStorage.getItem(SELECTED_KEY);
        if (fromSS) return fromSS;

        const fixed = host.getAttribute("data-label");
        if (fixed && (!OK.length || OK.includes(fixed))) return fixed;

        if (OK.length) return OK[0];
      } catch {}
      return "default";
    };

    // ----- DOM helper -----
    const makeBtn = ({ title, aria, className, svg }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-label", aria);
      btn.className = className;
      btn.innerHTML = svg;
      return btn;
    };

    // ----------------------------------
    // 상태
    // ----------------------------------
    let effectiveLabel = resolveEffectiveLabel();
    let rafId = null;

    // ----------------------------------
    // 렌더
    // ----------------------------------
    function render(items) {
      rail.innerHTML = "";

      if (!items?.length) {
        const empty = document.createElement("div");
        empty.className = "gh-empty";
        rail.appendChild(empty);
        return;
      }

      for (const it of items) {
        const card = document.createElement("div");
        card.className = "gh-card";
        card.dataset.id = it.id;
        if (isTouch) card.classList.add("isTouch");

        // 썸네일
        const img = document.createElement("img");
        img.src = it.thumbDataURL;
        img.alt = "";
        img.draggable = false;
        img.loading = "lazy";
        img.className = "gh-thumb";
        img.addEventListener("dragstart", (e) => e.preventDefault());
        card.appendChild(img);

        // 삭제
        const delBtn = makeBtn({
          title: "삭제",
          aria: "삭제",
          className: "gh-deleteBtn",
          svg: SVG_TRASH,
        });
        delBtn.addEventListener("click", async () => {
          const labelNow = resolveEffectiveLabel();
          const S = window.store;
          if (!S || typeof S.removeFromGallery !== "function" || !labelNow) return;

          await S.removeFromGallery(it.id, labelNow);
          refresh();
        });
        card.appendChild(delBtn);

        // 다운로드
        const dlBtn = makeBtn({
          title: "다운로드",
          aria: "다운로드",
          className: "gh-downloadBtn",
          svg: SVG_DOWNLOAD,
        });
        dlBtn.addEventListener("click", async () => {
          const labelNow = resolveEffectiveLabel();
          const blob = await getBlobForDownload(it.id, labelNow);
          if (!blob) return;

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${labelNow}-drawing-${it.id}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        });
        card.appendChild(dlBtn);

        // 날짜 배지
        const badge = document.createElement("div");
        badge.className = "gh-dateBadge";
        badge.textContent = fmtDate(it.createdAt || new Date().toISOString());
        card.appendChild(badge);

        rail.appendChild(card);
      }
    }

    // ----------------------------------
    // 새로고침
    // ----------------------------------
    const refresh = (forceLabel) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(async () => {
        const labelToUse = forceLabel || effectiveLabel || resolveEffectiveLabel();
        effectiveLabel = labelToUse;
        const items = await getItems(labelToUse);
        render(items);
        rafId = null;
      });
    };

    // ----------------------------------
    // 이벤트
    // ----------------------------------

    // store 갤러리 변경 시 갱신
    window.addEventListener(GALLERY_EVENT, (ev) => {
      const detail = ev?.detail || null;
      if (detail?.label && detail.label !== effectiveLabel) return;
      refresh();
    });

    // 선택 라벨 cross-tab 미러
    window.addEventListener("storage", (e) => {
      if (e && e.key === MIRROR_KEY && e.newValue) {
        effectiveLabel = resolveEffectiveLabel();
        refresh();
      }
    });

    // same-tab 라벨 변경
    window.addEventListener(EVT, () => {
      effectiveLabel = resolveEffectiveLabel();
      refresh();
    });

    // 최초 로드
    refresh();
  });
})();

  // ── Author helpers ─────────────────────────────────────────────
  function normAuthor(u) {
    const id =
      u?.id ?? u?.user_id ?? u?.uid ?? u?.sub ?? u?.pk ?? u?.profile?.id ?? null;
    const name =
      u?.displayName ?? u?.name ?? u?.nickname ?? u?.profile?.name ?? u?.username ?? "";
    const handle =
      u?.handle ?? u?.username ?? u?.login ?? u?.profile?.handle ?? "";
    const avatar =
      u?.avatar_url ?? u?.avatar ?? u?.picture ?? u?.profile?.avatarUrl ?? "";
    const ns =
      (window.SDF_NS ||
       (localStorage.getItem("auth:userns") || "default")).trim().toLowerCase();
    return { id: id && String(id), ns, name: String(name||""), handle: String(handle||""), avatar: String(avatar||"") };
  }

  let __meCache = null;
  async function getAuthorMeta() {
    if (__meCache) return __meCache;
    const u = await (window.auth?.getUser?.().catch(()=>null));
    const a = normAuthor(u || {});
    __meCache = a;
    return a;
  }

  // FormData에 다양한 백엔드 호환 키로 주입
  function appendAuthorFields(fd, a){
    if (!fd || !a) return;
    // 권장 키
    if (a.id) fd.append("author_id", a.id);
    fd.append("author_ns", a.ns || "default");
    fd.append("author_name", a.name || "");
    if (a.handle) fd.append("author_handle", a.handle);
    if (a.avatar) fd.append("author_avatar", a.avatar);

    // 구(舊) 백엔드 호환
    if (a.id) {
      fd.append("user_id", a.id);
      fd.append("owner_id", a.id);
    }
    fd.append("ns", a.ns || "default");      // 이미 넣고 있어도 중복 무해
    fd.append("user", JSON.stringify(a));     // 객체 통으로도 전달
    fd.append("author", JSON.stringify(a));   // 혹시 author만 읽는 서버 대비
  }

/* ========================================================================== *
 * FEED — Unified Post Flow (No-inline-CSS, DRY)
 * - 공통 유틸/뷰를 한 번만 정의하고 1-STEP / 3-STEP이 함께 사용
 * - 스타일은 전부 CSS 클래스로 (동적 위치 계산 등 불가피한 부분만 style 변수 사용)
 * ========================================================================== */
(function FeedUnified(){
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // 0) Namespace & Small Utilities (공통)
  // ─────────────────────────────────────────────────────────────
  const SDF   = window.SDF || (window.SDF = {});
  const U     = SDF.Utils || {};
  const Icons = SDF.Icons || {};

  const qs   = (s, r=document)=> r.querySelector(s);
  const now  = ()=> Date.now();

  const ensureReady = SDF.ensureReady || (cb=>{
    if (document.readyState === "complete" || document.readyState === "interactive") cb();
    else document.addEventListener("DOMContentLoaded", cb, { once:true });
  });

  function getNS(){ return (localStorage.getItem("auth:userns") || "default").trim().toLowerCase(); }
  function getLabel(){
    try{
      if (typeof window.readSelected === "function"){
        const v = window.readSelected();
        if (v && typeof v === "string") return v;
      }
      if (Array.isArray(window.OK) && window.OK.length) return window.OK[0];
    } catch {}
    return "aud";
  }

  // ── after: function getLabel(){ ... }
function goMineAfterShare(label = getLabel()) {
  try {
    // mine.html에서 바로 라벨 UI가 활성화되도록 선택값 브로드캐스트
    if (label && typeof window.setSelectedLabel === "function") {
      window.setSelectedLabel(label);
    }
  } catch {}
  const url = `${pageHref('mine.html')}?label=${encodeURIComponent(label)}&posted=1`;
  // 뒤로가기로 작성 화면 복귀를 허용하려면 assign, 히스토리 덮으려면 replace
  location.assign(url);
}

  async function ensureCSRF(){ try { return await (window.auth?.getCSRF?.()); } catch { return null; } }
  async function api(path, opt={}){ const f = window.auth?.apiFetch || fetch; return f(path, opt); }

  // 이미지 <-> Blob
  function blobToImage(blob){
    return new Promise((res, rej)=>{
      const fr = new FileReader();
      fr.onload  = ()=> { const im = new Image(); im.onload = ()=>res(im); im.onerror = rej; im.src = fr.result; };
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  // 색상 유틸 (독립 동작 보장)
  function _rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
  function _hexToRgb(hex){
    const s = hex.startsWith('#') ? hex.slice(1) : hex;
    const n = parseInt(s.length===3 ? s.split('').map(c=>c+c).join('') : s, 16);
    return [ (n>>16)&255, (n>>8)&255, n&255 ];
  }
  function _hsvToRgb(h,s,v){
    const c=v*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c;
    let r=0,g=0,b=0;
    if (0<=h && h<60){ r=c; g=x; b=0; } else
    if (60<=h && h<120){ r=x; g=c; b=0; } else
    if (120<=h && h<180){ r=0; g=c; b=x; } else
    if (180<=h && h<240){ r=0; g=x; b=c; } else
    if (240<=h && h<300){ r=x; g=0; b=c; } else { r=c; g=0; b=x; }
    return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) };
  }
  function _rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;
    if (d!==0){
      if (max===r) h=60*(((g-b)/d)%6);
      else if (max===g) h=60*(((b-r)/d)+2);
      else h=60*(((r-g)/d)+4);
    }
    const s=max===0?0:d/max, v=max;
    return { h: (h+360)%360, s, v };
  }

  // 썸네일: 있으면 SDF.Utils.makeThumbnail 사용, 없으면 생략
  const makeThumbMaybe = U.makeThumbnail || null;

  // [CHANGE] FeedUnified.uploadPost 내부, fd.append 전에 넣기
  async function uploadPost({ blob, text, width, height, bg }) {
    const label = getLabel();
    const ns    = getNS();
    const csrf  = await ensureCSRF();
    const id    = `g_${now()}`;

    // 🔴 업로드용 블랍을 표준화
    try {
      // blob → Image → temp canvas
      const img = await blobToImage(blob);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);

      // 트림+패딩(+정사각). 원본이 너무 크면 1024~2048 사이에서 적당히.
      const target = Math.max(1024, Math.min(2048, Math.max(c.width, c.height)));
      const norm = SDF.Utils.trimAndPadToSquare(c, { padding: 0.08, size: target });

      // 캔버스 → Blob
      blob   = await SDF.Utils.canvasToBlob(norm, 'image/png');
      width  = norm.width;
      height = norm.height;
    } catch (e) {
      // 실패해도 그냥 원본으로 진행
      console.warn('[upload] normalize skipped:', e);
    }

    const fd = new FormData();
    const author = await getAuthorMeta().catch(()=>null);
    if (author) appendAuthorFields(fd, author);
    fd.append("file", new File([blob], `${id}.png`, { type: "image/png" }));
    fd.append("id", id);
    fd.append("label", label);
    fd.append("createdAt", String(now()));
    fd.append("ns", ns);
    fd.append("visibility", "public");
    if (width)  fd.append("width",  String(width));
    if (height) fd.append("height", String(height));
    if (csrf)   fd.append("_csrf",  csrf);

    // ✨ 추가: 캡션/배경색
    const clean = String(text || "").trim();
    if (clean) fd.append("caption", clean);
    if (typeof bg === "string" && bg) {
      const hex = String(bg).trim();
      // 간단 검증: #RGB | #RRGGBB
      const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
      const safe = isHex ? hex : "#000000";
      fd.append("bg", safe);        // 신식
      fd.append("bg_color", safe);  // 구식 호환
      fd.append("bgHex", safe);     // 일부 백엔드 호환
    }

    // 썸네일은 있으면 그대로
    if (makeThumbMaybe) {
      try {
        const du = await new Promise(r => { const fr = new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(blob); });
        const thumb = await makeThumbMaybe(du, 320, 240);
        if (thumb) fd.append("thumbDataURL", thumb);
      } catch {}
    }

    const res = await api("/api/gallery/upload", {
      method: "POST",
      credentials: "include",
      body: fd,
      headers: csrf ? { "X-CSRF-Token": csrf } : undefined
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.ok === false) throw new Error("upload failed");

    // (필요시) 옛 서버에서는 caption을 댓글로도 함께 남기고 싶다면 아래를 주석 해제
    // if (clean) { try { await api(`/api/items/${encodeURIComponent(id)}/comments`, {
    //   method: "POST", credentials: "include",
    //   headers: { "Content-Type": "application/json", "Accept":"application/json" },
    //   body: JSON.stringify({ text: clean })
    // }); } catch {} }

    return { id };
  }

  async function requireLoginOrRedirect(){
    try{
      const me = await (window.auth?.getUser?.().catch(()=>null));
      if (!me){
        const ret = encodeURIComponent(location.href);
        location.replace(`${pageHref('login.html')}?next=${ret}`);
        return false;
      }
      return true;
    }catch{ return true; }
  }

  // ─────────────────────────────────────────────────────────────
  // 1) Gallery Picker (공통 모달) — Promise<{ blob,w,h }>
  //    • step1도 step3와 동일한 전역 X / 오버레이 스타일 적용
  // ─────────────────────────────────────────────────────────────
  function openGalleryPicker(){
    return new Promise((resolve, reject)=>{
      const S = window.store;
      const label = getLabel();
      const items = (S && typeof S.getGallery === "function") ? (S.getGallery(label) || []) : [];

      // 기존 클래스 + imodal 계열 병행 적용(디자인 통일)
      const backdrop = document.createElement("div");
      backdrop.className = "sdf-modal-backdrop";
      backdrop.dataset.role = "gallery-picker";

      const modal = document.createElement("div");
      modal.className = "sdf-modal";

      const head  = document.createElement("div");
      head.className = "sdf-modal-head";

      const title = document.createElement("h3");
      title.className = "sdf-modal-title";
      title.textContent = "Gallery";

      const close = document.createElement("button");
      close.className = "sdf-modal-close";
      close.type = "button";
      close.setAttribute("aria-label","닫기");
      close.textContent = "×";
      close.addEventListener("click", ()=>{ cleanup(); reject(new Error("cancel")); });

      head.append(title, close);

      const body = document.createElement("div");
      body.className = "sdf-modal-body";

      if (!items.length){
        const empty = document.createElement("div");
        empty.className = "sdf-empty";
        empty.textContent = "저장된 이미지가 없습니다.";
        body.append(empty);
      } else {
        const grid = document.createElement("div");
        grid.className = "sdf-grid";
        for (const it of items){
          const btn = document.createElement("button");
          btn.type = "button";
          const img = document.createElement("img");
          img.src = it.thumbDataURL; img.alt = ""; img.draggable = false;
          btn.append(img);
          btn.addEventListener("click", async ()=>{
            try{
              let b=null;
              if (typeof window.getGalleryBlobFlexible === "function"){
                b = await window.getGalleryBlobFlexible(it.id, label);
              } else if (window.store?.getBlob){
                b = await window.store.getBlob(it.id, label);
              }
              if (!b) return;
              const im = await blobToImage(b);
              cleanup();
              resolve({ blob: b, w: im.naturalWidth, h: im.naturalHeight });
            }catch{}
          });
          grid.append(btn);
        }
        body.append(grid);
      }

      modal.append(head, body);
      backdrop.append(modal);

      // ✅ step3와 동일한 전역 X 버튼
      const globalClose = document.createElement("button");
      globalClose.className = "im-head-close";
      globalClose.type = "button";
      globalClose.setAttribute("aria-label","닫기");
      globalClose.innerHTML = '<span class="im-x"></span>';
      globalClose.addEventListener("click", () => { cleanup(); reject(new Error("cancel")); });
      backdrop.append(globalClose);

      // 공통 닫기 동작(오버레이 클릭/ESC)
      const onBackdropClick = (e)=>{ if (e.target === backdrop){ cleanup(); reject(new Error("cancel")); } };
      const onEsc = (e)=>{ if (e.key === "Escape"){ cleanup(); reject(new Error("cancel")); } };

      function cleanup(){
        window.removeEventListener("keydown", onEsc);
        backdrop.removeEventListener("click", onBackdropClick);
        backdrop.remove();
      }

      backdrop.addEventListener("click", onBackdropClick);
      window.addEventListener("keydown", onEsc);
      document.body.append(backdrop);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 2) Color Picker (공통 컴포넌트) — buildColorPicker({ onChange, keys })
  // ─────────────────────────────────────────────────────────────
  function buildColorPicker({
    onChange,
    keys = ['#FFFFFF', '#275999', '#FFA765'],
    panelId,
  } = {}){
    const wrap = document.createElement('div');

    const group = document.createElement('div');
    group.className = 'im-group';
    group.textContent = 'Background color';

    const row = document.createElement('div');
    row.className = 'im-row-color im-bgcolor';
    
    const btn  = document.createElement('button');
    btn.type   = 'button';
    btn.className = 'sdf-color-btn';
    btn.setAttribute('aria-label', '배경색 선택');

    const chip = document.createElement('div');
    chip.className = 'sdf-color-chip';
    chip.style.background = '#FFFFFF';

    btn.append(chip);

    const slots = document.createElement('div');
    slots.className = 'sdf-color-keys';
    keys.forEach(hex=>{
      const b = document.createElement('button');
      b.type='button'; b.className='sdf-color-btn'; b.title=hex;
      const c = document.createElement('div');
      c.className='sdf-color-chip'; c.style.background=hex;
      b.append(c);
      b.addEventListener('click', ()=> applyHex(hex));
      slots.appendChild(b);
    });

    row.append(btn, slots);
    wrap.append(group, row);

    // ── 내부 상태 ───────────────────────────────────────────────
    let current = '#FFFFFF';
    let isOpen = false;
    let panel = null, slider = null, wheel = null;

    // 휠 유틸 (내부 사본)
    function makeColorWheel(size, initHex, initV, onPick){
      const canvas=document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = Math.max(window.devicePixelRatio||1,1);
      canvas.width=size*dpr; canvas.height=size*dpr;
      canvas.style.width=size+'px'; canvas.style.height=size+'px';
      canvas.style.display='block'; canvas.style.borderRadius='50%'; canvas.style.touchAction='none';

      let { h,s,v } = _rgbToHsv(..._hexToRgb(initHex));
      if (typeof initV==='number') v = Math.max(0,Math.min(1,initV));

      function render(){
        const W=canvas.width, H=canvas.height, R=Math.min(W,H)/2;
        const cx=W/2, cy=H/2;
        const img=ctx.createImageData(W,H), data=img.data;
        for(let y=0;y<H;y++){
          for(let x=0;x<W;x++){
            const dx=x-cx, dy=y-cy, dist=Math.hypot(dx,dy), i=(y*W+x)*4;
            if(dist>R){ data[i+3]=0; continue; }
            let th=Math.atan2(dy,dx); if(th<0) th+=Math.PI*2;
            const hh=(th/(Math.PI*2))*360, ss=dist/R, {r,g,b}=_hsvToRgb(hh,ss,v);
            data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=255;
          }
        }
        ctx.putImageData(img,0,0);
      }
      render();

      let dragging=false;
      canvas.addEventListener('pointerdown', e=>{ dragging=true; pick(e); });
      canvas.addEventListener('pointermove',  e=>{ if(dragging) pick(e); });
      ['pointerup','pointercancel','pointerleave'].forEach(t=>canvas.addEventListener(t, ()=>{ dragging=false; }));

      function pick(e){
        const r=canvas.getBoundingClientRect(), x=(e.clientX-r.left)*dpr, y=(e.clientY-r.top)*dpr;
        const cx=canvas.width/2, cy=canvas.height/2, maxR=Math.min(canvas.width,canvas.height)/2;
        const dx=x-cx, dy=y-cy, dist=Math.hypot(dx,dy), clampedR=Math.min(dist,maxR);
        let th=Math.atan2(dy,dx); if(th<0) th+=Math.PI*2;
        h=(th/(Math.PI*2))*360; s=clampedR/maxR;
        const { r:R, g:G, b:B } = _hsvToRgb(h,s,v);
        onPick?.(_rgbToHex(R,G,B), { h,s,v });
      }

      function setV(vv){ v=Math.max(0,Math.min(1,vv)); render(); onPick?.(_rgbToHex(...Object.values(_hsvToRgb(h,s,v))), { h,s,v }); }
      function setHSV(o){ if('h'in o) h=((o.h%360)+360)%360; if('s'in o) s=Math.max(0,Math.min(1,o.s)); if('v'in o) v=Math.max(0,Math.min(1,o.v)); render(); onPick?.(_rgbToHex(...Object.values(_hsvToRgb(h,s,v))), { h,s,v }); }
      function getHSV(){ return { h,s,v }; }

      return { el:canvas, setV, setHSV, getHSV };
    }

    function updateSliderBg(sl, h, s){
      const a=_hsvToRgb(h,s,0), b=_hsvToRgb(h,s,1);
      sl.style.background=`linear-gradient(to right, ${_rgbToHex(a.r,a.g,a.b)}, ${_rgbToHex(b.r,b.g,b.b)})`;
    }

    function positionPanel(){
      if (!panel) return;
      const br = btn.getBoundingClientRect();
      panel.style.setProperty('--pop-x', (br.left + br.width/2) + 'px');
      panel.style.setProperty('--pop-y', (br.bottom + 10) + 'px');
    }

    function openPanel(){
      if (isOpen) return; isOpen=true;

      panel = document.createElement('div');
      panel.className = 'sdf-color-panel';
      panel.id = panelId || `im-color-panel-${Math.random().toString(36).slice(2,7)}`;

      wheel = makeColorWheel(180, current, 1, (hex, hsv)=>{
        current = hex; chip.style.background = hex; onChange?.(hex);
        if (slider){ slider.value = Math.round(hsv.v*100); updateSliderBg(slider, hsv.h, hsv.s); }
      });

      slider = document.createElement('input');
      slider.type='range'; slider.min=0; slider.max=100; slider.value=100;
      slider.className='sdf-brightness';
      slider.addEventListener('input', ()=>{
        const v = slider.value/100; wheel.setV(v);
        const hsv = wheel.getHSV(); const rgb = _hsvToRgb(hsv.h,hsv.s,v);
        current = _rgbToHex(rgb.r,rgb.g,rgb.b); chip.style.background = current; onChange?.(current);
      });
      updateSliderBg(slider, wheel.getHSV().h, wheel.getHSV().s);

      panel.append(wheel.el, slider);
      panel.addEventListener('click', (e)=> e.stopPropagation());
      document.body.append(panel);
      positionPanel();

      const onResize = ()=>positionPanel();
      const onScroll = ()=>positionPanel();
      const onDocClick = (e)=>{ if (e.target!==btn && !panel.contains(e.target)) closePanel(); };

      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onScroll, true);
      document.addEventListener('click', onDocClick, { capture:true });

      panel._cleanup = ()=>{
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll, true);
        document.removeEventListener('click', onDocClick, { capture:true });
      };
    }

    function closePanel(){
      if (!isOpen) return; isOpen=false;
      if (panel && panel._cleanup) panel._cleanup();
      panel?.remove(); panel=null;
    }

    function applyHex(hex){
      current = /^#/.test(hex) ? hex : ('#'+hex);
      chip.style.background = current;
      onChange?.(current);
      if (isOpen && wheel){
        const [r,g,b] = _hexToRgb(current);
        const hsv = _rgbToHsv(r,g,b);
        wheel.setHSV(hsv);
        if (slider) { slider.value = Math.round(hsv.v*100); updateSliderBg(slider, hsv.h, hsv.s); }
      }
    }

    // 초기값
    applyHex('#FFFFFF');
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); isOpen ? closePanel() : openPanel(); });

    // 외부에서 초기값 강제할 때 사용 가능
    return { el: wrap, set: applyHex };
  }

  // ─────────────────────────────────────────────────────────────
  // 3) Compose Modal (공통) — Promise(true | {back:true, blob,w,h})
  //    • ESC 닫기 추가(일관성)
  // ─────────────────────────────────────────────────────────────
  function openComposeModal({ blob, w, h }){
    return new Promise((resolve, reject)=>{
      const url = URL.createObjectURL(blob);

      const back  = document.createElement("div");
      back.className  = "imodal-backdrop";
      const shell = document.createElement("div");
      shell.className = "imodal";

      // Header
      const head  = document.createElement("div"); head.className = "im-head";
      const backBtn = document.createElement("button"); backBtn.type = "button"; backBtn.className = "im-head-back";
      backBtn.innerHTML = '<span class="feed-ico-back"></span>';
      const title = document.createElement("div"); title.className = "im-head-title"; title.textContent = "New post";
      const share = document.createElement("button"); share.className = "im-head-share"; share.type = "button"; share.textContent = "Share";
      head.append(backBtn, title, share);

      // Body (좌: 이미지, 우: 작성 + 컬러)
      const body  = document.createElement("div"); body.className = "im-body";
      const left  = document.createElement("div"); left.className = "im-left";
      const stage = document.createElement("div"); stage.className = "im-stage has-image";
      const img   = document.createElement("img"); img.src = url; img.alt = "";
      stage.append(img); left.append(stage);

      const right = document.createElement("div"); right.className = "im-right";
      const acct  = document.createElement("div"); acct.className  = "im-acct";
      const avatar= document.createElement("div"); avatar.className= "im-acct-avatar";
      const name  = document.createElement("div"); name.className  = "im-acct-name"; name.textContent = "You";
      acct.append(avatar, name);
      (async () => {
        try {
          const a = await getAuthorMeta();
          if (a?.name || a?.handle) name.textContent = a.name || `@${a.handle}`;
          if (a?.avatar) {
            avatar.style.backgroundImage = `url("${a.avatar}")`;
            avatar.classList.add("has-img");
          }
        } catch {}
      })();

      const caption = document.createElement("textarea");
      caption.className = "im-caption";
      caption.id = "post-caption";
      caption.name = "caption";
      caption.placeholder = "";
      caption.maxLength = 2200;

      const meta = document.createElement("div"); meta.className = "im-cap-meta";
      const mR = document.createElement("span"); mR.textContent = "0 / 2200";
      caption.addEventListener("input", ()=>{ mR.textContent = `${caption.value.length} / 2200`; });
      meta.append(mR);

      // 배경색(공통 컬러 피커 사용)
      let bgHex = '#FFFFFF';
      const applyBg = (c) => { left.style.background = c; stage.style.background = c; bgHex = c; };
      const picker = buildColorPicker({ onChange: (hex) => applyBg(hex) });
      applyBg('#FFFFFF');

      right.append(acct, caption, meta, picker.el);
      body.append(left, right);
      shell.append(head, body);
      back.append(shell);

      // 전역 X
      const globalClose = document.createElement("button");
      globalClose.className = "im-head-close";
      globalClose.type = "button";
      globalClose.setAttribute("aria-label","닫기");
      globalClose.innerHTML = '<span class="im-x"></span>';

      // 조립
      back.append(globalClose);
      document.body.append(back);

      function cleanup(){
        URL.revokeObjectURL(url);
        window.removeEventListener("keydown", onEsc);
        back.remove();
      }

      const onEsc = (e)=>{ if (e.key === "Escape"){ cleanup(); reject(new Error("cancel")); } };
      window.addEventListener("keydown", onEsc);

      globalClose.addEventListener("click", ()=>{ cleanup(); reject(new Error("cancel")); });
      back.addEventListener("click", (e)=>{ if (e.target === back){ cleanup(); reject(new Error("cancel")); }});
      backBtn.addEventListener("click", ()=>{ cleanup(); resolve({ back:true, blob, w, h }); });

      share.addEventListener("click", async () => {
        share.disabled = true;
        const prev = share.textContent;
        share.textContent = "Sharing…";
        try {
          if (!await requireLoginOrRedirect()) return;
          await uploadPost({ blob, text: caption.value, width: w, height: h, bg: bgHex });
          // ✅ 업로드 성공 → mine으로 이동
          goMineAfterShare();
          return; // 네비게이션 트리거 이후 아래 코드는 사실상 실행되지 않음
        } catch (e) {
          console.error(e);
          share.disabled = false;
          share.textContent = prev || "Share";
        }
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 4) One-Step Feed Composer (파일선택/갤러리 선택 → 곧바로 작성)
  //    window.openFeedModal 로 노출
  // ─────────────────────────────────────────────────────────────
  function openFeedModal(){
    document.body.classList.add("is-compose");
    (async ()=>{ await requireLoginOrRedirect(); })();

    const back  = document.createElement("div"); back.className  = "imodal-backdrop";
    const shell = document.createElement("div"); shell.className = "imodal";

    // Header
    const head  = document.createElement("div"); head.className = "im-head";
    const backBtn = document.createElement("button"); backBtn.className = "im-head-back"; backBtn.type="button";
    backBtn.innerHTML = '<span class="feed-ico-back"></span>';
    const title = document.createElement("div"); title.className = "im-head-title"; title.textContent = "New post";
    const share = document.createElement("button"); share.className = "im-head-share"; share.type="button"; share.textContent = "Share"; share.disabled = true;
    head.append(backBtn, title, share);

    // Body
    const body  = document.createElement("div"); body.className  = "im-body";
    const left  = document.createElement("div"); left.className  = "im-left";
    const stage = document.createElement("div"); stage.className = "im-stage";
    const dummy = document.createElement("div"); dummy.className = "im-stage-dummy";
    const chooser = document.createElement("div"); chooser.className = "im-chooser";
    const hint  = document.createElement("div"); hint.className = "im-stage-hint"; hint.textContent = "파일을 드래그하거나 아래 버튼으로 선택하세요";
    const pick  = document.createElement("button"); pick.className = "feedc__pick"; pick.type="button"; pick.textContent = "이미지 선택";
    chooser.append(hint, pick);
    const stageImg = document.createElement("img");
    stage.append(dummy, chooser, stageImg);
    left.append(stage);

    const right = document.createElement("div"); right.className = "im-right";
    const acct  = document.createElement("div"); acct.className  = "im-acct";
    const avatar= document.createElement("div"); avatar.className= "im-acct-avatar";
    const name  = document.createElement("div"); name.className  = "im-acct-name"; name.textContent = "You";
    acct.append(avatar, name);

    const caption = document.createElement("textarea"); caption.className = "im-caption"; caption.placeholder = "문구 입력..."; caption.maxLength = 300;
    const meta = document.createElement("div"); meta.className = "im-cap-meta";
    const mR = document.createElement("span"); mR.textContent = "0 / 300";
    caption.addEventListener("input", ()=>{ mR.textContent = `${caption.value.length} / 300`; });
    meta.append(mR);

    const attach = document.createElement("div"); attach.className = "im-attach";
    const label  = document.createElement("label"); label.className = "feedc__attach"; label.textContent = "컴퓨터에서 선택";
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.className = "feedc__file";
    label.append(fileInput); attach.append(label);

    // 배경색
    let bgHex = '#FFFFFF';
    const applyBg = (c) => { left.style.background = c; stage.style.background = c; bgHex = c; };
    const picker  = buildColorPicker({ onChange: (hex)=> applyBg(hex) });
    applyBg('#FFFFFF');

    right.append(acct, caption, meta, attach, picker.el);

    // 글로벌 닫기
    const globalClose = document.createElement("button");
    globalClose.className = "im-head-close";
    globalClose.type = "button";
    globalClose.setAttribute("aria-label","닫기");
    globalClose.innerHTML = '<span class="im-x"></span>';

    // 조립
    body.append(left, right);
    shell.append(head, body);
    back.append(shell, globalClose);
    document.body.append(back);

    // 상태
    const state = { blob:null, w:0, h:0 };

    function applySelection(b, w, h){
      state.blob = b; state.w = w|0; state.h = h|0;
      if (b){
        const url = URL.createObjectURL(b);
        stageImg.src = url;
        stage.classList.add("has-image");
        stageImg.addEventListener("load", ()=> URL.revokeObjectURL(url), { once:true });
        share.disabled = false;
      } else {
        stageImg.removeAttribute("src");
        stage.classList.remove("has-image");
        share.disabled = true;
      }
    }

    function closeAndReset(){
      caption.value = ""; mR.textContent = "0 / 300";
      applySelection(null,0,0);
      back.remove();
      document.body.classList.remove("is-compose");
    }

    // 이벤트
    globalClose.addEventListener("click", closeAndReset);
    back.addEventListener("click", (e)=>{ if (e.target === back) closeAndReset(); });
    backBtn.addEventListener("click", closeAndReset);
    window.addEventListener("keydown", function onEsc(e){ if (e.key === "Escape"){ closeAndReset(); window.removeEventListener("keydown", onEsc); } });

    pick.addEventListener("click", async ()=>{
      try{
        const picked = await openGalleryPicker();
        applySelection(picked.blob, picked.w, picked.h);
      }catch{}
    });

    fileInput.addEventListener("change", async ()=>{
      const f = fileInput.files?.[0]; if (!f) return;
      try{
        const im = await blobToImage(f);
        applySelection(f, im.naturalWidth, im.naturalHeight);
      }catch{}
    });

    share.addEventListener("click", async () => {
      if (!state.blob) return;
      share.disabled = true;
      share.textContent = "Sharing…";
      try {
        if (!await requireLoginOrRedirect()) return;
        await uploadPost({
          blob: state.blob,
          text: caption.value,
          width: state.w,
          height: state.h,
          bg: bgHex
        });
        // ✅ 업로드 성공 → mine으로 이동
        goMineAfterShare();
        return;
      } catch (e) {
        console.error(e);
        share.disabled = false;
        share.textContent = "Share";
      }
    });

    // 접근성 보정
    if (!caption.id) caption.id = "im-caption";
    if (!caption.name) caption.name = "caption";
    if (!fileInput.id) fileInput.id = "feedc__file";
    if (!fileInput.name) fileInput.name = "file";
  }

  // 글로벌 공개(호환)
  if (typeof window.openFeedModal !== "function") {
    window.openFeedModal = openFeedModal;
  }

  // ─────────────────────────────────────────────────────────────
  // 5) Three-Step Flow (Gallery → Crop → Compose)
  //    - 갤러리 비었으면 가로채지 않음(= 1-스텝 동작)
  //    • step2도 step3와 동일한 전역 X / 오버레이 스타일 적용
  // ─────────────────────────────────────────────────────────────
  function openCropModal({ blob, w, h }){
    return new Promise((resolve, reject)=>{
      document.body.classList.add("is-cropping");

      const url = URL.createObjectURL(blob);

      // 기존 클래스 + imodal 계열 병행 적용(디자인 통일)
      const back  = document.createElement("div");
      back.className = "cmodal-backdrop imodal-backdrop";

      const shell = document.createElement("div");
      shell.className = "cmodal imodal";

      const head  = document.createElement("div");
      head.className = "cm-head";

      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "cm-back";
      const backIcon = document.createElement("span");
      backIcon.className = "feed-ico-back";
      backBtn.append(backIcon);

      const title = document.createElement("div");
      title.className = "cm-title";
      title.textContent = "Crop";

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "cm-next";
      nextBtn.textContent = "Next";

      head.append(backBtn, title, nextBtn);

      const body  = document.createElement("div");
      body.className = "cm-body";
      const stage = document.createElement("div");
      stage.className = "cm-stage";
      const img = document.createElement("img");
      img.src = url; img.alt = "";
      stage.append(img);
      // === [ADD] Interactive crop canvas (square viewport) ===
      const cropWrap = document.createElement('div');
      cropWrap.className = 'cm-crop-wrap';
      const canvas = document.createElement('canvas');
      // responsive square: use min(720, viewport)
      const vw = Math.max(320, Math.min(720, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.8)));
      canvas.width = vw; canvas.height = vw;
      canvas.className = 'cm-canvas';
      canvas.style.touchAction = 'none';
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      canvas.style.maxWidth = '100%';
      cropWrap.append(canvas);
      stage.innerHTML = ''; // replace preview img with canvas stage
      stage.append(cropWrap);

      const ctx = canvas.getContext('2d');
      let scale = 1, minScale = 1, maxScale = 8;
      let tx = 0, ty = 0; // translate from center
      let dragging = false, lastX = 0, lastY = 0;
      const bg = null; // transparent export

      const srcImg = new Image();
      srcImg.onload = () => {
        // initial fit: cover the square
        const cover = Math.max(canvas.width / srcImg.naturalWidth, canvas.height / srcImg.naturalHeight);
        minScale = cover;
        scale = cover;
        maxScale = cover * 6;
        tx = 0; ty = 0;
        draw();
      };
      // keep canvas device-pixel ratio synced visually (no re-export here)
      window.addEventListener('resize', ()=>{ draw(); }, { passive:true });

      srcImg.src = url;

      function draw(){
        // clear
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,canvas.width, canvas.height);
        ctx.translate(canvas.width/2 + tx, canvas.height/2 + ty);
        ctx.scale(scale, scale);
        // draw image centered
        ctx.drawImage(srcImg, -srcImg.naturalWidth/2, -srcImg.naturalHeight/2);
        ctx.restore();

      }

      // Drag to pan
      canvas.addEventListener('pointerdown', (e)=>{ dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointerup',   (e)=>{ dragging = false; try{ canvas.releasePointerCapture(e.pointerId); }catch{} });
      canvas.addEventListener('pointercancel',(e)=>{ dragging = false; try{ canvas.releasePointerCapture(e.pointerId); }catch{} });
      canvas.addEventListener('pointermove', (e)=>{
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        tx += dx; ty += dy;
        draw();
      });

      // Wheel to zoom (around cursor)
      canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const delta = Math.sign(e.deltaY) * -0.1; // trackpad natural
        const oldScale = scale;
        const next = Math.min(maxScale, Math.max(minScale, scale * (1 + delta)));
        if (next === scale) return;
        // zoom around cursor point
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left - canvas.width/2 - tx;
        const cy = e.clientY - rect.top  - canvas.height/2 - ty;
        tx -= cx * (next/oldScale - 1);
        ty -= cy * (next/oldScale - 1);
        scale = next;
        draw();
      }, { passive:false });

      shell.append(head, body);
      back.append(shell);

      // ✅ step3와 동일한 전역 X 버튼
      const globalClose = document.createElement("button");
      globalClose.className = "im-head-close";
      globalClose.type = "button";
      globalClose.setAttribute("aria-label","닫기");
      globalClose.innerHTML = '<span class="im-x"></span>';
      back.append(globalClose);

      function cleanup(){
        URL.revokeObjectURL(url);
        window.removeEventListener("keydown", onEsc);
        back.remove();
        document.body.classList.remove("is-cropping");
      }

      // 공통 닫기 동작(오버레이 클릭/ESC)
      const onBackdropClick = (e)=>{ if (e.target === back){ cleanup(); reject(new Error("cancel")); } };
      const onEsc = (e)=>{ if (e.key === "Escape"){ cleanup(); reject(new Error("cancel")); } };
      back.addEventListener("click", onBackdropClick);
      window.addEventListener("keydown", onEsc);

      // 뒤로가기: 갤러리로 복귀(기존 로직 유지)
      backBtn.addEventListener("click", async ()=>{
        cleanup();
        try{
          const picked = await openGalleryPicker(); // 뒤로가면 다시 1단계
          const again  = await openCropModal(picked);
          resolve(again);
        }catch{ reject(new Error("cancel")); }
      });

      // 다음
      nextBtn.addEventListener("click", async ()=>{
        nextBtn.disabled = true;
        title.textContent = "New post";
        async function exportBlob(){
          try{
            const b = await new Promise(res => canvas.toBlob(res, "image/png", 1));
            const blobOut = b || blob; // fallback
            return { blob: blobOut, w: canvas.width, h: canvas.height };
          }catch{ return { blob, w: canvas.width, h: canvas.height }; }
        }
        // 모바일에서는 모션 없이 바로 종료
        const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth <= 640;
        if (noMotion){
          const out = await exportBlob();
          cleanup();
          resolve(out);
          return;
        }
        // 1) 먼저 너비를 950px로 부드럽게 확장
        // reflow 보장
        shell.getBoundingClientRect();
        shell.classList.add("is-grow-to-compose");
        // 2) 트랜지션 종료 후 닫고 step3로 진행
        const onEnd = async (e)=>{
          if (e.propertyName !== "width") return;
          shell.removeEventListener("transitionend", onEnd);
          const out = await exportBlob();
          cleanup();
          resolve(out);
        };
        shell.addEventListener("transitionend", onEnd);
      });

      // 전역 X 클릭 닫기
      globalClose.addEventListener("click", ()=>{ cleanup(); reject(new Error("cancel")); });

      document.body.append(back);
    });
  }

  // 🔁 3-스텝 흐름: Gallery → Crop → Compose (← 뒤로가면 한 스텝씩 복귀)
  async function runThreeStepFlow(){
    try {
      // 1) 갤러리에서 고르기
      let sel = await openGalleryPicker(); // { blob, w, h }

      while (true) {
        // 2) 크롭(현재 사양은 미리보기 단계)
        const cropped = await openCropModal(sel); // { blob, w, h }

        // 3) 작성(Share) — 뒤로가면 back 신호를 줌
        const res = await openComposeModal(cropped);

        if (res === true) {
          // Share 완료
          return;
        }
        if (res && res.back) {
          // ← Compose에서 뒤로: 직전 이미지로 “크롭” 다시
          sel = { blob: res.blob, w: res.w, h: res.h };
          continue;
        }
        // 그 외(취소 등) 종료
        return;
      }
    } catch (e) {
      // 취소가 아니면 1-스텝 폴백
      if (!(e && String(e.message||e) === "cancel") && typeof window.openFeedModal === "function") {
        window.openFeedModal();
      }
    }
  }

  function hookPostButtonForThreeStep(){
    const id = "feed-open-btn";
    const tryBind = ()=>{
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.flow3Bound) return;

      btn.addEventListener("click", (e)=>{
        try {
          const label = getLabel();
          const items = (window.store && typeof window.store.getGallery === "function")
            ? (window.store.getGallery(label) || [])
            : [];
          if (!items.length) return; // 비어있으면 기존 1-스텝으로
        } catch {}
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        runThreeStepFlow();
      }, { capture: true });

      btn.dataset.flow3Bound = "1";
    };
    tryBind();
    new MutationObserver(tryBind).observe(document.documentElement, { childList: true, subtree: true });
  }

  // ─────────────────────────────────────────────────────────────
  // 6) Mount Post Button (액션바 + POST 버튼)
  //    - CSS 클래스 위임. JS에서 레이아웃 인라인 지정하지 않음.
  // ─────────────────────────────────────────────────────────────
  function mountPostButton(){
    const wrap = document.getElementById('sdf-wrap');
    const drawWrap = document.querySelector('.labelmine-draw-wrap') || wrap?.parentElement || document.querySelector('main.labelmine-body') || document.body;
    if (!wrap || !drawWrap) return;

    let bar = drawWrap.querySelector('.sdf-actionbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sdf-actionbar';
      drawWrap.insertBefore(bar, wrap);
    }

    let btn = document.getElementById('feed-open-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'feed-open-btn';
      btn.type = 'button';
      btn.className = 'feed-open-btn';
      btn.textContent = 'POST';
    } else {
      btn.classList.add('feed-open-btn');
      btn.classList.remove('feed-open-btn--bottom');
    }

    if (!btn.dataset.bound) {
      btn.addEventListener('click', openFeedModal);
      btn.dataset.bound = '1';
      btn.setAttribute('aria-label', '새 게시물 만들기');
    }
    if (btn.parentElement !== bar) bar.appendChild(btn);
  }

  // ─────────────────────────────────────────────────────────────
  // 7) Bootstrap
  // ─────────────────────────────────────────────────────────────
  ensureReady(()=>{
    mountPostButton();
    hookPostButtonForThreeStep();

    // 접근성 id/name 보정 (동적 DOM에서도 보정)
    function patchA11yIds(){
      document.querySelectorAll('textarea.im-caption').forEach((el,i)=>{ if (!el.id) el.id = i ? `im-caption-${i}` : "im-caption"; if (!el.name) el.name = "caption"; });
      document.querySelectorAll('input.feedc__file').forEach((el,i)=>{ if (!el.id) el.id = i ? `feedc__file-${i}` : "feedc__file"; if (!el.name) el.name = "file"; });
    }
    patchA11yIds();
    new MutationObserver(()=>patchA11yIds()).observe(document.documentElement, { childList:true, subtree:true });
  });

  // 필요 시 외부에서 직접 호출할 수 있게 노출
  SDF.Feed = Object.assign(SDF.Feed || {}, {
    openFeedModal,
    openComposeModal,
    openGalleryPicker,
    openCropModal,
    runThreeStepFlow,
    mountPostButton,
  });
})();


// 만료(401) 즉시 전환
window.addEventListener("auth:logout", ()=>{
  const ret = encodeURIComponent(location.href);
  location.replace(`${pageHref('login.html')}?next=${ret}`);
});
