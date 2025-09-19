/* ======================
   store.js  (Vanilla JS, Global)
   ====================== */

/* ────────────────────────────────────────────────────────────
   공통: 상수/유틸
──────────────────────────────────────────────────────────── */
const ALL_LABELS = /** @type {const} */ (["thump","miro","whee","track","echo","portal"]);
const isLabel = (x) => typeof x === "string" && ALL_LABELS.includes(x);

const ALL_JIBS = /** @type {const} */ (["bloom","tail","cap","keyring","duck","twinkle","xmas","bunny"]);
const isJibKind = (v)=> typeof v==="string" && ALL_JIBS.includes(v);

const VERSION_KEY = "storeVersion";
const VERSION     = 1;

const GALLERY_EVENT = "sdf:gallery-changed";
const GUEST_BUS_KEY = "guest:bus";

const AUTO_MIGRATE_GUEST_TO_USER = false;

const SESSION_USER_NS_KEY = "auth:userns:session";

/* ── auth 세션 플래그: 탭 생존 동안 유지 ───────────────────*/
const AUTH_FLAG_KEY = "auth:flag";
function hasAuthedFlag(){ try{ return sessionStorage.getItem(AUTH_FLAG_KEY) === "1"; }catch{ return false; } }
function serverAuthed(){ try{ return !!(window.auth && window.auth.isAuthed && window.auth.isAuthed()); }catch{ return false; } }
function sessionAuthed(){ return hasAuthedFlag() || serverAuthed(); }

// ===== 스냅샷 강제 저장(LS + 서버 keepalive) =====
function __forceLsSet(key, obj){
  try { localStorage.setItem(key, JSON.stringify({ ...obj, t: Date.now() })); } catch {}
}

async function __pushStateKeepalive(){
  if (!serverAuthed()) return;
  const payload = {
    version: STATE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    ns: USER_NS,
    labels: [...readLabelSet()],
    labelSelected: readSelectedLabel(),
    timestamps: loadTimestamps(),
    hearts: loadHearts(),
    likes: loadLikes(), 
    jibs: { selected: readJibSelected(), collected: [...readJibCollectedSet()] },
  };
  try {
    await apiFetch(SERVER_ENDPOINT_STATE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,       // ← 탭 닫혀도 전송 지속
    });
  } catch {}
}

async function __flushSnapshot(opts = { server: true }){
  try {
    // 1) 로컬 스냅샷(항상 강제)
    __forceLsSet(LABEL_SYNC_KEY,  { type:"set", arr: [...readLabelSet()] });
    __forceLsSet(JIB_SYNC_KEY,    { type:"set", arr: [...readJibCollectedSet()] });
    __forceLsSet(HEARTS_SYNC_KEY, { map: loadHearts() });
    __forceLsSet(TS_SYNC_KEY,     { map: loadTimestamps() });
    __forceLsSet(LIKES_SYNC_KEY,  { map: loadLikes() });
    __forceLsSet(LABEL_VOTES_SYNC_KEY, { map: loadLabelVotes() });
    // 2) 서버에도 푸시(옵션)
    if (opts.server) await __pushStateKeepalive();
  } catch {}
}

// 전역에서 호출할 수 있게 노출(탭 종료 훅들이 참조)
window.__flushStoreSnapshot = __flushSnapshot;

// 탭/페이지가 백그라운드로 가거나 닫히기 직전에 항상 플러시
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") __flushSnapshot({ server: true });
}, { capture: true });

window.addEventListener("pagehide", () => { __flushSnapshot({ server: true }); }, { capture: true });
window.addEventListener("beforeunload", () => { __flushSnapshot({ server: true }); }, { capture: true });

// PATCH: helpers (public)
function readHeartsMap(){ return loadHearts(); }
// ★ 라벨별 투표 총합(SSOT)
function loadLabelVotes(){
  try { const raw = localStorage.getItem(LABEL_VOTES_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function saveLabelVotes(map){
  try { localStorage.setItem(LABEL_VOTES_KEY, JSON.stringify(map||{})); } catch {}
  // 탭 간 동기화 방송
  try { localStorage.setItem(LABEL_VOTES_SYNC_KEY, JSON.stringify({ map, t: Date.now() })); } catch {}
  try { window.dispatchEvent(new CustomEvent("label:votes-changed", { detail: { map } })); } catch {}
}
function readLabelVotes(){ return loadLabelVotes(); }

/* ── Label Votes SSOT API ───────────────────────────────────────────── */
const ALL_LABELS_SET = new Set(ALL_LABELS);
function zeroLabelMap(){ const m = {}; for (const k of ALL_LABELS) m[k] = 0; return m; }

// counts: {thump:number,...} (아이템 단위의 투표 카운트 "스냅샷"을 SSOT 총합에 누산)
function applyItemVoteCounts(counts){
  if (!counts || typeof counts !== 'object') return;
  const base = { ...zeroLabelMap(), ...loadLabelVotes() };
  for (const k of Object.keys(counts)) {
    if (!ALL_LABELS_SET.has(k)) continue;
    const n = Number(counts[k] || 0);
    base[k] = Math.max(0, Number(base[k] || 0) + n); // 누산(집계 정책: 총합)
  }
  saveLabelVotes(base);
}

// 델타 적용: 특정 라벨에 +1/-1
function addLabelVoteDelta(label, delta){
  if (!ALL_LABELS_SET.has(label)) return;
  const m = { ...zeroLabelMap(), ...loadLabelVotes() };
  m[label] = Math.max(0, Number(m[label] || 0) + Number(delta || 0));
  saveLabelVotes(m);
}

// 전면 교체(서버 권위치로 덮어쓰기)
function setLabelVotesMap(nextMap){
  const m = { ...zeroLabelMap(), ...(nextMap || {}) };
  for (const k of Object.keys(m)) if (!ALL_LABELS_SET.has(k)) delete m[k];
  saveLabelVotes(m);
}

// 전역 공개
window.applyItemVoteCounts = applyItemVoteCounts;
window.addLabelVoteDelta   = addLabelVoteDelta;
window.setLabelVotesMap    = setLabelVotesMap;
window.readLabelVotes = readLabelVotes;


/* ────────────────────────────────────────────────────────────
   네임스페이스 기반 키
──────────────────────────────────────────────────────────── */
let USER_NS = getUserNS();           // ← 동적 변경 가능
window.__STORE_NS = USER_NS;

const nsKey = (k)=> `${k}:${USER_NS}`;

let JIB_EVT            = "jib:selected-changed";
let JIB_COLLECTED_EVT  = "jib:collection-changed";
let LABEL_SELECTED_EVT   = "label:selected-changed";
let LABEL_COLLECTED_EVT  = "label:collected-changed";

let LABEL_SYNC_KEY, JIB_SYNC_KEY, HEARTS_SYNC_KEY, TS_SYNC_KEY, LIKES_SYNC_KEY, LABEL_VOTES_SYNC_KEY;
let STATE_UPDATED_AT_LS;
let LABEL_COLLECTED_KEY, LABEL_TEMP_KEY, TIMESTAMPS_KEY, HEARTS_KEY, LABEL_SELECTED_KEY, LIKES_KEY, LABEL_VOTES_KEY;
let SESSION_INIT_KEY;
let JIB_SELECTED_KEY, JIB_COLLECTED_KEY;

function recalcKeys(){
  LABEL_SYNC_KEY       = nsKey("label:sync");
  JIB_SYNC_KEY         = nsKey("jib:sync");
  HEARTS_SYNC_KEY      = nsKey("label:hearts-sync");
  TS_SYNC_KEY          = nsKey("label:ts-sync");
  LIKES_SYNC_KEY       = nsKey("itemLikes:sync"); 
  LABEL_VOTES_SYNC_KEY = nsKey("labelVotes:sync");
  STATE_UPDATED_AT_LS  = nsKey("state:updatedAt");
  LABEL_COLLECTED_KEY  = nsKey("collectedLabels");
  LABEL_TEMP_KEY       = nsKey("tempCollectedLabels");
  TIMESTAMPS_KEY       = nsKey("labelTimestamps");
  HEARTS_KEY           = nsKey("labelHearts");
  LIKES_KEY            = nsKey("itemLikes");  
  LABEL_VOTES_KEY      = nsKey("labelVotes");
  LABEL_SELECTED_KEY   = nsKey("aud:selectedLabel");
  SESSION_INIT_KEY     = nsKey("sdf-session-init-v1");
  JIB_SELECTED_KEY     = nsKey("jib:selected");
  JIB_COLLECTED_KEY    = nsKey("jib:collected");
}
recalcKeys();

window.LABEL_SYNC_KEY = LABEL_SYNC_KEY;  // e.g., "label:sync:<ns>"
window.JIB_SYNC_KEY   = JIB_SYNC_KEY;    // e.g., "jib:sync:<ns>"
window.LIKES_SYNC_KEY = LIKES_SYNC_KEY;
window.LABEL_VOTES_SYNC_KEY = LABEL_VOTES_SYNC_KEY;

/* ── 로그인/로그아웃 등 Auth 상태 변경 감지: NS 재계산 + 필요 시 세션→로컬 이관 ───────── */
(function installAuthNSWatcher(){
  let last = typeof USER_NS !== "undefined" ? USER_NS : "default";

  function nsKeyFor(ns, base){ return `${base}:${ns}`; }
  function migrateIfNeeded(fromNS = "default", toNS = USER_NS){
    if (!AUTO_MIGRATE_GUEST_TO_USER) return; // ★ 자동 이관 끔
    try{
      if (!toNS || toNS === "default") return; // 게스트→게스트는 패스
      const markKey = `__migrated:${toNS}`;
      if (localStorage.getItem(markKey) === "1") return;

      const bases = [
        "collectedLabels","tempCollectedLabels","labelTimestamps","labelHearts",
        "aud:selectedLabel","jib:selected","jib:collected"
      ];

      let touched = false;
      for (const base of bases){
        const fromK = nsKeyFor(fromNS, base);
        const toK   = nsKeyFor(toNS,   base);
        const sv = sessionStorage.getItem(fromK);
        const lv = localStorage.getItem(toK);
        if (sv && !lv){ try { localStorage.setItem(toK, sv); touched = true; } catch {} }
      }

      if (touched){
        try { localStorage.setItem(markKey, "1"); } catch {}
        try { localStorage.setItem("guest:bus", JSON.stringify({ kind: "migrated", ns: toNS, t: Date.now() })); } catch {}
        try { setTimeout(()=> localStorage.removeItem("guest:bus"), 0); } catch {}
      }
    } catch {}
  }

  function refreshNS(){
    try{
      const next = (function(){
        // 인증 안되면 default
        try { if (!(hasAuthedFlag() || (window.auth?.isAuthed?.()))) return "default"; } catch {}
        // 세션(탭) NS 우선
        try {
          const ss = sessionStorage.getItem(SESSION_USER_NS_KEY);
          if (ss && ss.trim()) return ss.trim().toLowerCase();
        } catch {}
        // 폴백: 레거시 전역 NS
        try {
          const ns = localStorage.getItem("auth:userns");
          if (ns && ns.trim()) return ns.trim().toLowerCase();
        } catch {}
        return "default";
      })();

      if (next === last) return;

      const from = last;
      USER_NS = next;
      window.__STORE_NS = USER_NS;
      recalcKeys();
      migrateIfNeeded(from, USER_NS);
      last = USER_NS;

      try { window.dispatchEvent(new CustomEvent("store:ns-changed", { detail: USER_NS })); } catch {}
      try { rebindNS(); } catch {}
    }catch{}
  }

  // 외부에서 수동 호출 가능
  window.__storeAuthRefresh = refreshNS;

  // storage 이벤트로 감지 (다른 탭/윈도우 포함)
  window.addEventListener("storage", (e) => {
    if (!e?.key) return;

    // auth:flag 변화는 항상 반영
    if (e.key === "auth:flag") { refreshNS(); return; }

    // ⚠️ 다른 탭이 바꾼 전역 auth:userns는,
    // 이 탭이 이미 세션 NS를 갖고 있으면 '무시' (크로스-계정 간섭 차단)
    if (e.key === "auth:userns") {
      try {
        if (sessionStorage.getItem(SESSION_USER_NS_KEY)) return;
      } catch {}
      refreshNS();
    }
  });

  // [ADD] 인사이트 캐시 정리 유틸 (NS 바뀌거나 로그아웃 시 호출 추천)
  (function installInsightsCacheCleaner(){
    function clearInsights(ns){
      try { sessionStorage.removeItem(`insights:${(ns||"default").toLowerCase()}`); } catch {}
    }
    // NS 변경 브로드캐스트 수신
    window.addEventListener("store:ns-changed", (e)=>{
      const next = (e?.detail || "default"); clearInsights(next);
    });
    // 명시 로그아웃 훅(앱 로직에 따라 호출)
    window.addEventListener("auth:logout", ()=>{
      try {
        const ns = (localStorage.getItem("auth:userns") || "default");
        clearInsights(ns);
      } catch {}
    });
  })();

  // 현재 탭 내 로그인 로직에서 커스텀 이벤트로 알림 가능
  window.addEventListener("auth:changed", refreshNS);

  function setSessionUserNS(ns){
    try { sessionStorage.setItem(SESSION_USER_NS_KEY, String(ns||"").toLowerCase()); } catch {}
    try { window.dispatchEvent(new CustomEvent("store:ns-changed", { detail: String(ns||"").toLowerCase() })); } catch {}
  }
  window.setSessionUserNS = setSessionUserNS;
})();


/* ── 사용자 네임스페이스 ─────────────────────────────────── */
/** 로그인 직후 login.js에서 localStorage.setItem("auth:userns", userIdOrEmail) 권장 */
let BC_NAME = `aud:sync:${USER_NS}`;
let bc = null;

/* === NEW: Cross-tab SyncBus (guest: BroadcastChannel, authed: localStorage) === */
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

function openBC(name){
  try {
    return new BroadcastChannel(name);
  } catch { return null; }
}
bc = openBC(BC_NAME);

function getUserNS(){
  // 인증 안됐으면 항상 default
  try { if (!(hasAuthedFlag() || (window.auth?.isAuthed?.()))) return "default"; } catch {}

  // 1순위: 세션(탭) 스코프 NS
  try {
    const ss = sessionStorage.getItem(SESSION_USER_NS_KEY);
    if (ss && ss.trim()) return ss.trim().toLowerCase();
  } catch {}

  // 2순위: 레거시 폴백 (다른 탭과 공유됨)
  try {
    const ns = localStorage.getItem("auth:userns");
    if (ns && ns.trim()) return ns.trim().toLowerCase();
  } catch {}

  return "default";
}

/* ── 서버 동기화 설정 ─────────────────────────────────────── */
const SERVER_SYNC_ON = true;               // 상태(라벨/하트/타임스탬프/지비츠) 동기화
const SERVER_GALLERY_SYNC_ON = true;       // 갤러리 이미지/메타 서버 업로드
const STATE_SCHEMA_VERSION = 1;
const SERVER_ENDPOINT_STATE   = "/api/state";
const SERVER_ENDPOINT_G_UPLOAD= "/api/gallery/upload";
const SERVER_ENDPOINT_G_BLOB  = (id)=> `/api/gallery/${encodeURIComponent(id)}/blob`;

/* persistEnabled: 로컬 동기화 허용 조건 = 세션 인증 */
function persistEnabled() { return sessionAuthed(); }

/* localStorage 접근 래퍼 (persistEnabled=false면 no-op/null) */
function lsSet(key, val) {
  if (!persistEnabled()) return;
  try { localStorage.setItem(key, val); } catch {}
}
function lsGet(key) {
  try { return persistEnabled() ? localStorage.getItem(key) : null; }
  catch { return null; }
}

/* 안전 JSON 파서 */
function safeParse(raw, fb){
  if(!raw) return fb;
  try{ return JSON.parse(raw); }catch{ return fb; }
}

// === itemLikes: 계정(네임스페이스)별 per-item 좋아요 의도/스냅샷 ===
// 구조: { [itemId]: { l: boolean, c?: number, t: epochMs } }
function loadLikes(){
  return safeParse(S.getItem(LIKES_KEY), {}) || {};
}
function saveLikes(map){
  try{
    S.setItem(LIKES_KEY, JSON.stringify(map));
    // 탭 간 동기화
    emitSync(LIKES_SYNC_KEY, { map });
    // 서버 동기화 (선택)
    scheduleServerSync();
    window.dispatchEvent(new CustomEvent("itemLikes:changed", { detail: { map } }));
    // 내부 이벤트가 필요하면: window.dispatchEvent(new Event("itemLikes:changed"));
  }catch{}
}
// 편의: 한 건 갱신
function setLikeIntent(itemId, liked, likes){
  const m = loadLikes();
  m[String(itemId)] = { l: !!liked, c: (typeof likes==="number"? Math.max(0, likes) : (m[String(itemId)]?.c ?? undefined)), t: Date.now() };
  saveLikes(m);
}
function getLikeIntent(itemId){
  const r = loadLikes()[String(itemId)];
  return r ? { liked: !!r.l, likes: (typeof r.c==="number"? r.c : null), t: r.t||0 } : null;
}
function setLikeCountOnly(itemId, likes){
  const m = loadLikes();
  const cur = m[String(itemId)] || {};
  m[String(itemId)] = { l: !!cur.l, c: Math.max(0, Number(likes)||0), t: Date.now() };
  saveLikes(m);
}

window.readLikesMap = () => ({ ...loadLikes() });
window.setLikeIntent = setLikeIntent;
window.getLikeIntent = getLikeIntent;
window.setLikeCountOnly = setLikeCountOnly;

/* Storage 라우팅 래퍼: 게스트=SESSION, 회원=LOCAL */
const S = new (class {
  _current() {
    try {
      // USER_NS === "default" => 게스트(탭간 동기화만), 그 외 => 회원(영구 저장)
      const ns = (typeof USER_NS !== "undefined" ? USER_NS : "default");
      return ns === "default" ? window.sessionStorage : window.localStorage;
    } catch { 
      // 스토리지 접근 불가 환경 폴백
      return { getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{}, key:()=>null, length:0 };
    }
  }
  getItem(k){ try{ return this._current().getItem(k); }catch{ return null; } }
  setItem(k,v){ try{ return this._current().setItem(k,v); }catch{} }
  removeItem(k){ try{ return this._current().removeItem(k); }catch{} }
  clear(){ try{ return this._current().clear(); }catch{} }
  key(i){ try{ return this._current().key(i); }catch{ return null; } }
  get length(){ try{ return this._current().length; }catch{ return 0; } }
})();
/** 날짜 (KST) YYYY-MM-DD */
function todayKST(){
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p=>p.type==="year")?.value ?? "1970";
  const m = parts.find(p=>p.type==="month")?.value ?? "01";
  const d = parts.find(p=>p.type==="day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/* 버전 플래그 */
(function ensureVersion(){
  const v = Number(S.getItem(VERSION_KEY) ?? 0);
  if(v < VERSION) S.setItem(VERSION_KEY, String(VERSION));
})();


function postGuest(msg){
  if (!bc) return;
  try { bc.postMessage({ ...msg, __from: TAB_ID, __ts: Date.now() }); } catch {}
}
function onGuest(fn){
  if (!bc) return;
  bc.addEventListener("message", (e) => {
    const m = e?.data;
    if (!m || m.__from === TAB_ID) return; // self-echo 방지
    fn(m);
  });
}

/** persist 브로드캐스트(Authed) vs ephem 브로드캐스트(Guest) */
function emitSyncLS(key, payload){
  // Authed용: 지속 브로드캐스트
  lsSet(key, JSON.stringify({ ...payload, t: Date.now(), src: TAB_ID }));
}
function emitSyncGuest(kind, payload){
  // Guest용: 비지속 브로드캐스트
  postGuest({ kind, payload });
}

/** 공통 브로드캐스트 진입점 */
function emitSync(kindKey, payload){
  if (persistEnabled()) emitSyncLS(kindKey, payload);
  else {
    if (bc) emitSyncGuest(kindKey, payload); // BC 가능하면 그대로
    else {
      // ❖ BC 없음 → storage 이벤트 폴백
      try {
        localStorage.setItem(GUEST_BUS_KEY, JSON.stringify({ kind: kindKey, payload, t: Date.now() }));
        // 같은 키로 연속 트리거하려면 삭제→재설정이 안전
        setTimeout(()=>{ try { localStorage.removeItem(GUEST_BUS_KEY); } catch {} }, 0);
      } catch {}
    }
  }
}

/** 수신 핸들러: 외부에서 온 변경을 세션에 반영(루프 금지) */
function applyIncoming(kindKey, payload){
  try{
    if (kindKey === LIKES_SYNC_KEY && payload?.map){
      // 세션에만 반영 (재브로드캐스트 금지)
      S.setItem(LIKES_KEY, JSON.stringify(payload.map));
      window.dispatchEvent(new CustomEvent("itemLikes:changed", { detail: { map: payload.map } }));
      return;
    }
    if (kindKey === HEARTS_SYNC_KEY && payload?.map){
      // 세션 하트 맵 갱신만 (재브로드캐스트 금지)
      S.setItem(HEARTS_KEY, JSON.stringify(payload.map));
      window.dispatchEvent(new Event("label:hearts-changed"));
      return;
    }
    if (kindKey === TS_SYNC_KEY && payload?.map){
      S.setItem(TIMESTAMPS_KEY, JSON.stringify(payload.map));
      window.dispatchEvent(new Event("label:timestamps-changed"));
      return;
    }
    if (kindKey === LABEL_VOTES_SYNC_KEY && payload?.map){
      // SSOT에 즉시 반영(+ 탭 방송 + 이벤트 발생)
      saveLabelVotes(payload.map);
      return;
    }
    if (kindKey === LABEL_SYNC_KEY){
      if (payload?.type === "select") {
        if (payload.label && isLabel(payload.label)) {
          S.setItem(LABEL_SELECTED_KEY, payload.label);
          window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
        } else {
          S.removeItem(LABEL_SELECTED_KEY);
          window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
        }
      } else if (payload?.type === "set" && Array.isArray(payload.arr)) {
        const arr = payload.arr.filter(isLabel);
        S.setItem(LABEL_COLLECTED_KEY, JSON.stringify(arr));
        window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
      }
      return;
    }
    if (kindKey === JIB_SYNC_KEY && payload){
      if (payload.type === "set" && Array.isArray(payload.arr)) {
        const arr = payload.arr.filter(isJibKind);
        S.setItem(JIB_COLLECTED_KEY, JSON.stringify(arr));
        window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
        return;
      }
      if (payload.type === "select") {
        if (payload.k && isJibKind(payload.k)) S.setItem(JIB_SELECTED_KEY, payload.k);
        else S.removeItem(JIB_SELECTED_KEY);
        window.dispatchEvent(new Event(JIB_EVT));
        return;
      }
    }
  }catch{}
}

/** Authed: localStorage(storage) 수신 */
window.addEventListener("storage", (e)=>{
  // 로그인(=persistEnabled) 상태면: 지속 스냅샷 키들 수신
  if (persistEnabled()) {
    const k = e?.key;
    if (!k || (k !== HEARTS_SYNC_KEY && k !== TS_SYNC_KEY && k !== LABEL_SYNC_KEY && k !== JIB_SYNC_KEY && k !== LABEL_VOTES_SYNC_KEY)) return;
    try {
      const payload = JSON.parse(e.newValue || "null");
      applyIncoming(k, payload);
    } catch {}
    return;
  }

  // 게스트: BroadcastChannel 미지원 폴백 (guest-bus)
  if (e?.key === GUEST_BUS_KEY && e.newValue) {
    try {
      const m = JSON.parse(e.newValue);
      if (m && m.kind) applyIncoming(m.kind, m.payload);
    } catch {}
  }
});


/** Guest: BroadcastChannel 수신 */
onGuest((m)=>{
  const k = m?.kind;
  if (k === HEARTS_SYNC_KEY || k === TS_SYNC_KEY || k === LABEL_SYNC_KEY || k === JIB_SYNC_KEY || k === LABEL_VOTES_SYNC_KEY){
    applyIncoming(k, m.payload);
  }
});

/* ────────────────────────────────────────────────────────────
   서버 통신 유틸
──────────────────────────────────────────────────────────── */
async function apiFetch(path, init){
  try{
    // window.auth.apiFetch가 있으면 우선 사용
    if (window.auth && typeof window.auth.apiFetch === "function") {
      return await window.auth.apiFetch(path, init);
    }
    // 없으면 일반 fetch (쿠키 포함)
    return await fetch(path, { credentials: "include", ...init });
  }catch{
    return null;
  }
}

/* 서버 상태 푸시(디바운스) */
// --- 기존 scheduleServerSync/pushStateToServer/pullStateFromServerOnce 블록을 이걸로 교체 ---

let serverSyncTimer = null;
function scheduleServerSync(delay = 350) {
  if (!SERVER_SYNC_ON || !serverAuthed()) return;
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(pushStateToServer, delay);
}

async function pushStateToServer() {
  serverSyncTimer = null;
  if (!SERVER_SYNC_ON || !serverAuthed()) return;

  const state = {
    version: STATE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    labels: [...readLabelSet()],
    labelSelected: readSelectedLabel(),
    timestamps: loadTimestamps(),
    hearts: loadHearts(),
    likes: loadLikes(), 
    labelVotes: loadLabelVotes(),
    jibs: {
      selected: readJibSelected(),
      collected: [...readJibCollectedSet()],
    },
  };

  try {
    if (window.auth?.saveState) {
      const ok = await window.auth.saveState(USER_NS, state);
      if (ok) lsSet(STATE_UPDATED_AT_LS, String(state.updatedAt));
      return;
    }
    // 폴백: 서버가 구버전이면 덮을 수 있게 POST/PUT 둘 다 허용
    const res = await apiFetch(SERVER_ENDPOINT_STATE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: USER_NS, state }),
    });
    if (res && res.ok) lsSet(STATE_UPDATED_AT_LS, String(state.updatedAt));
  } catch {}
}

let pulledOnceFromServer = false;
async function pullStateFromServerOnce() {
  if (pulledOnceFromServer) return;
  pulledOnceFromServer = true;
  if (!SERVER_SYNC_ON || !serverAuthed()) return;

  try {
    let data = null;
    if (window.auth?.loadState) {
      data = await window.auth.loadState(USER_NS);          // => {…state}
    } else {
      const res = await apiFetch(`${SERVER_ENDPOINT_STATE}?ns=${encodeURIComponent(USER_NS)}`, { method: "GET" });
      if (!res || !res.ok) return;
      const j = await res.json();
      data = j?.state || j || null;                          // 둘 다 수용
    }
    if (!data || typeof data !== "object") return;

    const remoteUpdated = Number(data.updatedAt || 0);
    const localUpdated  = Number(lsGet(STATE_UPDATED_AT_LS) || 0);
    if (remoteUpdated && remoteUpdated <= localUpdated) return;

    // 세션으로 리하이드레이트
    if (Array.isArray(data.labels)) {
      S.setItem(LABEL_COLLECTED_KEY, JSON.stringify(data.labels.filter(isLabel)));
      window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
    }
    if (typeof data.labelSelected === "string" || data.labelSelected === null) {
      if (isLabel(data.labelSelected)) S.setItem(LABEL_SELECTED_KEY, data.labelSelected);
      else S.removeItem(LABEL_SELECTED_KEY);
      window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
    }
    if (data.timestamps && typeof data.timestamps === "object") {
      S.setItem(TIMESTAMPS_KEY, JSON.stringify(data.timestamps));
      window.dispatchEvent(new Event("label:timestamps-changed"));
    }
    if (data.hearts && typeof data.hearts === "object") {
      S.setItem(HEARTS_KEY, JSON.stringify(data.hearts));
      window.dispatchEvent(new Event("label:hearts-changed"));
    }
    if (data.jibs && typeof data.jibs === "object") {
      if (Array.isArray(data.jibs.collected)) {
        S.setItem(JIB_COLLECTED_KEY, JSON.stringify(data.jibs.collected.filter(isJibKind)));
        window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
      }
      if (typeof data.jibs.selected === "string" || data.jibs.selected === null) {
        if (isJibKind(data.jibs.selected)) S.setItem(JIB_SELECTED_KEY, data.jibs.selected);
        else S.removeItem(JIB_SELECTED_KEY);
        window.dispatchEvent(new Event(JIB_EVT));
      }
    }

    if (remoteUpdated) lsSet(STATE_UPDATED_AT_LS, String(remoteUpdated));
  } catch {}
}

/* ────────────────────────────────────────────────────────────
   라벨(Labels): 지비츠 스타일 API + 탭/서버 동기화
──────────────────────────────────────────────────────────── */

/* 라벨: 내부 읽기/쓰기 */
function readLabelSet(){
  try{
    const raw = S.getItem(LABEL_COLLECTED_KEY);
    if(!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter(isLabel) : []);
  }catch{ return new Set(); }
}
function writeLabelSet(set){
  try {
    const arr = [...set];
    S.setItem(LABEL_COLLECTED_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
    // 🔔 탭 브로드캐스트(내용 동봉)
    emitSync(LABEL_SYNC_KEY, { type:"set", arr });
    // 🔔 서버 동기화
    scheduleServerSync();
  } catch {}
}

/* 라벨: 선택 상태 */
function readSelectedLabel(){
  try{
    const raw = S.getItem(LABEL_SELECTED_KEY);
    return (typeof raw==="string" && isLabel(raw)) ? raw : null;
  }catch{ return null; }
}
function writeSelectedLabel(label){
  try{
    if(label) S.setItem(LABEL_SELECTED_KEY, label);
    else S.removeItem(LABEL_SELECTED_KEY);
    window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
    emitSync(LABEL_SYNC_KEY, { type:"select", label: label ?? null });
    scheduleServerSync();
  }catch{}
}

/* 라벨: 임시 목록 */
function readTempList(){ const arr = safeParse(S.getItem(LABEL_TEMP_KEY), []); return Array.isArray(arr) ? arr.filter(isLabel) : []; }
function writeTempList(arr){ try{ S.setItem(LABEL_TEMP_KEY, JSON.stringify(arr.filter(isLabel))); }catch{} }

/* 라벨: 타임스탬프/하트 */
function loadTimestamps(){
  const parsed = safeParse(S.getItem(TIMESTAMPS_KEY), {});
  const out = {};
  if(parsed && typeof parsed === "object"){
    for(const k of Object.keys(parsed)){
      if(isLabel(k)){
        const v = parsed[k];
        if(typeof v === "string") out[k] = v;
      }
    }
  }
  return out;
}
function loadHearts(){
  const parsed = safeParse(S.getItem(HEARTS_KEY), {});
  const out = {};
  if (parsed && typeof parsed === "object"){
    for (const k of Object.keys(parsed)){
      if (isLabel(k)){
        const v = parsed[k];
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v|0;
      }
    }
  }
  return out;
}
function saveTimestamps(map){
  try{
    S.setItem(TIMESTAMPS_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event("label:timestamps-changed"));
    emitSync(TS_SYNC_KEY, { map });
    scheduleServerSync();
  }catch{}
}
function saveHearts(map){
  try{
    S.setItem(HEARTS_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event("label:hearts-changed"));
    emitSync(HEARTS_SYNC_KEY, { map });
    scheduleServerSync();
  }catch{}
}

/* 라벨: 갤러리(라벨별) — 사용자별 분리 */
const GALLERY_META_KEY = (label) => `sdf-gallery-meta-v1:${USER_NS}:${label}`;
const getDBName = () => `sdf-gallery-db:${USER_NS}`;
const DB_STORE  = "images";
/** @typedef {{ id:string,label:string,createdAt:number,width:number,height:number,thumbDataURL:string }} GalleryMeta */

function emitGalleryChanged(detail){
  try{ window.dispatchEvent(new CustomEvent(GALLERY_EVENT, { detail })); }catch{}
}
function loadGalleryMeta(label){
  const arr = safeParse(localStorage.getItem(GALLERY_META_KEY(label)), []);
  return arr.sort((a,b)=>a.createdAt-b.createdAt);
}
function saveGalleryMeta(label, items){
  try{ localStorage.setItem(GALLERY_META_KEY(label), JSON.stringify(items)); }catch{}
}
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(getDBName(), 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror   = ()=> reject(req.error);
  });
}
async function idbPutBlob(id, blob){
  const db = await openDB();
  await new Promise((res, rej)=>{
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(blob, id);
    tx.oncomplete = ()=>res();
    tx.onerror    = ()=>rej(tx.error);
  });
}
async function idbGetBlob(id){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(DB_STORE, "readonly");
    const r = tx.objectStore(DB_STORE).get(id);
    r.onsuccess = ()=> res(r.result ?? null);
    r.onerror   = ()=> rej(r.error);
  });
}
async function idbDeleteBlob(id){
  const db = await openDB();
  await new Promise((res, rej)=>{
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = ()=>res();
    tx.onerror    = ()=>rej(tx.error);
  });
}
async function idbClearAll(){
  const db = await openDB();
  await new Promise((res, rej)=>{
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = ()=>res();
    tx.onerror    = ()=>rej(tx.error);
  });
}

/* “새 세션” 첫 진입 시 초기화: 게스트(비인증)에서만 */
(function guestInitOnce(){
  if (S.getItem(SESSION_INIT_KEY)) return;
  function doInit(){
    S.setItem(SESSION_INIT_KEY, "1");
    (async()=>{
      try{
        await idbClearAll();
        ALL_LABELS.forEach(lb=>saveGalleryMeta(lb, []));
        ALL_LABELS.forEach(lb=>emitGalleryChanged({kind:"clear", label:lb}));
      }catch{}
    })();
  }
  // 이미 게스트 확정이면 즉시, 아니면 auth:state를 기다림
  if (!sessionAuthed()) {
    // auth 부팅이 아직이라도 ‘게스트 확정’ 조건이면 바로 초기화
    const hasFlag = hasAuthedFlag();
    if (!hasFlag) doInit();
    return;
  }
  // 상태 이벤트로 게스트 확정됐을 때만 1회 수행
  window.addEventListener("auth:state", (ev)=>{
    const ready = !!ev?.detail;
    const authed = !!ev?.detail?.authed;
    if (ready && !authed && !S.getItem(SESSION_INIT_KEY)) doInit();
  }, { once:true });
})();

/* ────────────────────────────────────────────────────────────
   라벨: 외부 API
──────────────────────────────────────────────────────────── */
const labels = {
  // 읽기
  getCollected(){ return [...readLabelSet()]; },
  isCollected(lb){ return readLabelSet().has(lb); },

  // 쓰기
  add(lb){
    if(!isLabel(lb)) return;
    const s = readLabelSet();
    if(!s.has(lb)){
      s.add(lb); writeLabelSet(s);
      const ts = loadTimestamps();
      if(!ts[lb]){ ts[lb] = todayKST(); saveTimestamps(ts); }
    }
  },
  remove(lb){
    const s = readLabelSet();
    if(s.delete(lb)){ writeLabelSet(s); }
  },
  toggle(lb){
    if(!isLabel(lb)) return false;
    const s = readLabelSet();
    const existed = s.has(lb);
    if(existed) s.delete(lb); else s.add(lb);
    writeLabelSet(s);
    if(!existed){
      const ts = loadTimestamps(); if(!ts[lb]){ ts[lb] = todayKST(); saveTimestamps(ts); }
    }
    return !existed;
  },
  clear(){
    try{
      S.removeItem(LABEL_COLLECTED_KEY);
      window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
      emitSync(LABEL_SYNC_KEY, { type:"set", arr: [], t:Date.now() });
      scheduleServerSync();
    }catch{}
  },

  // 임시 -> 커밋
  addTemp(lb){
    if(!isLabel(lb)) return;
    const arr = readTempList();
    if(!arr.includes(lb)){ arr.push(lb); writeTempList(arr); }
  },
  clearTemp(){ writeTempList([]); },
  commitTemp(){
    const toAdd = readTempList().filter(isLabel);
    if(toAdd.length){
      const s = readLabelSet();
      let changed = false;
      const ts = loadTimestamps();
      const today = todayKST();
      toAdd.forEach(lb=>{
        if(!s.has(lb)){ s.add(lb); changed = true; if(!ts[lb]) ts[lb] = today; }
      });
      if(changed){ writeLabelSet(s); saveTimestamps(ts); }
    }
    writeTempList([]);
  },

  // 타임스탬프/하트
  setTimestamp(lb, date){
    if(!isLabel(lb)) return;
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const ts = loadTimestamps();
    ts[lb] = ok ? date : todayKST();
    saveTimestamps(ts);
  },
  // PATCH: replace labels.incrementHeart in the labels object
  incrementHeart(lb, step=1){
    if(!isLabel(lb)) return;
    const hearts = loadHearts();
    const inc = Number(step) || 1;
    hearts[lb] = (hearts[lb] ?? 0) + inc;
    saveHearts(hearts);
  },
  setHeart(lb, count){
    if(!isLabel(lb)) return;
    const hearts = loadHearts();
    hearts[lb] = Number(count) || 0;
    saveHearts(hearts);
  },
  getHeart(lb){
    const hearts = loadHearts();
    return hearts[lb] ?? 0;
  },

  // 갤러리
  getGallery(label){
    if(!isLabel(label)) return [];
    return [...loadGalleryMeta(label)];
  },

  async addToGalleryFromCanvas(canvas, label){
    if(!isLabel(label)) return null;

    const tryBlob = await new Promise(res=> canvas.toBlob(b=>res(b ?? null), "image/png", 1));
    async function canvasToBlob(canvas){
      if (tryBlob) return tryBlob;
      try{
        const dataURL = canvas.toDataURL("image/png");
        const res = await fetch(dataURL);
        return await res.blob();
      }catch(e){
        console.warn("[gallery] toDataURL failed (tainted?). Using empty PNG.", e);
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        const r = await new Promise(res => c.toBlob(b => res(b), "image/png"));
        return r;
      }
    }
    async function makeThumbDataURL(srcCanvas, maxEdge=480){
      const ratio = Math.min(1, maxEdge / Math.max(srcCanvas.width, srcCanvas.height));
      const w = Math.max(1, Math.round(srcCanvas.width  * ratio));
      const h = Math.max(1, Math.round(srcCanvas.height * ratio));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(srcCanvas, 0, 0, w, h);
      try {
        return c.toDataURL("image/png");
      } catch (e) {
        console.warn("[gallery] thumb toDataURL failed (tainted?). Using 1x1 fallback.", e);
        const fb = document.createElement("canvas");
        fb.width = 1; fb.height = 1;
        return fb.toDataURL("image/png");
      }
    }

    const genId = () => {
      if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
      return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
    };

    const blob = await canvasToBlob(canvas);
    const id = genId();

    try{ await idbPutBlob(id, blob); }catch{ console.warn("[gallery] persist blob failed; meta-only"); }

    const meta = {
      id, label, createdAt: Date.now(),
      width: canvas.width, height: canvas.height,
      thumbDataURL: await makeThumbDataURL(canvas, 480),
    };
    const next = [...loadGalleryMeta(label), meta];
    saveGalleryMeta(label, next);
    emitGalleryChanged({kind:"add", label, id});

    // 서버 업로드(옵션)
    if (SERVER_GALLERY_SYNC_ON && serverAuthed()){
      try{
        const fd = new FormData();
        fd.append("id", id);
        fd.append("label", label);
        fd.append("createdAt", String(meta.createdAt));
        fd.append("width", String(meta.width));
        fd.append("height", String(meta.height));
        fd.append("thumbDataURL", meta.thumbDataURL);
        fd.append("ns", USER_NS);
        fd.append("file", blob, `${id}.png`);
        const up = await apiFetch(SERVER_ENDPOINT_G_UPLOAD, { method: "POST", body: fd });
        if (!up || !up.ok) console.warn("[gallery] server upload failed");
      }catch(e){ console.warn("[gallery] server upload error", e); }
    }
    return id;
  },

  async getBlob(id, _label){
    // 로컬 IDB 우선
    try{
      const b = await idbGetBlob(id);
      if (b) return b;
    }catch{ console.warn("[gallery] getBlob local failed"); }

    // 서버에서 다운로드(옵션)
    if (SERVER_GALLERY_SYNC_ON && serverAuthed()){
      try{
        const res = await apiFetch(SERVER_ENDPOINT_G_BLOB(id), { method: "GET" });
        if (res && res.ok){
          const blob = await res.blob();
          try{ await idbPutBlob(id, blob); }catch{}
          return blob;
        }
      }catch{}
    }
    return null;
  },

  async removeFromGallery(id, label){
    if(!isLabel(label)) return;
    await idbDeleteBlob(id);
    const next = loadGalleryMeta(label).filter(m=>m.id!==id);
    saveGalleryMeta(label, next);
    emitGalleryChanged({kind:"remove", label, id});
    // 서버 삭제는 필요 시 추가 가능
  },

  async clearGallery(label){
    if(!label){
      await idbClearAll();
      ALL_LABELS.forEach(lb=>saveGalleryMeta(lb, []));
      ALL_LABELS.forEach(lb=>emitGalleryChanged({kind:"clear", label:lb}));
      return;
    }
    if(!isLabel(label)) return;
    saveGalleryMeta(label, []);
    emitGalleryChanged({kind:"clear", label});
  },

  // 선택 상태
  getSelected(){ return readSelectedLabel(); },
  setSelected(lbOrNull){
    if(lbOrNull!==null && !isLabel(lbOrNull)) return;
    writeSelectedLabel(lbOrNull || null);
  },

  // 과거 호환
  addRegistered(lb){ this.add(lb); },
  removeRegistered(lb){ this.remove(lb); },
  has(lb){ return this.isCollected(lb) || readTempList().includes(lb); },
};

/* 라벨: 등록 배열 게터(호환) */
Object.defineProperty(labels, "registered", { get(){ return labels.getCollected(); } });

/* 공식 게터(읽기 전용) */
labels.getTimestamps = function getTimestamps() { return { ...loadTimestamps() }; };
labels.getTimestamp  = function getTimestamp(label) {
  if (!isLabel(label)) return null;
  const map = loadTimestamps();
  return map[label] ?? null;
};
labels.getHearts = function getHearts() { return { ...loadHearts() }; };

/* ────────────────────────────────────────────────────────────
   지비츠(Jibbitz): 기존 구조 + 탭/서버 동기화
──────────────────────────────────────────────────────────── */

(function hydrateOnBoot(){
  // 1) 다른 탭이 남긴 마지막 스냅샷으로 세션 리하이드레이트
  try{
    const lastLabel = persistEnabled() ? lsGet(LABEL_SYNC_KEY) : null;
    if (lastLabel){
      const msg = safeParse(lastLabel, null);
      if (msg && msg.type === "set" && Array.isArray(msg.arr)){
        S.setItem(LABEL_COLLECTED_KEY, JSON.stringify(msg.arr.filter(isLabel)));
        window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
      }
      if (msg && msg.type === "select"){
        if (msg.label) S.setItem(LABEL_SELECTED_KEY, msg.label);
        else S.removeItem(LABEL_SELECTED_KEY);
        window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
      }
    }

    const lastJib = persistEnabled() ? lsGet(JIB_SYNC_KEY) : null;
    if (lastJib){
      const m = safeParse(lastJib, null);
      if (m && m.type === "set" && Array.isArray(m.arr)){
        S.setItem(JIB_COLLECTED_KEY, JSON.stringify(m.arr.filter(isJibKind)));
        window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
      }
      if (m && m.type === "select"){
        if (m.k) S.setItem(JIB_SELECTED_KEY, m.k);
        else S.removeItem(JIB_SELECTED_KEY);
        window.dispatchEvent(new Event(JIB_EVT));
      }
    }

    const lastHearts = persistEnabled() ? lsGet(HEARTS_SYNC_KEY) : null;
    if (lastHearts){
      const { map } = safeParse(lastHearts, {});
      if (map && typeof map === "object"){
        S.setItem(HEARTS_KEY, JSON.stringify(map));
        window.dispatchEvent(new Event("label:hearts-changed"));
      }
    }

    const lastLikes = persistEnabled() ? lsGet(LIKES_SYNC_KEY) : null;
    if (lastLikes){
      const { map } = safeParse(lastLikes, {});
      if (map && typeof map === "object"){
        S.setItem(LIKES_KEY, JSON.stringify(map));
        // window.dispatchEvent(new Event("itemLikes:changed"));
      }
    }

    const lastTs = persistEnabled() ? lsGet(TS_SYNC_KEY) : null;
    if (lastTs){
      const { map } = safeParse(lastTs, {});
      if (map && typeof map === "object"){
        S.setItem(TIMESTAMPS_KEY, JSON.stringify(map));
        window.dispatchEvent(new Event("label:timestamps-changed"));
      }
    }

    const lastVotes = persistEnabled() ? lsGet(LABEL_VOTES_SYNC_KEY) : null;
    if (lastVotes){
      const { map } = safeParse(lastVotes, {});
      if (map && typeof map === "object"){
        // SSOT에 기록 + 이벤트/브로드캐스트 (저장소 키는 NS별로 이미 설정됨)
        saveLabelVotes(map);
      }
    }

  }catch{}

  // 2) 서버에서 최신 상태 1회 당겨오기
  pullStateFromServerOnce();
})();

// 로컬 미러에서 세션으로 재하이드레이트(게이트 없이 강제 수행)
function rehydrateFromSnapshots(){
  try{
    // 라벨
    const lastLabel = localStorage.getItem(LABEL_SYNC_KEY);
    if (lastLabel){
      const msg = JSON.parse(lastLabel || "null");
      if (msg?.type === "set" && Array.isArray(msg.arr)){
        S.setItem(LABEL_COLLECTED_KEY, JSON.stringify(msg.arr.filter(isLabel)));
        window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
      }
      if (msg?.type === "select"){
        if (msg.label && isLabel(msg.label)) S.setItem(LABEL_SELECTED_KEY, msg.label);
        else S.removeItem(LABEL_SELECTED_KEY);
        window.dispatchEvent(new Event(LABEL_SELECTED_EVT));
      }
    }
    // 지비츠
    const lastJib = localStorage.getItem(JIB_SYNC_KEY);
    if (lastJib){
      const m = JSON.parse(lastJib || "null");
      if (m?.type === "set" && Array.isArray(m.arr)){
        S.setItem(JIB_COLLECTED_KEY, JSON.stringify(m.arr.filter(isJibKind)));
        window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
      }
      if (m?.type === "select"){
        if (m.k && isJibKind(m.k)) S.setItem(JIB_SELECTED_KEY, m.k);
        else S.removeItem(JIB_SELECTED_KEY);
        window.dispatchEvent(new Event(JIB_EVT));
      }
    }
    // 하트/타임스탬프
    const lastHearts = localStorage.getItem(HEARTS_SYNC_KEY);
    if (lastHearts){
      const { map } = JSON.parse(lastHearts || "{}");
      if (map && typeof map === "object"){
        S.setItem(HEARTS_KEY, JSON.stringify(map));
        window.dispatchEvent(new Event("label:hearts-changed"));
      }
    }
    const lastLikes = localStorage.getItem(LIKES_SYNC_KEY);
    if (lastLikes){
      const { map } = JSON.parse(lastLikes || "{}");
      if (map && typeof map === "object"){
        S.setItem(LIKES_KEY, JSON.stringify(map));
      }
    }
    const lastTs = localStorage.getItem(TS_SYNC_KEY);
    if (lastTs){
      const { map } = JSON.parse(lastTs || "{}");
      if (map && typeof map === "object"){
        S.setItem(TIMESTAMPS_KEY, JSON.stringify(map));
        window.dispatchEvent(new Event("label:timestamps-changed"));
      }
    }

    const lastVotes = persistEnabled() ? lsGet(LABEL_VOTES_SYNC_KEY) : null;
    if (lastVotes){
      const { map } = safeParse(lastVotes, {});
      if (map && typeof map === "object"){
        // SSOT에 기록 + 이벤트/브로드캐스트 (저장소 키는 NS별로 이미 설정됨)
        saveLabelVotes(map);
      }
    }

  }catch{}
}

// ── NS별 세션 키를 깨끗하게 비우는 헬퍼
function __clearSessionStateForNS(ns){
  const bases = [
    "collectedLabels","tempCollectedLabels","labelTimestamps","labelHearts",
    "aud:selectedLabel","jib:selected","jib:collected","sdf-session-init-v1",
    "itemLikes"
  ];
  for (const base of bases){
    try { sessionStorage.removeItem(`${base}:${ns}`); } catch {}
  }
}

// ── (선택) 인사이트 캐시도 정리
function __clearInsightsForNS(ns){
  try { sessionStorage.removeItem(`insights:${(ns||"default").toLowerCase()}`); } catch {}
}


// NS가 바뀌었을 때 한 번에 처리
function rebindNS(){
  // ★ 이전 NS를 먼저 저장
  const prev = (typeof USER_NS !== "undefined" ? USER_NS : "default");

  const next = (()=>{
    try { if (!(window.auth?.isAuthed?.())) return "default"; } catch { return "default"; }

    // 세션(탭) NS 우선
    try {
      const ss = sessionStorage.getItem(SESSION_USER_NS_KEY);
      if (ss && ss.trim()) return ss.trim().toLowerCase();
    } catch {}

    // 폴백: 전역 NS
    try {
      return (localStorage.getItem("auth:userns") || "default").toLowerCase();
    } catch { return "default"; }
  })();

  if (next === USER_NS) return;

  // ★ 이전 NS 세션 흔적 제거
  try { __clearSessionStateForNS(prev); __clearInsightsForNS(prev); } catch {}

  USER_NS = next;
  window.__STORE_NS = USER_NS;
  recalcKeys();

  try { bc?.close?.(); } catch {}
  BC_NAME = `aud:sync:${USER_NS}`;
  bc = openBC(BC_NAME);

  // ★ 새 NS 기준으로 로컬 미러 → 세션 재하이드레이트
  rehydrateFromSnapshots();

  // ★ 서버 상태 강제 pull
  pulledOnceFromServer = false;
  pullStateFromServerOnce();
}

// 로그인/로그아웃 상태 변화, 또는 다른 탭에서 userns가 바뀐 경우
window.addEventListener("auth:state", () => rebindNS());
window.addEventListener("storage", (e)=>{
  if (e?.key === "auth:userns" || e?.key === "auth:flag") rebindNS();
});
window.addEventListener("logo-guard:ready", () => window.__storeAuthRefresh?.());


/* 지비츠: 내부 유틸 */
function readJibCollectedSet(){
  try {
    const raw = S.getItem(JIB_COLLECTED_KEY);        // ← NS 평면에서만 읽기
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(arr.filter(isJibKind));
  } catch { 
    return new Set();
  }
}

function writeJibCollectedSet(s){
  try{
    const arr = [...s];
    S.setItem(JIB_COLLECTED_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
    emitSync(JIB_SYNC_KEY, { type:"set", arr, t:Date.now() });
    scheduleServerSync();
  }catch{}
}
function readJibSelected(){
  try{
    const raw = S.getItem(JIB_SELECTED_KEY);
    return raw && isJibKind(raw) ? raw : null;
  }catch{ return null; }
}
// PATCH: replace the whole writeJibSelected function
function writeJibSelected(k){
  try{
    if (k && !isJibKind(k)) return;
    if (k) S.setItem(JIB_SELECTED_KEY, k);
    else S.removeItem(JIB_SELECTED_KEY);
    window.dispatchEvent(new Event(JIB_EVT));
    // cross-tab sync (select event)
    emitSync(JIB_SYNC_KEY, { type: "select", k: k ?? null, t: Date.now() });
    scheduleServerSync();
  } catch {}
}

const jib = {
  getSelected(){ return readJibSelected(); },
  setSelected(kind){
    if(kind!==null && !isJibKind(kind)) return;
    writeJibSelected(kind || null);
  },
  getCollected(){ return [...readJibCollectedSet()]; },
  isCollected(kind){ return readJibCollectedSet().has(kind); },
  toggle(kind){
    if(!isJibKind(kind)) return false;
    const s = readJibCollectedSet();
    if(s.has(kind)) s.delete(kind); else s.add(kind);
    writeJibCollectedSet(s);
    return s.has(kind);
  },
  add(kind){
    if(!isJibKind(kind)) return;
    const s = readJibCollectedSet();
    if(!s.has(kind)){ s.add(kind); writeJibCollectedSet(s); }
  },
  remove(kind){
    const s = readJibCollectedSet();
    if(s.delete(kind)) writeJibCollectedSet(s);
  },
  clear(){
    try{
      S.removeItem(JIB_COLLECTED_KEY);
      window.dispatchEvent(new Event(JIB_COLLECTED_EVT));
      emitSync(JIB_SYNC_KEY, { type:"set", arr: [], t:Date.now() });
      scheduleServerSync();
    }catch{}
  },
};

/* ────────────────────────────────────────────────────────────
   전역 바인딩
──────────────────────────────────────────────────────────── */
window.store = labels;
window.jib   = jib;

try { window.dispatchEvent(new Event("store:ready")); } catch {}

/* Archive-스타일 호환 API (선택 사용). 기존 정의(window.store, window.jib)는 그대로 유지됨. */
(function exposeArchiveStyleAPI(){
  if (window.Store) return; // 이미 있으면 존중
  function getState(){
    try {
      const collected = [...readLabelSet()];
      const selected  = readSelectedLabel();
      const hearts    = readHeartsMap();
      const ts        = loadTimestamps();
      const jsel      = readJibSelected();
      const jcol      = [...readJibCollectedSet()];
      return { labels: collected, selected, hearts, ts, jibs: { selected: jsel, collected: jcol } };
    } catch { return { labels: [], selected: null, hearts: {}, ts: {}, jibs: { selected: null, collected: [] } }; }
  }
  window.Store = {
    // Core
    getNS: () => (typeof USER_NS !== "undefined" ? USER_NS : "default"),
    isAuthed: () => { try { return !!(window.auth?.isAuthed?.() || sessionAuthed()); } catch { return false; } },
    getState,
    snapshot: () => JSON.stringify(getState()),
    // 라벨
    collectLabel: (name, count=1) => { for (let i=0;i<(count|0);i++) labels.add(name); },
    uncollectLabel: (name) => labels.remove(name),
    toggleLabel: (name) => labels.toggle(name),
    setSelected: (name) => labels.setSelected(name),
    getSelected: () => labels.getSelected(),
    // 하트
    setHearts: (label, n) => labels.setHeart(label, n),
    incrementHeart: (label, step=1) => labels.incrementHeart(label, step),
    stampKST: (label) => labels.setTimestamp(label, todayKST()),
    getTimestamp: (label) => labels.getTimestamp(label),
    // 지비츠
    collectJib: (kind) => { if (!jib.isCollected(kind)) jib.toggle(kind); },
    toggleJib: (kind) => jib.toggle(kind),
    // No-ops to match Archive API surface
    setSyncOptions: () => {},
    list: () => getState().labels,
    remove: (name) => labels.remove(name),
    migrateLegacy: () => {}
  };
})();


window.ALL_LABELS          = ALL_LABELS;
window.ALL_JIBS            = ALL_JIBS;
window.GALLERY_EVENT       = GALLERY_EVENT;

window.LABEL_COLLECTED_EVT = LABEL_COLLECTED_EVT;
window.LABEL_SELECTED_EVT  = LABEL_SELECTED_EVT;
window.LABEL_SYNC_KEY      = LABEL_SYNC_KEY;
window.JIB_SYNC_KEY        = JIB_SYNC_KEY;

window.JIB_SELECTED_KEY    = JIB_SELECTED_KEY;
window.JIB_COLLECTED_KEY   = JIB_COLLECTED_KEY;
window.JIB_EVT             = JIB_EVT;
window.JIB_COLLECTED_EVT   = JIB_COLLECTED_EVT;

/* 디버그/운영 플래그 노출 */
window.__STORE_NS = USER_NS;
window.__SERVER_SYNC_ON = SERVER_SYNC_ON;
window.__SERVER_GALLERY_SYNC_ON = SERVER_GALLERY_SYNC_ON;

// === store.js tail (merge auth-actions) ===
(() => {
  "use strict";
  if (window.__authActionsInstalled) return;
  window.__authActionsInstalled = true;

  if (!window.__flushStoreSnapshot) {
    window.__flushStoreSnapshot = async () => {};
  }

  let __logoutBeaconSent = false;
  function sendLogoutBeaconOnce() {
    if (__logoutBeaconSent) return;
    __logoutBeaconSent = true;
    try {
      const blob = new Blob([JSON.stringify({})], { type: "application/json" });
      const target = (window.API_ORIGIN)
        ? new URL("/auth/logout-beacon", window.API_ORIGIN).toString()
        : "/auth/logout-beacon";
      navigator.sendBeacon(target, blob);
    } catch {
      const target = (window.API_ORIGIN)
        ? new URL("/auth/logout-beacon", window.API_ORIGIN).toString()
        : "/auth/logout-beacon";
      fetch(target, { method: "POST", keepalive: true, credentials: "include" });
    }
  }

  async function performLogout() {
    try { await window.__flushStoreSnapshot({ server: true }); } catch {}
    sendLogoutBeaconOnce();

    // ★ auth 관련 흔적을 세션/로컬 모두 제거
    try { sessionStorage.removeItem("auth:flag"); } catch {}
    try { localStorage.removeItem("auth:flag"); } catch {}
    try { localStorage.removeItem("auth:userns"); } catch {}

    // ★ 게스트 초기화를 다시 걸 수 있도록 세션 플래그/인사이트 제거
    try { sessionStorage.removeItem(`sdf-session-init-v1:default`); } catch {}
    try {
      const ns = (window.__STORE_NS || "default");
      __clearSessionStateForNS(ns);
      __clearInsightsForNS(ns);
    } catch {}

    // 상태 브로드캐스트
    window.dispatchEvent(new CustomEvent("auth:state", { detail: { ready: true, authed: false } }));

    // 페이지 이동
    location.href = "./login.html#loggedout";
  }

  // 전역에 노출
  window.performLogout = performLogout;

  // 이벤트 위임(버튼이 나중에 생겨도 동작)
  document.addEventListener("click", (e) => {
    const t = e.target && (e.target.closest?.('[data-action="logout"]'));
    if (!t) return;
    e.preventDefault();
    performLogout();
  });

  // [선택] 탭/창 닫힘 자동 로그아웃
  const AUTO_LOGOUT_ON_CLOSE = false;
  if (AUTO_LOGOUT_ON_CLOSE) {
    window.addEventListener("pagehide", sendLogoutBeaconOnce);
  }
})();
