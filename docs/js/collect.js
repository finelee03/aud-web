// ================== collect.js (BLE UID 분류 + store.js 연동 안정판) ==================
(() => {
  "use strict";

  /* ─────────────────────────────
   *  Config / Shims / Globals
   * ───────────────────────────── */
  const DEBUG = false;

  // 레거시 호환 이벤트(다른 페이지 리스너 보호)
  const EVT_LEGACY_SELECTED = "aud:selectedLabel-changed";

  // 로컬 UID↔라벨 매핑 저장 키
  const NFC_MAP_KEY = "aud:nfcMap";

  // UI 필수 요소
  const recBtn     = document.getElementById("recBtn");
  const canvas     = document.getElementById("waveCanvas");
  const resultLink = document.getElementById("resultLink");
  const resultBtn  = document.getElementById("resultBtn");
  const resultNone = document.getElementById("resultNone");
  if (!recBtn) return;

  // store.js 안전 접근 (지연 부팅/없음 대비)
  function safeStore() {
    const s = window.store;
    return s && typeof s.setSelected === "function"
             && typeof s.addTemp === "function"
             && typeof s.getSelected === "function" ? s : null;
  }
  function onStoreReady(cb) {
    const s = safeStore();
    if (s) return cb(s);
    window.addEventListener("store:ready", () => {
      const ss = safeStore();
      if (ss) cb(ss);
    }, { once: true });
  }

  // 소켓 접근 보조
  function withSock(cb) {
    if (window.sock) return cb(window.sock);
    window.addEventListener("sock:ready", () => cb(window.sock), { once: true });
  }

  /* ─────────────────────────────
   *  State (UI/Audio/BLE/NFC)
   * ───────────────────────────── */
  let isRecording = false, hasSubmitted = false, lastResult = null;
  let audioCtx = null, analyser = null, dataArr = null, source = null, stream = null, rafId = null;

  // 최근 수신 UID/라벨 캐시
  let lastSeen = { uid: null, label: null, ts: 0 };

  // "녹음→제출" 흐름에서 대기 중인 임시 값
  let pendingUid = null;
  let pendingLabel = null;

  /* ─────────────────────────────
   *  UID ↔ Label 매핑 (로컬 저장소)
   * ───────────────────────────── */
  function loadNfcMap(){
    try { const raw = localStorage.getItem(NFC_MAP_KEY); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  }
  function saveNfcMap(map){
    try { localStorage.setItem(NFC_MAP_KEY, JSON.stringify(map)); } catch {}
  }
  function normalizeUid(uid){ return String(uid || "").trim().toUpperCase(); }
  function labelFromUid(uid){
    const key = normalizeUid(uid);
    if (!key) return null;
    const map = loadNfcMap();
    return map[key] || null;
  }
  // 초기 예시 매핑이 있었다면 보존/주입(필요 시 사용자 입맛대로 수정)
  (function ensureSeedMap(){
    const map = loadNfcMap();
    const K1 = normalizeUid("045D830A751D90");
    const K2 = normalizeUid("044A840A751D90");
    const K3 = normalizeUid("0429830A751D90");
    const K4 = normalizeUid("0448830A751D90");
    const K5 = normalizeUid("04A0350A751D90");
    const K6 = normalizeUid("0408840A751D90");
    if (!map[K1]) map[K1] = "whee";
    if (!map[K2]) map[K2] = "thump";
    if (!map[K3]) map[K3] = "miro";
    if (!map[K4]) map[K4] = "echo";
    if (!map[K5]) map[K5] = "track";
    if (!map[K6]) map[K6] = "portal";
    saveNfcMap(map);
  })();

  /* ─────────────────────────────
   *  BLE Manufacturer Data 파서
   *   - Arduino 코드에서 setManufacturerData("UID:...") 형식 전송
   *   - 게이트웨이/서버가 다양한 형태로 포워딩할 수 있어 다형 파싱
   * ───────────────────────────── */
  function parseAdvToUID(evt) {
    // 가능한 입력 케이스를 호의적으로 처리
    // 1) evt.mfg: 문자열 "UID:XXXXXXXX" 또는 "IDLE"
    // 2) evt.manufacturerData / evt.payload: 문자열/바이트열/베이스64
    // 3) evt.raw / evt.bytes: Uint8Array
    // 4) evt.fields?.manufacturerData: {companyId, data(Buffer|array|b64|string)}
    // 5) evt.name 은 사용하지 않음(ESP32-RFID 고정값일 가능성 높음)

    const tryString = (s) => {
      if (!s) return null;
      const str = String(s);
      // 포함형도 케어(게이트웨이가 전처리 덧붙인 경우)
      const idx = str.indexOf("UID:");
      if (idx >= 0) {
        const hex = str.slice(idx + 4).trim();
        return hex ? hex : null;
      }
      // "IDLE"일 경우 null 반환
      if (str.includes("IDLE")) return null;
      return null;
    };

    const tryBytes = (buf) => {
      if (!buf) return null;
      let bytes = null;
      if (buf instanceof Uint8Array) bytes = buf;
      else if (Array.isArray(buf))   bytes = Uint8Array.from(buf);
      if (!bytes) return null;
      // 구조: [CompanyID_LE(2), 'U','I','D',':', '4','5','...']
      // → 'UID:' 시그니처 찾기
      const sig = [0x55, 0x49, 0x44, 0x3A]; // 'U','I','D',':'
      for (let i = 0; i <= bytes.length - sig.length; i++) {
        if (bytes[i]===sig[0] && bytes[i+1]===sig[1] && bytes[i+2]===sig[2] && bytes[i+3]===sig[3]) {
          const tail = bytes.slice(i + sig.length);
          // ASCII HEX 로 가정
          let out = "";
          for (let k = 0; k < tail.length; k++) {
            const c = tail[k];
            if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46)) out += String.fromCharCode(c);
            else break; // 비 HEX 만나면 종료
          }
          return out || null;
        }
      }
      // 'IDLE' 문자열 대응
      const idleSig = [0x49,0x44,0x4C,0x45]; // 'I','D','L','E'
      for (let i = 0; i <= bytes.length - idleSig.length; i++) {
        if (bytes[i]===idleSig[0] && bytes[i+1]===idleSig[1] && bytes[i+2]===idleSig[2] && bytes[i+3]===idleSig[3]) {
          return null;
        }
      }
      return null;
    };

    // 1) 흔한 키 이름부터 시도
    const candidates = [
      evt?.mfg, evt?.manufacturerData, evt?.payload, evt?.raw, evt?.bytes,
      evt?.fields?.manufacturerData?.data, evt?.fields?.mfg?.data
    ];

    // 문자열 후보 먼저
    for (const c of candidates) {
      if (typeof c === "string") {
        const v = tryString(c);
        if (v) return v;
      }
    }
    // 바이트/배열 후보
    for (const c of candidates) {
      const v = tryBytes(c);
      if (v) return v;
    }

    // 일부 게이트웨이는 { companyId, hex: "UID:...." } 처럼 줄 수 있음
    if (evt?.fields?.manufacturerData?.hex) {
      const v = tryString(evt.fields.manufacturerData.hex);
      if (v) return v;
    }

    // 최후: evt.text / evt.note 같은 필드가 있다면 검사
    if (evt?.text)  { const v = tryString(evt.text);  if (v) return v; }
    if (evt?.note)  { const v = tryString(evt.note);  if (v) return v; }

    return null;
  }

  /* ─────────────────────────────
   *  BLE/Beacon 이벤트 구독
   *   - 서버가 "ble" 또는 "beacon" 채널로 중계해도 잡아냄
   *   - 기존 "nfc" 채널도 유지
   * ───────────────────────────── */
  const RATE_WINDOW_MS = 5000;
  const DEBOUNCE_MS    = 600;

  function handleUID(uidFromEvt, labelHint){
    const now = Date.now();
    if (!uidFromEvt && !labelHint) return;

    // 중복 스팸 방지: 같은 UID를 너무 자주 처리하지 않기
    if (uidFromEvt && lastSeen.uid === uidFromEvt && (now - lastSeen.ts) < (RATE_WINDOW_MS / 2)) {
      log("skip duplicate within window:", uidFromEvt);
      return;
    }

    const uid   = uidFromEvt || lastSeen.uid;
    const label = labelHint || labelFromUid(uid);
    lastSeen = { uid, label, ts: now };
    pendingUid = uid;
    pendingLabel = label || null;

    log("handleUID:", { uid, label });

    // UI 힌트 신호
    try { window.dispatchEvent(new Event("pending:uid")); } catch {}
  }

  withSock((sock)=>{
    if (!sock) return;

    let lastAnyTs = 0;

    // 1) 새로 추가: 'ble' 채널(권장)
    sock.on("ble", (evt) => {
      const now = Date.now();
      if (now - lastAnyTs < DEBOUNCE_MS) return;
      lastAnyTs = now;

      const uid = parseAdvToUID(evt);
      if (uid) {
        handleUID(uid, null);
      } else {
        // IDLE이거나 UID 없음 → 무시
        log("ble(no UID):", evt);
      }
    });

    // 2) 일부 게이트웨이는 'beacon' 채널을 씀
    sock.on("beacon", (evt) => {
      const now = Date.now();
      if (now - lastAnyTs < DEBOUNCE_MS) return;
      lastAnyTs = now;
      const uid = parseAdvToUID(evt);
      if (uid) handleUID(uid, null);
    });

    // 3) 기존 'nfc' 채널(이미 사용 중일 가능성)
    sock.on("nfc", (evt) => {
      const now = Date.now();
      if (now - lastAnyTs < DEBOUNCE_MS) return;
      lastAnyTs = now;

      const uid = String(evt?.id || evt?.uid || "");
      const label = typeof evt?.label === "string" ? evt.label : null;
      if (!uid && !label) return;
      handleUID(uid || null, label || null);
    });
  });

  /* ─────────────────────────────
   *  Canvas (Waveform)
   * ───────────────────────────── */
  function setupCanvas(){
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = 400, cssH = 70;
    canvas.style.width  = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width  = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(){
    if(!analyser || !dataArr || !canvas) return;
    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    analyser.getByteTimeDomainData(dataArr);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath(); ctx.lineWidth=2; ctx.strokeStyle="#FF884D";
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const len=dataArr.length; const slice=(canvas.width/dpr)/len;
    let x=0;
    for(let i=0;i<len;i++){
      const v=dataArr[i]/128.0;
      const y=(v*(canvas.height/dpr))/2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      x+=slice;
    }
    ctx.lineTo(canvas.width,canvas.height/2); ctx.stroke();
    rafId = requestAnimationFrame(draw);
  }
  function cleanupAudio(){
    if(rafId) cancelAnimationFrame(rafId);
    rafId=null;
    try{ stream?.getTracks().forEach(t=>t.stop()); }catch{}
    try{ audioCtx?.close(); }catch{}
    stream=null; audioCtx=null; analyser=null; dataArr=null; source=null;
  }

  function setButtonVisual(rec){
    if(rec){
      if(recBtn.classList.contains("btn-record")) recBtn.classList.replace("btn-record","btn-submit");
      recBtn.textContent="Submit";
    }else{
      if(recBtn.classList.contains("btn-submit")) recBtn.classList.replace("btn-submit","btn-record");
      recBtn.textContent="Record";
    }
  }

  /* ─────────────────────────────
   *  결과 렌더
   * ───────────────────────────── */
  function renderResult(){
    if(!resultLink || !resultBtn || !resultNone){ return; }

    if(!hasSubmitted){ resultLink.hidden=true; resultNone.hidden=true; return; }

    if(lastResult){
      resultBtn.textContent = lastResult.label;
      resultLink.href = lastResult.route || "#";
      resultLink.hidden=false; resultNone.hidden=true;
      resultBtn.onclick = () => { if (lastResult?.route) location.href = lastResult.route; };
    }else{
      resultLink.hidden=true; resultNone.hidden=false;
    }
  }
  window.renderResult = renderResult;

  /* ─────────────────────────────
   *  녹음 → 제출 플로우
   *   - 제출 시점에 가장 최근/대기 중 UID를 채택
   *   - UID→라벨 매핑 후 store에 위임
   * ───────────────────────────── */
  async function startRecording(){
    setButtonVisual(true); setupCanvas();
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize=2048; dataArr=new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);

      pendingUid=null; pendingLabel=null;
      hasSubmitted=false; lastResult=null; renderResult(); draw();
      isRecording=true;
    }catch{
      cleanupAudio(); setButtonVisual(false);
      isRecording=false;
    }
  }

  async function stopRecording(){
    cleanupAudio();

    // 최근 BLE/NFC 수신 또는 대기 중 값 우선
    const now = Date.now();
    const RECENT_MS = 8000;
    let uid = null;
    if (pendingUid && (now - (lastSeen.ts||0) <= RECENT_MS)) uid = pendingUid;
    else if (lastSeen.uid && (now - (lastSeen.ts||0) <= RECENT_MS)) uid = lastSeen.uid;

    const label = pendingLabel || lastSeen.label || labelFromUid(uid);
    log("Submit resolved →", { uid, label });

    if (label) {
      try { safeStore()?.addTemp(label); } catch {}
      onStoreReady((st) => {
        try { st.setSelected(label); } catch {}
        try { window.dispatchEvent(new Event(EVT_LEGACY_SELECTED)); } catch {}
      });

      lastResult = { label, route: `./add.html?label=${encodeURIComponent(label)}` };
      window.selectedLabel = label;  // 레거시 호환
    } else {
      lastResult = null;
      window.selectedLabel = null;
    }

    hasSubmitted = true;
    isRecording = false;
    setButtonVisual(false);
    renderResult();

    pendingUid=null; pendingLabel=null;
  }

  recBtn.addEventListener("click", ()=>{ isRecording?stopRecording():startRecording(); });

  /* ─────────────────────────────
   *  How-it-works Carousel / Hero (원본 유지)
   * ───────────────────────────── */
  (function () {
    const carousel = document.querySelector('.how-carousel');
    const track = document.getElementById('howTrack');
    const dots = Array.from(document.querySelectorAll('#howDots .how-dot'));
    if (!carousel || !track || dots.length === 0) return;

    const originals = Array.from(track.children);
    const N = originals.length;
    const firstClone = originals[0].cloneNode(true);
    const lastClone  = originals[N - 1].cloneNode(true);
    firstClone.dataset.clone = 'first';
    lastClone.dataset.clone  = 'last';
    track.insertBefore(lastClone, track.firstChild);
    track.appendChild(firstClone);

    let index = 1;
    let timer = null;
    let isAnimating = false;
    let cellW = 0;
    const DURATION = 600;
    const EASE = 'ease-in-out';
    const INTERVAL = 2000;

    function measure() {
      cellW = Math.min(400, carousel.clientWidth || 400);
      Array.from(track.children).forEach(el => {
        el.style.flex = '0 0 100%';
        el.style.width = '100%';
      });
      applyTransform(true);
    }
    function applyTransform(noTransition = false) {
      track.style.transition = noTransition ? 'none' : `transform ${DURATION}ms ${EASE}`;
      track.style.transform  = `translateX(${-index * cellW}px)`;
      const real = realIndex();
      dots.forEach((d, k) => d.classList.toggle('is-active', k === real));
    }
    function realIndex() {
      if (index <= 0)   return N - 1;
      if (index >= N+1) return 0;
      return index - 1;
    }
    function go(to){ if(!isAnimating){ isAnimating=true; index=to; applyTransform(false);} }
    function start(){ if(!timer) timer=setInterval(()=>go(index+1), INTERVAL); }
    function stop(){ if(timer){ clearInterval(timer); timer=null; } }

    track.addEventListener('transitionend', () => {
      isAnimating=false;
      if (index === N+1){ index=1; applyTransform(true); }
      else if (index===0){ index=N; applyTransform(true); }
    });
    dots.forEach((dot,i)=>{ dot.addEventListener('click', ()=>{ stop(); if(i+1!==index) go(i+1); start(); }); });

    measure(); requestAnimationFrame(()=>applyTransform(true)); start();
    let rid=null; window.addEventListener('resize', ()=>{ cancelAnimationFrame(rid); rid=requestAnimationFrame(measure); });
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', stop);
  })();

  (function () {
    function onReady(fn){
      if(document.readyState==="loading"){
        document.addEventListener("DOMContentLoaded", fn, { once:true });
      } else { fn(); }
    }
    onReady(function () {
      const hero = document.querySelector(".collect .hero");
      if (!hero) return;
      requestAnimationFrame(()=>{ setTimeout(()=>hero.classList.add("is-in"), 0); });
    });
  })();

  /* ─────────────────────────────
   *  공통 정리
   * ───────────────────────────── */
  window.addEventListener("pagehide", cleanupAudio, { capture: true });
  window.addEventListener("beforeunload", cleanupAudio, { capture: true });
  setButtonVisual(false);
  renderResult();

  /* ─────────────────────────────
   *  콘솔 디버그 헬퍼 (필요 시 사용)
   *  - window.collectDebug.enable()
   *  - window.collectDebug.testUID("045D83...")
   * ───────────────────────────── */
  window.collectDebug = {
    enable(){ (window.__COLLECT_DEBUG__ = true); },
    testUID(uid, label=null){ handleUID(uid, label); },
    set mapEntry([uid,label]){
      const map = loadNfcMap(); map[normalizeUid(uid)] = label; saveNfcMap(map);
    },
    get map(){ return loadNfcMap(); }
  };

})();

// [HOTFIX A] wiretap: 모든 소켓 이벤트/메시지 로깅
(function wiretap(){

  if (window.sock) {
    // Socket.IO ?
    if (typeof window.sock.onAny === "function") {
      window.sock.onAny((event, ...args) => {
        log("onAny:", event, ...args.slice(0,1));
        // 들어오는 페이로드를 전부 파서에 태워 UID를 시도 추출 (자동 분류)
        try { args.forEach((x)=> window.__tryParseUIDFromAny?.(x)); } catch {}
      });
    }
    // WebSocket ?
    if ("onmessage" in window.sock) {
      const orig = window.sock.onmessage;
      window.sock.onmessage = (ev) => {
        log("ws:onmessage", ev?.data?.slice?.(0,200) || ev?.data);
        try {
          const data = (() => {
            try { return JSON.parse(ev.data); } catch { return ev.data; }
          })();
          window.__tryParseUIDFromAny?.(data);
        } catch {}
        if (orig) return orig.call(window.sock, ev);
      };
    }
  } else {
    window.addEventListener("sock:ready", wiretap, { once:true });
  }
})();
