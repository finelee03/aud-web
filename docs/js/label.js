// path: /scripts/label.js — store.js 기반 hearts & timestamps (탭/기기간 동기화)
// Behavior:
//  - 선택 라벨은 sessionStorage(탭 스코프)
//  - hearts/timestamps는 window.store API를 통해 관리(탭/기기간 + 서버 동기화)
//  - 로그인 상태일 때만 localStorage 브로드캐스트(크로스탭 선택 동기화)

"use strict";

let __bcLabel = null;
try { __bcLabel = new BroadcastChannel("aud:sync:label"); } catch {}

/* ── constants ─────────────────────────────────────────── */
const SELECTED_KEY = "aud:selectedLabel";            // sessionStorage
const MIRROR_KEY   = "aud:selectedLabel:mirror";     // localStorage broadcast (cross-tab, authed only)
const EVT          = "aud:selectedLabel-changed";
const FALLBACK_URL = "./gallery.html";
const MAX_STARS    = 3;
const BOOT_KEY     = "__boot.id";                    // guest reset on server reboot

const OK = ["thump","miro","whee","track","echo","portal"];

const MAP = {
  miro:   { category: "play", stars: 3 },
  whee:   { category: "asmr", stars: 1 },
  thump:  { category: "asmr", stars: 1 },
  track:  { category: "play", stars: 2 },
  echo:   { category: "asmr", stars: 2 },
  portal: { category: "play", stars: 2 },
};

const IMG_SRC = {
  thump:"./asset/thump.png",
  miro:"./asset/miro.png",
  whee:"./asset/whee.png",
  track:"./asset/track.png",
  echo:"./asset/echo.png",
  portal:"./asset/portal.png",
};

// store.js API 사용 (단일 소스)
const storeTsGet    = (lb) => window.store.getTimestamp(lb);
const storeTsSet    = (lb, ymd) => window.store.setTimestamp(lb, ymd);
const storeHeartGet = (lb) => window.store.getHeart(lb);
const storeHeartInc = (lb) => window.store.incrementHeart(lb);

/* ── login-gated localStorage helpers ───────────────────── */
function whenStoreReady(fn){
  if (window.store) fn();
  else window.addEventListener("store:ready", fn, { once: true });
}

function persistEnabled(){
  try { return !!(window.auth && window.auth.isAuthed && window.auth.isAuthed()); }
  catch { return false; }
}
function lsSet(k, v){ if (!persistEnabled()) return; try { localStorage.setItem(k, v); } catch {} }
function lsGet(k){ try { return persistEnabled() ? localStorage.getItem(k) : null; } catch { return null; } }

/* ── guest boot reset (server reboot) ───────────────────── */
window.addEventListener("auth:state", (ev)=>{
  try{
    const d = ev?.detail || {};
    if (!d.authed && d.bootId){
      const prev = sessionStorage.getItem(BOOT_KEY);
      if (prev !== d.bootId){
        sessionStorage.clear();
        sessionStorage.setItem(BOOT_KEY, d.bootId);
        scheduleSync();
      }
    }
  }catch{}
});

/* ── utils ─────────────────────────────────────────────── */
const isLabel = (x) => OK.includes(String(x));

function readSelected() {
  try {
    const v = sessionStorage.getItem(SELECTED_KEY);
    return (v && isLabel(v)) ? v : null;
  } catch { return null; }
}

/**
 * 선택 라벨 설정.
 * - 같은 탭: sessionStorage + EVT 디스패치
 * - 다른 탭: 로그인 상태일 때만 localStorage 브로드캐스트
 */
function setSelectedLabel(label) {
  if (!isLabel(label)) return;
  try {
    const prev = sessionStorage.getItem(SELECTED_KEY);
    if (prev !== label) {
      sessionStorage.setItem(SELECTED_KEY, label);
      window.dispatchEvent(new Event(EVT));
      // Authed: localStorage 브로드캐스트, Guest: BroadcastChannel 브로드캐스트
     if (persistEnabled()) {
       lsSet(MIRROR_KEY, JSON.stringify({ label, t: Date.now() }));
     } else if (__bcLabel) {
       __bcLabel.postMessage({ kind:"label:selected", label, t: Date.now() });
     }
    }
  } catch {}
}
// 전역 접근(비-모듈 환경)
try { if (typeof window !== "undefined") window.setSelectedLabel = setSelectedLabel; } catch {}

function ensureReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else { fn(); }
}

// rAF로 재렌더 합치기
let syncScheduled = false;
function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncAll();
  });
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

/* ── renderers ─────────────────────────────────────────── */
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

  row.appendChild(pill);
  row.appendChild(starsPill);
}

function renderLabelGalleryBox() {
  const box = document.getElementById("labelGalleryBox");
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

/* --- timestamp block --- */
const isValidYMD = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymdToDate  = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const todayYMD   = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const getTs = (label) => storeTsGet(label);
const setTs = (label, ymd) => { if (label && ymd) storeTsSet(label, ymd); };

function renderTimestamp() {
  const root = document.getElementById("timestamp");
  if (!root) return;

  const dataLabel = root.dataset.label || null;
  const dataDate  = root.dataset.date  || null;

  const selected = readSelected();
  const effectiveLabel = (dataLabel && isLabel(dataLabel)) ? dataLabel : (selected || "miro");

  if (isValidYMD(dataDate) && getTs(effectiveLabel) !== dataDate) setTs(effectiveLabel, dataDate);

  let ymd = isValidYMD(dataDate) ? dataDate : getTs(effectiveLabel);
  if (!isValidYMD(ymd)) { ymd = todayYMD(); setTs(effectiveLabel, ymd); }

  const d = ymdToDate(ymd);
  root.textContent = isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" }).toUpperCase();
}

/* --- heart button block --- */
const heartColorFromCount = (c) => {
  const t = 1 - Math.exp(-(c||0)/14);
  const hue = 350, sat = 88 - 6*t, light = 86 - 28*t;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
};
const heartColorWhileClicked = (c) => {
  const t = Math.max(0.85, 1 - Math.exp(-(c||0)/14));
  const hue = 350, sat = 88 - 6*t, light = 86 - 30*t;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
};

const getHeartCount = (label) => storeHeartGet(label) || 0;
const incHeart      = (label) => storeHeartInc(label);

function createHeartSVG({ filled, color = "#777" }) {
  const svg  = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("aria-hidden","true"); svg.style.display="block";
  const path = document.createElementNS("http://www.w3.org/2000/svg","path");
  path.setAttribute("d","M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4c1.74 0 3.41 1 4.22 2.44C11.09 5 12.76 4 14.5 4 17 4 19 6 19 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z");
  path.setAttribute("fill", filled ? color : "none");
  path.setAttribute("stroke", filled ? color : "#777");
  path.setAttribute("stroke-width", filled ? "0" : "1.5");
  svg.appendChild(path);
  return svg;
}

function renderHeartButton() {
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

  let timer = null;
  btn.addEventListener("click", () => {
    if (!label) return;
    const clicked = heartColorWhileClicked(getHeartCount(label));
    btn.removeChild(icon);
    icon = createHeartSVG({ filled: true, color: clicked });
    btn.appendChild(icon);

    incHeart(label);                 // store.js가 이벤트(label:hearts-changed) 브로드캐스트
    const n = getHeartCount(label);
    num.textContent = String(n);

    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.removeChild(icon);
      icon = createHeartSVG({ filled: true, color: heartColorFromCount(n) });
      btn.appendChild(icon);
    }, 420);
  });

  root.appendChild(btn);
  root.appendChild(num);
}

/* --- label story block --- */
const STORIES = {
  miro: `처음 종이 울리면서, 첫 번째 문이 열렸다.

길을 모르겠지만 찾아 나섰다.

두 번째 종은 더 깊은 차원의 문턱을 알려주었다.

마지막 종이 울릴 땐 알게 되었다.

찾아 헤맨 건 단지 출구가 아니라,

이 미로가 들려주고 싶었던 이야기라는 걸.

미로는 언제나 어딘가에 있고,

그 끝에서 새로운 차원을 맞이한다.`,
  whee: `딱, 하고 입구에 들어섰다.

정신없이 벽을 따라 내려갔다.

곡선은 길게 이어지고, 속도가 점점 붙었다.

코너를 돌 때마다 “휘잉—” 하고 소리가 났다.

방향은 정해져 있고, 멈출 틈은 없었다.

그저 지나가는 순간들일 뿐이었다.

그리고, 갑작스레 멈춤이 찾아왔다.

아무런 예고도 없이.

짧았지만, 분명히 하나의 여정이었다.`,
  thump: `구멍을 통과하자마자 두 갈래 길 앞에 놓였다.

방향을 선택할 수 없고, 자연스럽게 한쪽으로 떨어졌다.

통로는 단단하고 좁았다.

“우당탕탕”

소리를 내며 부딪히고, 벽에 닿고, 다시 튕겼다.

도착은 예고 없이 나타났다.

눈 앞에 또다른 통로가 보였다.

저 통로는 어디에서부터 이어진 것일까?`,
  track: `가느다란 선로 위를 덜컹덜컹 미끄러져 내려갔다.

프레임 안을 오르내리며 속도를 더했다가 줄였다가.

리듬을 타듯이 흔들린다.

순식간에 시야가 바뀌었다.

눈앞에는 새로운 여정으로 향하는 빛이 보였다.`,
  echo: `차가운 금속 파이프를 가볍게 두드리며 내려갔다.

울리는 소리가 공간을 가득채웠다.

잔향이 손끝에서 진동으로 전해졌다.

“둥… 둥… 둥…”

반복되는 메아리가 주변의 공간을 비집고 스며든다.

공명 속을 통과하는 낯선 느낌이 기분 좋다.`,
  portal: `문을 향해 정신없이 달렸다.

찬 바람이 휙― 하고 흘러들어와 눈을 감았다.

다시 눈을 떴을 때는 이미 낯선 공간 한가운데였다.

알 수 없는 빛이 들어오면서 몸이 순식간에 앞으로 끌려갔다.

도착은 예고 없이, 순식간에 이루어졌다.

저 문은 도대체 어느 차원으로 향하는 걸까?`,
};

function renderLabelStory() {
  const root = document.getElementById("labelStory");
  if (!root) return;
  const label = readSelected();
  if (!label) { root.innerHTML = ""; return; }
  const text = STORIES[label] || "";
  root.innerHTML = "";
  text.split("\n").forEach(line => {
    const p = document.createElement("p");
    p.textContent = line;
    root.appendChild(p);
  });
}

/* ── compose & wire ───────────────────────────────────── */
function syncAll() {
  renderCategoryRow();
  renderLastLabel();
  renderLabelGalleryBox();
  renderTimestamp();
  renderHeartButton();
  renderLabelStory();
}

ensureReady(() => whenStoreReady(() => {
  // 첫 렌더
  syncAll();

  // same-tab (coalesced)
  window.addEventListener(EVT, scheduleSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync();
  });
  window.addEventListener("pageshow", scheduleSync); // BFCache 복귀 대비

  // ✅ store.js에서 브로드캐스트하는 변경 이벤트 수신 (이미 존재하던 라인 유지)
  window.addEventListener("label:timestamps-changed", scheduleSync);
  window.addEventListener("label:hearts-changed", scheduleSync);

  // cross-tab (선택 라벨만) → 로그인 상태일 때만 반응 (기존 그대로)
  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (!persistEnabled()) return;
    if (e.key === MIRROR_KEY && e.newValue) {
      try {
        const { label } = JSON.parse(e.newValue);
        if (isLabel(label)) {
          const prev = sessionStorage.getItem(SELECTED_KEY);
          if (prev !== label) sessionStorage.setItem(SELECTED_KEY, label);
          scheduleSync();
        }
      } catch {}
    }
  });

  // BroadcastChannel(게스트)의 선택 라벨 동기화 리스너 (이미 추가돼 있다면 유지)
  try {
    if (__bcLabel) {
      __bcLabel.addEventListener("message", (e)=>{
        const m = e?.data;
        if (!m || m.kind !== "label:selected") return;
        if (m.label && isLabel(m.label)) {
          sessionStorage.setItem(SELECTED_KEY, m.label);
          window.dispatchEvent(new Event(EVT));
        }
      });
    }
  } catch {}

  // 로그아웃 시 선택 상태 정리 (유지)
  window.addEventListener("auth:logout", () => {
    try { sessionStorage.removeItem(SELECTED_KEY); } catch {}
    scheduleSync();
  });
}));

// URL ?label=... 처리 + 폴백 라우팅 (safe against same-URL loops)
(() => {
  try {
    const q = new URLSearchParams(location.search).get("label");
    const here = new URL(location.href);
    const fallback = new URL(FALLBACK_URL, location.href);

    if (q && isLabel(q)) {
      setSelectedLabel(q);
      return;
    }

    if (!sessionStorage.getItem(SELECTED_KEY)) {
      if (here.href !== fallback.href) {
        location.replace(fallback.href);
      }
    }
  } catch {
    try { location.replace(FALLBACK_URL); } catch {}
  }
})();
