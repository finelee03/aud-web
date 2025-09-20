// labelmine.js — openCropModal (button/slider zoom enabled, gestures disabled)
function openCropModal({ blob, w, h }) {
  return new Promise((resolve, reject) => {
    document.body.classList.add("is-cropping");

    const url = URL.createObjectURL(blob);

    // Backdrop & shell
    const back  = document.createElement("div");
    back.className = "cmodal-backdrop imodal-backdrop";

    const shell = document.createElement("div");
    shell.className = "cmodal imodal";

    // Header
    const head  = document.createElement("div");
    head.className = "cm-head";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "cm-back";
    backBtn.innerHTML = '<span class="feed-ico-back"></span>';

    const title = document.createElement("div");
    title.className = "cm-title";
    title.textContent = "Crop";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "cm-next";
    nextBtn.textContent = "Next";

    head.append(backBtn, title, nextBtn);

    // Body / Stage
    const body  = document.createElement("div");
    body.className = "cm-body";
    const stage = document.createElement("div");
    stage.className = "cm-stage";

    // Canvas (alpha:true for transparent export)
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: true });
    const overlay = document.createElement("div");
    overlay.className = "crop-overlay";
    stage.append(canvas, overlay);
    body.append(stage);

    // Tools (inside STAGE → appear over the image box)
    const tools = document.createElement("div");
    tools.className = "crop-tools";

    // [1] Aspect Ratio
    const ratioBtn = document.createElement("button");
    ratioBtn.type = "button";
    ratioBtn.className = "crop-btn";
    ratioBtn.setAttribute("aria-label", "Aspect ratio");
    ratioBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="7" width="16" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
        <path d="M8 7v-2M16 17v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

    const ratioMenu = document.createElement("div");
    ratioMenu.className = "crop-menu";
    ratioMenu.innerHTML = `
      <button type="button" data-ar="1:1">1:1</button>
      <button type="button" data-ar="1:2">1:2</button>`;

    // [2] Zoom — ENABLED via slider; gestures are blocked below
    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "crop-btn";
    zoomBtn.setAttribute("aria-label", "Zoom");
    zoomBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
        <path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M11 8v6M8 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

    const zoomWrap = document.createElement("div");
    zoomWrap.className = "crop-zoom";
    const zoomInput = document.createElement("input");
    zoomInput.type = "range";
    zoomInput.min = "0.5"; zoomInput.max = "4"; zoomInput.step = "0.01"; zoomInput.value = "1";
    zoomWrap.append(zoomInput);

    tools.append(ratioBtn, ratioMenu, zoomBtn, zoomWrap);

    const globalClose = document.createElement("button");
    globalClose.className = "im-head-close";
    globalClose.type = "button";
    globalClose.setAttribute("aria-label","닫기");
    globalClose.innerHTML = '<span class="im-x"></span>';

    shell.append(head, body);
    // tools를 stage 내부에 붙인다 → 이미지 상단에 뜸
    stage.appendChild(tools);
    back.append(shell, globalClose);
    document.body.append(back);

    const img = new Image();
    img.src = url;

    // State
    let ar = "1:1";
    let tx = 0, ty = 0;
    let isPanning = false, panStart = {x:0, y:0}, startTX = 0, startTY = 0;
    let viewW = 0, viewH = 0;
    let frame = null;
    let zoom = 1;

    if ("decode" in img) {
      img.decode().then(init).catch(() => { img.onload = init; });
    } else {
      img.onload = init;
    }

    function init() {
      const rect = stage.getBoundingClientRect();
      viewW = Math.max(1, Math.floor(rect.width));
      viewH = Math.max(1, Math.floor(rect.height));
      canvas.width = viewW;
      canvas.height = viewH;

      frame = document.createElement("div");
      frame.className = "crop-frame";
      stage.appendChild(frame);

      applyAspect(ar);
      centerImage();
      draw();
      bindEvents();
    }

    function draw() {
      ctx.clearRect(0,0,viewW,viewH);

      const {fx, fy, fw, fh} = frameRect();

      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();

      const iw = img.naturalWidth, ih = img.naturalHeight;
      const drawW = iw * zoom;
      const drawH = ih * zoom;
      const dx = Math.round(fx + tx - drawW/2 + fw/2);
      const dy = Math.round(fy + ty - drawH/2 + fh/2);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();
    }

    function frameRect(){
      const r = parseAspect(ar);
      let fw = viewW, fh = Math.round(fw * r.h / r.w);
      if (fh > viewH) { fh = viewH; fw = Math.round(fh * r.w / r.h); }
      const fx = Math.round((viewW - fw) / 2);
      const fy = Math.round((viewH - fh) / 2);

      if (frame) {
        frame.style.left = `${fx}px`;
        frame.style.top  = `${fy}px`;
        frame.style.width = `${fw}px`;
        frame.style.height= `${fh}px`;
      }
      return { fx, fy, fw, fh };
    }

    function parseAspect(s){
      const [a,b] = s.split(":").map(n => Math.max(1, parseInt(n,10)||1));
      return { w:a, h:b };
    }

    function applyAspect(next){
      ar = next;
      const {fw, fh} = frameRect();
      const zx = fw / img.naturalWidth;
      const zy = fh / img.naturalHeight;
      zoom = Math.max(zx, zy);               // cover frame by default
      centerImage();
      draw();
      // sync slider
      zoomInput.value = String(Math.max(0.5, Math.min(4, zoom)));
    }

    function centerImage(){ tx = 0; ty = 0; }

    function bindEvents(){
      // ---- Disable wheel/trackpad/pinch zoom (gestures) ----
      const stopAll = (e)=>{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      ['wheel','gesturestart','gesturechange','gestureend','touchmove'].forEach(t=>{
        stage.addEventListener(t, stopAll, { passive:false, capture:true });
      });

      // ---- Panning (kept) ----
      canvas.addEventListener("pointerdown", (e)=>{
        isPanning = true; canvas.setPointerCapture(e.pointerId);
        panStart = { x: e.clientX, y: e.clientY };
        startTX = tx; startTY = ty;
        overlay.classList.add("is-active");
      });
      const move = (e)=>{
        if (!isPanning) return;
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        tx = startTX + dx;
        ty = startTY + dy;
        draw();
      };
      const up = ()=>{
        if (!isPanning) return;
        isPanning = false;
        overlay.classList.remove("is-active");
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("lostpointercapture", up);

      // ---- Zoom UI (button + slider) ----
      zoomBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        // Toggle slider; absolute UI so it never changes stage/canvas size
        zoomWrap.style.display = zoomWrap.style.display === "block" ? "none" : "block";
        // Defensive: ensure a draw after UI toggle (in case of style/layout flush)
        requestAnimationFrame(draw);
      });
      zoomInput.addEventListener("input", ()=>{
        const target = Math.max(0.5, Math.min(4, parseFloat(zoomInput.value)||1));
        setZoomAroundCenter(target);
      });

      // ---- Aspect ratio UI ----
      ratioBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        ratioMenu.style.display = ratioMenu.style.display === "block" ? "none" : "block";
        requestAnimationFrame(draw);
      });
      ratioMenu.querySelectorAll("button").forEach(b=>{
        b.addEventListener("click",()=>{
          applyAspect(b.dataset.ar);
          ratioMenu.style.display = "none";
        });
      });
      back.addEventListener("click", (e)=>{
        if (!tools.contains(e.target)) { ratioMenu.style.display = "none"; zoomWrap.style.display = "none"; }
      });

      // Keep canvas size in sync
      const ro = new ResizeObserver(()=>{
        const rect = stage.getBoundingClientRect();
        viewW = Math.max(1, Math.floor(rect.width));
        viewH = Math.max(1, Math.floor(rect.height));
        canvas.width = viewW; canvas.height = viewH;
        frameRect(); draw();
      });
      ro.observe(stage);

      // Navigation
      backBtn.addEventListener("click", async ()=>{
        cleanup();
        try {
          const picked = await openGalleryPicker();
          const again  = await openCropModal(picked);
          resolve(again);
        } catch { reject(new Error("cancel")); }
      });

      nextBtn.addEventListener("click", async ()=>{
        nextBtn.disabled = true;
        title.textContent = "New post";
        const out = await exportCroppedCanvas();
        cleanup();
        resolve(out);
      });

      globalClose.addEventListener("click", ()=>{ cleanup(); reject(new Error("cancel")); });
    }

    function setZoomAroundCenter(targetZoom){
      const before = zoom;
      const next = Math.max(0.5, Math.min(4, targetZoom));
      if (next === before) return;
      const {fx, fy, fw, fh} = frameRect();
      const cx = fx + fw/2;
      const cy = fy + fh/2;

      const iw = img.naturalWidth * before;
      const ih = img.naturalHeight * before;
      const dx = fx + tx - iw/2 + fw/2;
      const dy = fy + ty - ih/2 + fh/2;
      const wx = (cx - dx) / before;
      const wy = (cy - dy) / before;

      zoom = next;
      const niw = img.naturalWidth * zoom;
      const nih = img.naturalHeight * zoom;
      const ndx = cx - wx * zoom;
      const ndy = cy - wy * zoom;
      tx = ndx - (fx - fw/2) + niw/2;
      ty = ndy - (fy - fh/2) + nih/2;

      overlay.classList.add("is-active");
      draw();
      clearTimeout(setZoomAroundCenter._t);
      setZoomAroundCenter._t = setTimeout(()=> overlay.classList.remove("is-active"), 120);
    }

    async function exportCroppedCanvas(){
      const {fx, fy, fw, fh} = frameRect();

      const scaleOut = 1080 / Math.max(fw, fh);
      const outW = Math.round(fw * scaleOut);
      const outH = Math.round(fh * scaleOut);

      const out = document.createElement("canvas");
      out.width = outW; out.height = outH;
      const octx = out.getContext("2d", { alpha: true });
      octx.imageSmoothingQuality = "high";

      const iw = img.naturalWidth * zoom * scaleOut;
      const ih = img.naturalHeight * zoom * scaleOut;
      const dx = (tx - (img.naturalWidth * zoom)/2 + fw/2) * scaleOut;
      const dy = (ty - (img.naturalHeight* zoom)/2 + fh/2) * scaleOut;

      octx.save();
      octx.beginPath(); octx.rect(0, 0, outW, outH); octx.clip();
      octx.drawImage(img, Math.round(dx), Math.round(dy), Math.round(iw), Math.round(ih));
      octx.restore();

      const blob = await new Promise(res=> out.toBlob(b=>res(b), "image/png", 0.95));
      return { blob, w: outW, h: outH };
    }

    function cleanup(){
      try { URL.revokeObjectURL(url); } catch {}
      window.removeEventListener("keydown", onEsc);
      back.remove();
      document.body.classList.remove("is-cropping");
    }

    const onBackdropClick = (e)=>{ if (e.target === back){ cleanup(); reject(new Error("cancel")); } };
    const onEsc = (e)=>{ if (e.key === "Escape"){ cleanup(); reject(new Error("cancel")); } };
    back.addEventListener("click", onBackdropClick);
    window.addEventListener("keydown", onEsc);
  });
}
