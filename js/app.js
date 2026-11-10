/* 主程式：相機／照片來源、地板校準、掃描、手動校正、題目切換、投影視窗、匯出。 */
(function () {
  const SM = window.SM, $ = SM.$, h = SM.h;
  const isView = location.hash === "#view", isLive = location.hash === "#live"; // #view：本機投影（同瀏覽器即時）；#live：雲端跟隨投影
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("sociometry") : null;

  /* ================= 投影視窗（#view） ================= */
  if (isView) {
    document.body.classList.add("view");
    document.title = "投影視窗 — 社會計量";
    const cv = $("viewc"); let last = null;
    const draw = () => { const d = window.devicePixelRatio || 1; cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); SM.Charts.draw(cv, last); };
    const on = (m) => { if (m && m.kind === "view") { last = m.view; draw(); } };
    if (bc) bc.onmessage = (e) => on(e.data);
    addEventListener("message", (e) => on(e.data));
    addEventListener("resize", draw);
    addEventListener("dblclick", () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });
    addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen().catch(() => {}); });
    draw();
    const hello = () => { try { bc && bc.postMessage({ kind: "hello" }); window.opener && window.opener.postMessage({ kind: "hello" }, "*"); } catch (e) {} };
    hello(); const t = setInterval(() => { if (last) clearInterval(t); else hello(); }, 1000);
    return;
  }

  if (isLive) { document.body.classList.add("view", "live"); document.title = "跟隨投影 — 社會計量"; }

  /* ================= 狀態 ================= */
  const S = {
    src: null, sw: 0, sh: 0, srcType: "", corners: [], H: null, Hinv: null, floor: { w: 8, d: 6 },
    live: isLive, follow: null, liveMode: "auto", lastOp: 0, lastPub: "", pubT: 0, devName: "", tool: null, qs: [], cur: 0, cls: null, classes: [], group: "1", meta: { template: null }, noSave: false, calibDirty: false, filter: "", loop: false, busy: false, boxes: [], boxMeta: null, undo: [],
    settings: { model: "yolov10s", tiles: "auto", thr: 0.25, foot: "bottom", stab: 5, showBox: false },
    stab: new SM.Stabilizer(5), drag: null, projWin: null, saveTimer: null,
  };
  const Q = () => S.qs[S.cur];
  const ro = () => S.group === "merge"; // 合併檢視是唯讀
  const noQ = () => { if (Q()) return false; msg("這個班級還沒有題目，請先新增題目。"); return true; };
  const stopLoop = () => { S.loop = false; $("bLoop").classList.remove("on"); };
  const msg = (t) => { $("msg").textContent = t || ""; };
  const kScale = () => Math.max(1, S.sw / 900); // 影像像素 ↔ 畫面大小的比例，讓線條/圓點看起來大小固定

  /* ================= 地板座標 ================= */
  function rebuildH() {
    if (S.corners.length === 4) {
      const F = [[0, 0], [S.floor.w, 0], [S.floor.w, S.floor.d], [0, S.floor.d]];
      try { S.H = SM.homography(S.corners, F); S.Hinv = SM.homography(F, S.corners); } catch (e) { S.H = S.Hinv = null; }
    } else { S.H = S.Hinv = null; }
    S.calibDirty = true;
  }
  const calibrated = () => !!S.H;
  const toFloor = (x, y) => (S.H ? SM.applyH(S.H, x, y) : [(x / S.sw) * S.floor.w, (y / S.sh) * S.floor.d]);
  const toImg = (fx, fy) => (S.Hinv ? SM.applyH(S.Hinv, fx, fy) : [(fx / S.floor.w) * S.sw, (fy / S.floor.d) * S.sh]);
  const ctx = {
    get floor() { return S.floor; }, toFloor, toImg,
    line(c, a, b) { const p = toImg(a[0], a[1]), q = toImg(b[0], b[1]); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); },
    tag(c, f, text, color, k, center) {
      const p = toImg(f[0], f[1]); c.font = "bold " + 20 * k + "px sans-serif"; c.textAlign = center ? "center" : "left"; c.textBaseline = "middle";
      c.lineWidth = 4 * k; c.strokeStyle = "rgba(0,0,0,.8)"; c.strokeText(text, p[0], p[1]); c.fillStyle = color; c.fillText(text, p[0], p[1]);
    },
  };
  const inFloor = (x, y) => { if (!calibrated()) return true; const [fx, fy] = toFloor(x, y), mx = S.floor.w * 0.06, my = S.floor.d * 0.06; return fx >= -mx && fx <= S.floor.w + mx && fy >= -my && fy <= S.floor.d + my; };

  /* ================= 來源：鏡頭 / 照片 ================= */
  function setSource(el, w, h, type) {
    S.src = el; S.sw = w; S.sh = h; S.srcType = type; const ov = $("ov"); ov.width = w; ov.height = h; $("empty").hidden = true; S.boxes = [];
    applyClassCalib(); drawOv(); refresh();
  }
  async function startCam(deviceId) {
    try {
      if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
      const st = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ width: { ideal: 1920 }, height: { ideal: 1080 } }, deviceId ? { deviceId: { exact: deviceId } } : {}) });
      S.stream = st; const v = $("vid"); v.srcObject = st; await v.play(); $("pic").hidden = true; v.hidden = false;
      setSource(v, v.videoWidth, v.videoHeight, "cam");
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"), sel = $("camSel");
      if (devs.length > 1) { sel.hidden = false; sel.innerHTML = ""; devs.forEach((d, i) => sel.append(h("option", { value: d.deviceId }, d.label || "攝影機 " + (i + 1)))); const cur = st.getVideoTracks()[0].getSettings().deviceId; if (cur) sel.value = cur; }
      msg("鏡頭已開啟（" + v.videoWidth + "×" + v.videoHeight + "）。影像只在本機處理。");
    } catch (e) { msg("無法開啟鏡頭：" + e.message + "。請確認瀏覽器已允許使用攝影機（網址列左側的鎖頭/相機圖示）；或先用「載入照片測試」。"); }
  }
  function loadImg(url) {
    const im = $("pic"); im.onload = () => { $("vid").hidden = true; im.hidden = false; setSource(im, im.naturalWidth, im.naturalHeight, "img"); msg("已載入照片（" + im.naturalWidth + "×" + im.naturalHeight + "），僅供測試。"); S.imgReady && S.imgReady(); };
    im.onerror = () => msg("照片載入失敗：" + url); im.src = url;
  }
  $("bCam").onclick = () => startCam();
  $("camSel").onchange = (e) => startCam(e.target.value);
  $("bImg").onclick = () => $("file").click();
  $("file").onchange = (e) => { const f = e.target.files[0]; if (f) loadImg(URL.createObjectURL(f)); };

  /* ================= 疊圖 ================= */
  const visiblePts = (q) => q.pts;
  function drawOv() {
    const ov = $("ov"), c = ov.getContext("2d"); c.clearRect(0, 0, ov.width, ov.height); if (!S.sw) return;
    const k = kScale(), q = Q();
    if (S.corners.length) {
      c.strokeStyle = "#ffb02e"; c.lineWidth = 3 * k; c.beginPath(); S.corners.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (S.corners.length === 4) c.closePath(); c.stroke();
      c.fillStyle = "#ffb02e"; c.font = 16 * k + "px sans-serif"; c.textAlign = "left"; c.textBaseline = "alphabetic";
      S.corners.forEach((p, i) => { c.beginPath(); c.arc(p[0], p[1], (S.tool === "calib" ? 8 : 5) * k, 0, 7); c.fill(); c.fillText(["左上(遠左)", "右上(遠右)", "右下(近右)", "左下(近左)"][i], p[0] + 10 * k, p[1] - 10 * k); });
    }
    if (q && q.type !== "cards") { c.save(); SM.Modes[q.type].overlay(c, q, ctx, k); c.restore(); }
    if (S.settings.showBox) { c.strokeStyle = "rgba(255,240,0,.8)"; c.lineWidth = 2 * k; S.boxes.forEach((b) => c.strokeRect(b.x, b.y, b.w, b.h)); }
    if (q) {
      if (q.type === "cards") q.cardPts.forEach((p) => { c.strokeStyle = p.c; c.lineWidth = 3 * k; c.strokeRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r); });
      else q.pts.forEach((p) => { c.fillStyle = p.m ? "rgba(70,160,255,.95)" : "rgba(255,90,50,.92)"; c.strokeStyle = "#fff"; c.lineWidth = 2 * k; c.beginPath(); c.arc(p.x, p.y, 8 * k, 0, 7); c.fill(); c.stroke(); });
    }
  }

  /* ================= 指標操作：校準 / 圓心 / 圓點編輯 ================= */
  const evXY = (e) => { const r = $("ov").getBoundingClientRect(); return [((e.clientX - r.left) * S.sw) / r.width, ((e.clientY - r.top) * S.sh) / r.height]; };
  function setTool(t) {
    S.tool = t; $("bCal").classList.toggle("on", t === "calib"); $("bEdit").classList.toggle("on", t === "edit");
    $("ov").style.cursor = t === "calib" || t === "center" || t === "sample" ? "crosshair" : t === "edit" ? "cell" : "default"; hint();
  }
  function hint() {
    const q = Q(); let t = "";
    if (!S.sw) t = "步驟：開啟鏡頭（或載入照片）→ ① 校準地板 → ② 掃描 → ③ 必要時手動校正 → ④ 鎖定 → 下一題。";
    else if (S.tool === "calib") t = S.corners.length < 4 ? "依序點地板四角：左上(遠左)、右上(遠右)、右下(近右)、左下(近左)；點完後可拖曳角點微調。" : "拖曳橘色角點微調，完成後再按一次「校準地板」。";
    else if (S.tool === "center") t = "在地板畫面上點出圓心（例如放「房子」標誌的位置）。";
    else if (S.tool === "edit") t = "手動校正：點空白處＝新增；點圓點＝刪除；拖曳圓點＝移動。紅點＝自動偵測，藍點＝手動。";
    else if (S.tool === "sample") t = "請點一張「" + SM.CARD_COLORS[SM.Cards.sampling].name + "」色卡。";
    else if (!calibrated()) t = "尚未校準地板：目前以整張畫面當作地板（誤差會較大）。建議先按「① 校準地板」。";
    else if (q && q.type === "distance" && !q.cfg.center) t = "請先在右側按「在畫面上點選圓心」。";
    else t = "已校準。按「② 掃描」或「連續掃描」；數字不對就用「③ 手動校正」。";
    $("hint").textContent = t;
  }
  $("bCal").onclick = () => {
    if (!S.sw) return msg("請先開啟鏡頭或載入照片。");
    if (S.tool === "calib") { setTool(null); if (S.corners.length < 4) { S.corners = []; rebuildH(); } return refresh(); }
    if (S.corners.length === 4) setTool("calib"); else { S.corners = []; rebuildH(); setTool("calib"); }
    drawOv();
  };
  $("bRecal").onclick = () => { if (!S.sw) return; S.corners = []; rebuildH(); setTool("calib"); drawOv(); refresh(); };
  $("bEdit").onclick = () => { if (!S.sw) return msg("請先開啟鏡頭或載入照片。"); setTool(S.tool === "edit" ? null : "edit"); };

  function pushUndo() { const q = Q(); if (!q) return; S.undo.push(JSON.stringify({ id: q.id, pts: q.pts, hidden: q.hidden })); if (S.undo.length > 40) S.undo.shift(); }
  function undo() { const s = S.undo.pop(); if (!s) return msg("沒有可復原的動作。"); const d = JSON.parse(s), i = S.qs.findIndex((q) => q.id === d.id); if (i < 0) return; S.cur = i; Q().pts = d.pts; Q().hidden = d.hidden; refresh(); renderList(); }
  $("bUndo").onclick = undo;
  const hitR = () => 16 * kScale();

  $("ov").addEventListener("pointerdown", (e) => {
    if (!S.sw || !Q()) return; const [x, y] = evXY(e), q = Q(), k = kScale();
    if (S.tool === "sample") { const left = SM.Cards.sampleAt(S.src, x, y); if (left < 0) { setTool(null); msg("色卡取樣完成，可以按「掃描」。"); } hint(); return; }
    if (S.tool === "center") { q.cfg.center = { x: toFloor(x, y)[0], y: toFloor(x, y)[1] }; setTool("edit"); renderPanel(); refresh(); msg("圓心已設定。"); return; }
    if (S.tool === "calib") {
      const i = S.corners.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < hitR());
      if (S.corners.length === 4 && i >= 0) { S.drag = { kind: "corner", i }; $("ov").setPointerCapture(e.pointerId); }
      else if (S.corners.length < 4) { S.corners.push([x, y]); if (S.corners.length === 4) { rebuildH(); msg("地板已校準，可再拖曳角點微調。"); } drawOv(); refresh(); hint(); }
      return;
    }
    if (S.tool === "edit") {
      if (ro()) return msg("合併檢視是唯讀，請先切到某一組再修改。");
      if (q.locked) return msg("本題已鎖定，請先解除鎖定才能修改。");
      if (q.type === "cards") return msg("色卡模式請用右側 ＋／− 調整人數。");
      const i = q.pts.findIndex((p) => Math.hypot(p.x - x, p.y - y) < hitR());
      if (i >= 0) { S.drag = { kind: "pt", i, sx: x, sy: y, moved: false, orig: { x: q.pts[i].x, y: q.pts[i].y } }; $("ov").setPointerCapture(e.pointerId); }
      else { pushUndo(); q.pts.push({ x, y, m: 1 }); drawOv(); refresh(); publishLive(true); }
    }
  });
  $("ov").addEventListener("pointermove", (e) => {
    if (!S.drag) return; const [x, y] = evXY(e), d = S.drag, q = Q();
    if (d.kind === "corner") { S.corners[d.i] = [x, y]; rebuildH(); drawOv(); refresh(); return; }
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 5 * kScale()) { d.moved = true; pushUndo(); const p = q.pts[d.i]; if (!p.m) { q.hidden.push({ x: d.orig.x, y: d.orig.y, r: 30 * kScale(), moved: 1 }); p.m = 1; } }
    if (d.moved) { q.pts[d.i].x = x; q.pts[d.i].y = y; drawOv(); refresh(true); }
  });
  $("ov").addEventListener("pointerup", () => {
    const d = S.drag; S.drag = null; if (!d) return; const q = Q();
    if (d.kind === "pt" && !d.moved) { publishLive(true); pushUndo(); const p = q.pts[d.i]; if (!p.m) q.hidden.push({ x: p.x, y: p.y, r: 30 * kScale() }); q.pts.splice(d.i, 1); drawOv(); refresh(); }
    else if (d.kind === "corner") { hint(); refresh(); }
    else refresh();
  });

  /* ================= 掃描 ================= */
  function scanROI() {
    if (S.corners.length !== 4) return null;
    const xs = S.corners.map((p) => p[0]), ys = S.corners.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, hh = y1 - y0;
    const ax = Math.max(0, x0 - w * 0.06), bx = Math.min(S.sw, x1 + w * 0.06), ay = Math.max(0, y0 - Math.max(hh * 0.6, S.sh * 0.35)), by = Math.min(S.sh, y1 + hh * 0.08);
    return [ax, ay, bx - ax, by - ay];
  }
  function autoTiles(roi) { const r = roi[2] / roi[3]; return Math.max(1, Math.min(5, Math.ceil(r * 1.2))) + "x1"; }
  async function scanOnce(fromLoop) {
    const q = Q(); if (!q) return noQ(); if (!S.sw) return msg("請先開啟鏡頭或載入照片。"); if (S.busy) return;
    if (ro()) { msg("合併檢視是唯讀，請先切到某一組再掃描。"); stopLoop(); return; }
    if (q.locked) { msg("本題已鎖定。要重新掃描請先解除鎖定。"); S.loop = false; $("bLoop").classList.remove("on"); return; }
    S.busy = true; $("bScan").disabled = true; publishLive(true);
    try {
      if (q.type === "cards") {
        const r = SM.Cards.detect(S.src, S.sw, S.sh, scanROI() ? (() => { const r2 = scanROI(); return [r2[0], r2[1], r2[0] + r2[2], r2[1] + r2[3]]; })() : null);
        q.cardCount = r.counts; q.cardPts = r.pts; msg("色卡掃描完成（輔助功能）。");
      } else {
        const roi = scanROI() || [0, 0, S.sw, S.sh], tiles = S.settings.tiles === "auto" ? autoTiles(roi) : S.settings.tiles;
        const res = await SM.Detector.detect(S.src, S.sw, S.sh, { model: S.settings.model, tiles, thr: S.settings.thr, roi, overlap: tiles.startsWith("1x") ? 0 : 0.3 }, msg);
        S.boxes = res.boxes;
        const foots = res.boxes.map((b) => SM.footPoint(b, S.settings.foot, S.sw, S.sh)).filter((p) => inFloor(p.x, p.y));
        const mw = res.boxes.length ? SM.median(res.boxes.map((b) => b.w)) : 40;
        S.stab.resize(S.settings.stab); S.stab.push(foots);
        const stable = S.stab.size >= 1 ? S.stab.result(Math.max(10, mw * 0.45)) : foots;
        const hid = q.hidden, auto = stable.filter((p) => !hid.some((hd) => Math.hypot(hd.x - p.x, hd.y - p.y) < hd.r));
        const man = q.pts.filter((p) => p.m);
        q.pts = auto.map((p) => ({ x: p.x, y: p.y, m: 0 })).concat(man);
        S.lastScan = { ms: Math.round(res.ms), be: res.backend, tiles, n: res.boxes.length, frames: S.stab.size };
        msg("已掃描（" + S.lastScan.be + "，" + tiles + "，" + S.lastScan.ms + " ms；穩定影格 " + S.stab.size + "/" + S.settings.stab + "）。數字不對可用「③ 手動校正」補點或刪點。" + (res.backend === "wasm" && res.ms > 2500 ? "\n⚠ 這台電腦沒有啟用 WebGPU，掃描較慢：建議改選 YOLOv10n、減少分塊，並用「掃描一次」代替連續掃描。" : ""));
      }
    } catch (e) {
      console.error(e);
      msg("掃描失敗：" + e.message + "（若是模型下載失敗，請看 README「離線使用」；或改用 COCO-SSD / 手動點選。）");
      S.loop = false; $("bLoop").classList.remove("on");
    }
    S.busy = false; $("bScan").disabled = false; drawOv(); refresh(); renderList();
  }
  $("bScan").onclick = () => { S.stab.reset(); scanOnce(); };
  $("bLoop").onclick = async () => {
    if (S.loop) { S.loop = false; $("bLoop").classList.remove("on"); return; }
    if (!S.sw) return msg("請先開啟鏡頭或載入照片。");
    S.loop = true; S.stab.reset(); $("bLoop").classList.add("on");
    while (S.loop) { await scanOnce(true); await SM.sleep(S.srcType === "cam" ? 150 : 400); }
  };

  /* ================= 題目 ================= */
  function counts(q) { const pts = visiblePts(q); return SM.Modes[q.type].compute(q, pts, ctx); }
  function stats(q) { return { det: q.pts.filter((p) => !p.m).length, add: q.pts.filter((p) => p.m).length, del: q.hidden.filter((x) => !x.moved).length }; }
  function buildView(q) {
    const r = counts(q), st = stats(q), total = r.counts.reduce((a, b) => a + b, 0);
    return Object.assign({ type: q.type, title: q.title, labels: r.labels, counts: r.counts, total, locked: q.locked, det: st.det, add: st.add, del: st.del }, r.extra);
  }
  let refreshing = 0;
  function refresh(light) {
    const q = Q(); if (!q) return;
    const v = buildView(q);
    if (S.live) { liveDraw(v); return; } // 跟隨投影頁：只畫大圖，不做其他事
    SM.Charts.draw($("chart"), v);
    const tot = $("stat");
    tot.innerHTML = ""; tot.append(h("span", { class: "p", style: "background:#3a3322;color:#ffd37a" }, (S.cls ? S.cls.name + "・" : "") + SM.Q.groupName(S.group)));
    if (q.type === "cards") tot.append(h("span", { class: "big" }, v.total), "人（色卡）");
    else tot.append(h("span", { class: "big" }, v.total), h("span", {}, "人"), h("span", { class: "p" }, "自動偵測 " + v.det), h("span", { class: "p" }, "手動新增 +" + v.add), h("span", { class: "p" }, "手動刪除 −" + v.del), q.locked ? h("span", { class: "p", style: "color:#7bd88f" }, "🔒 已鎖定") : "",
      q.type === "distance" && !q.cfg.center ? h("span", { class: "p", style: "color:#ff7a5c" }, "尚未設定圓心") : "", !calibrated() && S.sw ? h("span", { class: "p", style: "color:#ffb02e" }, "未校準地板") : "");
    $("bLock").textContent = q.locked ? "🔒 解除鎖定" : "④ 鎖定本題"; $("bLock").classList.toggle("on", q.locked); $("bLock").disabled = ro();
    if (!light) hint();
    postView(v); scheduleSave();
  }
  function liveDraw(v) {
    const cv = $("viewc"), d = window.devicePixelRatio || 1; cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d);
    if (!S.follow) v = null;
    if (v) v.sub = (S.cls ? S.cls.name : "") + "・" + SM.Q.groupName(S.group) + (S.follow && S.follow.by ? "　（操作裝置 " + S.follow.by + "）" : "");
    SM.Charts.draw(cv, v, "等待操作電腦開始掃描…");
  }
  function postView(v) {
    const m = { kind: "view", view: v };
    try { bc && bc.postMessage(m); } catch (e) {}
    try { if (S.projWin && !S.projWin.closed) S.projWin.postMessage(m, "*"); } catch (e) {}
  }
  addEventListener("message", (e) => { if (e.data && e.data.kind === "hello") refresh(true); });
  if (bc) bc.onmessage = (e) => { if (e.data && e.data.kind === "hello") refresh(true); };

  function renderList() {
    const ul = $("qlist"); ul.innerHTML = ""; const f = S.filter.trim().toLowerCase(), N = S.cls ? S.cls.groups : 4, gs = Array.from({ length: N }, (_, i) => String(i + 1)).concat(["all"]);
    S.qs.forEach((q, i) => {
      if (f && !q.title.toLowerCase().includes(f) && String(i + 1) !== f) return;
      const t = counts(q).counts.reduce((a, b) => a + b, 0);
      const dots = h("span", { class: "dots", title: "各組完成度（綠＝已鎖定，橘＝有資料，灰＝空）" }, gs.map((g) => { const r = SM.Q.resOf(q, g, S.group); const st = r && r.locked ? "lk" : r && ((r.pts && r.pts.length) || (r.snaps && r.snaps.length) || (r.cardCount && r.cardCount.some((x) => x))) ? "pt" : ""; return h("i", { class: st }); }));
      ul.append(h("li", { class: i === S.cur ? "cur" : "", onclick: () => selectQ(i) }, h("span", { class: "n" }, i + 1), h("span", { class: "t" }, q.title), h("span", { class: "tag " + q.type }, SM.Modes[q.type].name), dots, h("span", { class: "mute" }, t)));
    });
    const cur = ul.querySelector("li.cur"); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    $("qCount").textContent = "共 " + S.qs.length + " 題";
    renderSnaps();
  }
  function renderSnaps() {
    const q = Q(), d = $("snaps"); d.innerHTML = ""; if (!q || !q.snaps.length) { d.textContent = "（尚無快照）"; return; }
    q.snaps.forEach((s, i) => d.append(h("div", {}, (i + 1) + ". " + (s.g ? SM.Q.groupName(s.g) + "｜" : "") + s.t + (s.locked ? "🔒" : "") + "｜共 " + s.total + "｜" + s.labels.map((l, j) => l + ":" + s.counts[j]).join("、"))));
  }
  function renderPanel() {
    const q = Q(), tr = $("techRow"); tr.innerHTML = ""; if (!q) { $("qTitle").value = ""; $("panel").innerHTML = ""; $("techHint").textContent = "（這個班級還沒有題目）"; return; }
    $("qTitle").value = q.title;
    tr.append(h("label", {}, "技術"), ...["spectrum", "matrix", "distance", "cards"].map((t) => h("button", { class: q.type === t ? "on" : "", onclick: () => changeType(t), title: SM.Modes[t].en }, SM.Modes[t].name)));
    $("techHint").textContent = SM.Modes[q.type].en + "：" + SM.Modes[q.type].hint;
    const p = $("panel"); p.innerHTML = ""; p.append(...SM.Modes[q.type].panel(q, () => { drawOv(); refresh(); renderList(); }, null, App));
    if (SM.Auth && typeof lockCfg === "function") lockCfg(!SM.Auth.isTeacher());
  }
  function changeType(t) {
    const q = Q(); if (!q || q.type === t) return; if (q.locked) return msg("本題已鎖定，請先解除鎖定。");
    if (q.pts.length && !confirm("切換技術會保留圓點位置，但設定會重設為該技術的預設值。繼續？")) return;
    q.type = t; q.cfg = SM.Modes[t].defaults(); renderPanel(); drawOv(); refresh(); renderList();
  }
  function selectQ(i) { if (S.loop) { S.loop = false; $("bLoop").classList.remove("on"); } S.cur = Math.max(0, Math.min(S.qs.length - 1, i)); S.undo = []; S.stab.reset(); S.boxes = []; if (S.tool === "center") setTool(null); renderList(); renderPanel(); drawOv(); refresh(); publishLive(false); }
  $("qTitle").oninput = (e) => { Q().title = e.target.value; refresh(true); renderList(); };
  $("qAdd").onclick = () => { S.qs.push(SM.Q.create("spectrum", "新題目")); selectQ(S.qs.length - 1); };
  $("qDup").onclick = () => { const o = Q(); if (!o) return noQ(); const c = SM.Q.create(o.type, o.title + "（複製）", JSON.parse(JSON.stringify(o.cfg))); S.qs.splice(S.cur + 1, 0, c); selectQ(S.cur + 1); };
  $("qDel").onclick = () => { if (!Q()) return noQ(); if (!confirm("刪除這一題（含快照）？")) return; S.qs.splice(S.cur, 1); if (!S.qs.length) S.qs.push(SM.Q.create("spectrum", "新題目")); selectQ(Math.min(S.cur, S.qs.length - 1)); };
  $("qUp").onclick = () => { if (S.cur > 0) { [S.qs[S.cur - 1], S.qs[S.cur]] = [S.qs[S.cur], S.qs[S.cur - 1]]; selectQ(S.cur - 1); } };
  $("qDn").onclick = () => { if (S.cur < S.qs.length - 1) { [S.qs[S.cur + 1], S.qs[S.cur]] = [S.qs[S.cur], S.qs[S.cur + 1]]; selectQ(S.cur + 1); } };
  $("qReset").onclick = () => { if (!guard()) return; if (!confirm("還原成範例題組？本班目前所有題目、各組結果與快照都會被取代。")) return; S.qs = SM.Q.sampleSet(); S.cls.qs = S.qs; selectQ(0); };
  $("qExp").onclick = () => SM.Q.download("社會計量題組.json", JSON.stringify(SM.Q.configsOf(S.qs), null, 1), "application/json");
  $("qImp").onclick = () => { if (guard()) $("qFile").click(); };
  $("qFile").onchange = async (e) => { try { const a = JSON.parse(await e.target.files[0].text()); if (!confirm("匯入題組會取代本班的題目與各組結果。繼續？")) return; S.qs = SM.Q.fromConfigs(a); S.cls.qs = S.qs; selectQ(0); msg("已匯入 " + S.qs.length + " 題。"); } catch (err) { msg("匯入失敗：" + err.message); } };

  /* 鎖定 / 快照 */
  function snapshot(note) {
    if (!Q()) return; const q = Q(), v = buildView(q), t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    q.snaps.push({ g: S.group, t, labels: v.labels, counts: v.counts, total: v.total, det: v.det, add: v.add, del: v.del, locked: q.locked, note: note || (q.type === "distance" ? "圓心=" + q.cfg.centerLabel + "；每圈" + q.cfg.step + "公尺" : "") });
    renderSnaps();
  }
  $("bLock").onclick = () => {
    const q = Q(); if (!q) return noQ(); if (ro()) return msg("合併檢視是唯讀；請切到某一組再鎖定。"); q.locked = !q.locked;
    publishLive(true);
    if (q.locked) { S.loop = false; $("bLoop").classList.remove("on"); snapshot(); msg("已鎖定本題並存入快照。按 → 進入下一題。"); } else msg("已解除鎖定。");
    refresh(); renderList();
  };
  $("bSnap").onclick = () => { snapshot(); msg("已存快照（共 " + Q().snaps.length + " 筆）。"); };
  $("bClear").onclick = () => { const q = Q(); if (!q) return noQ(); if (ro()) return msg("合併檢視是唯讀。"); if (q.locked) return msg("本題已鎖定。"); pushUndo(); q.pts = []; q.hidden = []; q.cardCount = [0, 0, 0, 0, 0]; q.cardPts = []; q.cardAdj = [0, 0, 0, 0, 0]; S.stab.reset(); drawOv(); refresh(); renderList(); };
  $("bCsv").onclick = () => { if (!SM.Q.snapCount([plainNow()])) return msg("本班還沒有快照。請先「④ 鎖定本題」或「存快照」。"); SM.Q.download("社會計量_" + S.cls.name + "_" + new Date().toISOString().slice(0, 10) + ".csv", SM.Q.toCSV([plainNow()])); msg("已匯出本班 CSV（UTF-8 含 BOM，Excel 可直接開啟）。"); };

  /* 投影視窗 */
  $("bProj").onclick = () => {
    S.projWin = window.open(location.href.split("#")[0] + "#view", "sociometry_view", "popup,width=1280,height=720");
    if (!S.projWin) return msg("瀏覽器擋住了彈出視窗，請允許後再按一次。");
    msg("投影視窗已開啟：拖到投影幕那個螢幕，在視窗內雙擊（或按 F）進入全螢幕。");
    [600, 1500, 3000].forEach((t) => setTimeout(() => refresh(true), t));
  };

  /* 偵測設定 */
  const A = {
    cardsApi: null,
  };
  const App = {
    pickCenter() { if (!S.sw) return msg("請先開啟鏡頭或載入照片。"); if (!calibrated()) msg("建議先校準地板，圓心與距離才會準。"); setTool("center"); },
    cards: {
      base() { if (!S.sw) return msg("請先開啟鏡頭或載入照片。"); SM.Cards.setBase(S.src, S.sw, S.sh); msg("已記錄背景基準（請在大家還沒舉卡時拍）。"); },
      sample() { if (!S.sw) return msg("請先開啟鏡頭或載入照片。"); SM.Cards.samples = {}; SM.Cards.sampling = 0; setTool("sample"); },
    },
  };
  function initSettings() {
    const m = $("model"); Object.entries(SM.MODELS).forEach(([k, v]) => m.append(h("option", { value: k }, v.label)));
    const s = S.settings; m.value = s.model; $("tiles").value = s.tiles; $("thr").value = s.thr; $("thrv").textContent = (+s.thr).toFixed(2); $("foot").value = s.foot; $("stab").value = s.stab; $("showBox").checked = s.showBox;
    $("floorW").value = S.floor.w; $("floorD").value = S.floor.d;
    const bind = (id, key, conv) => $(id).addEventListener("input", (e) => { s[key] = conv ? conv(e.target.value) : e.target.value; if (id === "thr") $("thrv").textContent = s.thr.toFixed(2); if (id === "showBox") s.showBox = e.target.checked; S.stab.reset(); drawOv(); scheduleSave(); });
    bind("model", "model"); bind("tiles", "tiles"); bind("thr", "thr", Number); bind("foot", "foot"); bind("stab", "stab", Number); bind("showBox", "showBox");
    ["floorW", "floorD"].forEach((id) => $(id).addEventListener("change", () => { S.floor.w = Math.max(1, +$("floorW").value || 8); S.floor.d = Math.max(1, +$("floorD").value || 6); rebuildH(); drawOv(); refresh(); }));
    $("bModelFile").onclick = () => $("modelFile").click();
    $("modelFile").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; await SM.Detector.setUserModel(S.settings.model, f); $("modelInfo").textContent = "已載入本機檔 " + f.name; };
  }

  /* 存檔：只存班級／題目／各組結果／校準／設定，不存影像。每班一筆存進 IndexedDB */
  function plainNow() { stashAll(); S.cls.cur = S.cur; S.cls.group = S.group; return SM.Q.plainClass(S.cls, S.qs); }
  async function saveClass() {
    if (S.noSave || !S.cls) return;
    if (S.calibDirty && S.sw) { S.cls.corners = S.corners.length === 4 ? S.corners.map((p) => [p[0] / S.sw, p[1] / S.sh]) : []; S.cls.sz = [S.sw, S.sh]; S.calibDirty = false; calibInfo(); }
    try { await SM.Store.putClass(plainNow()); await SM.Store.setMeta("app", { cur: S.cls.id, settings: S.settings, template: S.meta.template }); await pushClass(S.cls); $("saveInfo").textContent = "已自動儲存 " + new Date().toLocaleTimeString("zh-TW", { hour12: false }); }
    catch (e) { $("saveInfo").textContent = "⚠ 儲存失敗：" + e.message + "（請用「全部備份」匯出）"; }
  }
  function scheduleSave() { if (S.noSave) return; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveClass, 500); }
  addEventListener("visibilitychange", () => { if (document.hidden) saveClass(); });
  addEventListener("pagehide", () => saveClass());

  /* ================= 「正在操作」指標：讓跟隨投影頁知道要顯示哪班哪題哪組 ================= */
  function publishLive(op) {
    if (!cloudOn() || S.live || S.liveMode === "off" || !S.cls || !S.cls._cloud || !Q() || !S.ready) return;
    const now = Date.now(); if (op) S.lastOp = now;
    if (S.liveMode === "auto" && !op && now - S.lastOp > 180000) return; // 自動：最近 3 分鐘有掃描／校正／鎖定才跟隨換題
    const key = S.cls.id + "|" + Q().id + "|" + S.group;
    if (key === S.lastPub && now - S.pubT < 5000) return; // 同一目標最多每 5 秒重發一次
    S.lastPub = key; S.pubT = now;
    Cl().setLive({ classId: S.cls.id, qid: Q().id, group: S.group, by: S.devName, ts: now }).catch((e) => { console.warn("live pointer", e); }); // 失敗（例如規則尚未更新）不影響結果同步，只是投影不會自動跟隨
  }
  /* 跟隨投影頁：依雲端指標切換班級／組別／題目 */
  async function applyFollow() {
    const f = S.follow; if (!f || !S.live) return;
    const c = S.classes.find((x) => x.id === f.classId && x._cloud); if (!c) return;
    if (!S.cls || S.cls.id !== c.id) { await switchClass(c.id); return; } // 切班後等第一次同步完成再套用
    if (!c._synced) return;
    if (S.group !== f.group) setGroup(f.group);
    const i = S.qs.findIndex((q) => q.id === f.qid); if (i >= 0 && S.cur !== i) selectQ(i);
  }

  /* ================= 教師權限（Google 登入把關；非資安機制，見 js/auth.js） ================= */
  /* 雲端模式下，沒登入的人（學生）可以編輯題目（內容、技術、選項、新增／刪除／排序）與操作各組結果；
     但不能動「班級層級」的設定：新增／改名／刪除班級、組數、地板校準與大小（伺服器規則同樣會擋） */
  function lockCfg(lock) {
    lock = lock && cloudOn();
    ["grpN", "floorW", "floorD", "bRecal", "bCal"].forEach((id) => { if ($(id)) { $(id).disabled = lock; $(id).title = lock ? "需要教師登入" : ""; } });
    $("cUpload").hidden = !(cloudOn() && SM.Auth.isTeacher() && S.classes.some((c) => !c._cloud));
  }
  const GATED = ["cCalAll", "cNew", "cRen", "cDel", "cTplApply", "cImp", "qReset", "qImp"];
  function guard() { if (SM.Auth.isTeacher()) return true; msg(SM.Auth.user ? "「" + SM.Auth.user.email + "」不在教師名單內，無法執行這個操作。" : "這個操作需要教師登入：請按右上角「使用 Google 登入」。"); return false; }
  function applyAuth() {
    const A = SM.Auth, ok = A.isTeacher(), box = $("authBox"); box.innerHTML = "";
    GATED.forEach((id) => { const b = $(id); if (!b) return; b.disabled = !ok; b.classList.toggle("locked", !ok); b.title = ok ? "" : "需要教師 Google 登入"; });
    lockCfg(!ok);
    if (!A.enabled()) { box.append(h("span", { class: "mute", title: "在 js/config.js 填入 Google Client ID 後啟用" }, "（Google 登入未啟用）")); return; }
    if (A.user) {
      box.append(h("span", { class: ok ? "who" : "no" }, (ok ? "👤 教師：" : "⚠ 非教師帳號：") + (A.user.name || A.user.email)), ok ? h("button", { class: "sm", onclick: manageTeachers }, "教師名單") : "", h("button", { class: "sm", onclick: () => A.logout() }, "登出"));
    } else {
      const g = h("span", { id: "gbtn" }), b = h("button", { class: "sm", onclick: async () => { b.disabled = true; if (cloudOn()) { try { await Cl().signIn(); } catch (e) { msg("登入失敗：" + (e.message || e.code)); } b.disabled = false; return; } try { await A.loadGsi(); b.remove(); A.renderButton(g); } catch (e) { b.disabled = false; msg(e.message); } } }, "教師登入（Google）");
      box.append(h("span", { class: "mute" }, "班級管理需教師登入；上課操作不需要"), b, g);
    }
  }
  async function manageTeachers() {
    const A = SM.Auth, fixed = (SM.CONFIG.teachers || []), t = prompt("教師名單（可在這台電腦新增／移除）\n目前：" + (A.teachers().join("、") || "無") + "\n\n輸入要新增的 Google email（多個用逗號分隔）；在 email 前加 - 表示移除。\n（config.js 內固定的名單無法在這裡移除）", "");
    if (!t) return; let list = A.owners.slice();
    t.split(/[,，\s]+/).filter(Boolean).forEach((x) => { if (x.startsWith("-")) { const e = x.slice(1).toLowerCase(); if (A.user && e === A.user.email.toLowerCase() && !fixed.length && A.owners.length <= 1) return msg("不能移除唯一的教師。"); list = list.filter((y) => y !== e); } else list.push(x); });
    await A.setOwners(list); msg("教師名單已更新：" + A.teachers().join("、"));
  }
  SM.Auth.onChange = applyAuth; SM.Auth.onDenied = (r) => msg("登入失敗：" + r);

  /* ================= 雲端同步（Firebase；未設定時完全不啟用） ================= */
  const Cl = () => SM.Cloud, st8 = (v) => Cl().stable(v);
  const cloudOn = () => Cl().on;
  function setSync(kind, e) {
    const el = $("syncInfo"); if (!el) return;
    if (!cloudOn()) { el.textContent = Cl().err ? "☁ " + Cl().err : "☁ 僅本機（雲端同步未啟用）"; return; }
    if (kind === "err") { const code = e && e.code ? e.code : ""; el.textContent = "☁ 同步失敗：" + (code === "permission-denied" ? "沒有權限（需教師登入）" : (e && e.message) || "未知錯誤"); el.style.color = "var(--bad)"; return; }
    el.style.color = ""; el.textContent = kind === "wait" ? "☁ 連線中…" : "☁ 已同步 " + new Date().toLocaleTimeString("zh-TW", { hour12: false });
  }
  const metaOf = (c) => ({ id: c.id, name: c.name, groups: c.groups, created: c.created, corners: Cl().cornersOut(c.corners), sz: c.sz || null, floor: c.floor, qorder: c.qs.map((q) => q.id) });
  const visibleClasses = () => (cloudOn() && !SM.Auth.isTeacher() ? S.classes.filter((c) => c._cloud) : S.classes);

  /* 推送「與上次同步不同」的部分。教師：班級設定、題目設定、各組結果；學生：只有各組結果（規則也只允許這樣） */
  function pushClass(c) { if (!c) return; c._pushP = (c._pushP || Promise.resolve()).then(() => doPush(c)); return c._pushP; } // 同一班的推送排隊，避免同時進行
  async function doPush(c) {
    if (S.live) return; // 跟隨投影頁是唯讀的，絕不寫入
    if (!cloudOn() || !c || !c._cloud || !c._synced) return;
    c._h = c._h || { meta: "", q: {} }; const teacher = SM.Auth.isTeacher();
    try {
      const m = metaOf(c), hm = st8(m);
      if (teacher) { if (hm !== c._h.meta) { await Cl().putClassMeta(m); c._h.meta = hm; c._h.qorder = st8(m.qorder); } }
      else { const ho = st8(m.qorder); if (c._h.qorder !== undefined && ho !== c._h.qorder) { await Cl().updateQorder(c.id, m.qorder); c._h.qorder = ho; } } // 學生：只能更新題目順序
      for (const q of c.qs) {
        const qh = c._h.q[q.id] || (c._h.q[q.id] = { cfg: "", res: {} });
        const hc = st8({ title: q.title, type: q.type, cfg: q.cfg }); if (hc !== qh.cfg) { await Cl().setQuestionConfig(c.id, q); qh.cfg = hc; } // 題目內容：所有人都能改
        for (const g of Object.keys(q.res)) {
          const hr = st8(q.res[g]); if (hr === qh.res[g]) continue;
          if (qh.res[g] === undefined && isEmptyRes(q.res[g])) continue; // 雲端從來沒有、本機也是空的 → 不用寫（否則會蓋掉別人稍後存的資料）
          await Cl().updateRes(c.id, q.id, g, q.res[g]); qh.res[g] = hr;
        }
      }
      for (const id of Object.keys(c._h.q)) if (!c.qs.some((q) => q.id === id)) { await Cl().deleteQuestion(c.id, id); delete c._h.q[id]; }
      setSync("ok");
    } catch (e) { console.warn("push failed", e); setSync("err", e); }
  }
  const isEmptyRes = (r) => !r || (!(r.pts || []).length && !(r.hidden || []).length && !r.locked && !(r.snaps || []).length && !(r.cardPts || []).length && !(r.cardCount || []).some((x) => x) && !(r.cardAdj || []).some((x) => x));
  function sortQs(c) { const o = c._qorder; if (!o) return; const rank = (q) => { const i = o.indexOf(q.id); return i < 0 ? 1e9 : i; }; c.qs.sort((a, b) => rank(a) - rank(b)); }

  /* 套用遠端的班級清單／設定 */
  function onRemoteClasses(changes) {
    let activeGone = false;
    for (const ch of changes) {
      if (ch.type === "removed") { const i = S.classes.findIndex((c) => c.id === ch.id && c._cloud); if (i >= 0) { if (S.cls && S.cls.id === ch.id) activeGone = true; S.classes.splice(i, 1); if (!S.noSave) SM.Store.delClass(ch.id); } continue; }
      const d = ch.data; let c = S.classes.find((x) => x.id === ch.id);
      if (!c) { c = { id: ch.id, groups: 4, created: d.created || Date.now(), corners: [], sz: null, floor: { w: 8, d: 6 }, cur: 0, group: "1", qs: [], _h: { meta: "", q: {} } }; S.classes.push(c); }
      c._cloud = true; c._metaRemote = true; c.name = d.name; c.groups = d.groups || 4; c.created = d.created || c.created; c.corners = Cl().cornersIn(d.corners); c.sz = d.sz || null; if (d.floor) { if (c === S.cls) { S.floor.w = d.floor.w; S.floor.d = d.floor.d; } else c.floor = d.floor; } c._qorder = d.qorder || null;
      if (c === S.cls && c._synced) { if (c._h.qorder === undefined || st8(c.qs.map((q) => q.id)) === c._h.qorder) { sortQs(c); c._h.qorder = st8(c.qs.map((q) => q.id)); c._h.meta = st8(metaOf(c)); } } // 本機有尚未推送的順序修改時，不被舊快照蓋掉
    }
    S.classes.sort((a, b) => a.created - b.created);
    if (activeGone || (S.cls && !visibleClasses().includes(S.cls))) { S.cls = null; const n = visibleClasses()[0]; if (n) switchClass(n.id); else syncClassBar(); return; }
    if (S.cls && S.cls._cloud) { applyClassCalib(); $("floorW").value = S.floor.w; $("floorD").value = S.floor.d; if (S.cls._synced) { const id = Q() && Q().id; sortQs(S.cls); const i = S.qs.findIndex((q) => q.id === id); if (i >= 0) S.cur = i; renderList(); } drawOv(); refresh(true); }
    syncClassBar(); setSync("ok"); if (S.live) applyFollow();
  }

  /* 套用遠端的題目（只監聽目前班級） */
  function watchActive() {
    if (S.unsubQ) { try { S.unsubQ(); } catch (e) {} S.unsubQ = null; }
    const c = S.cls; if (!cloudOn() || !c || !c._cloud) return;
    c._synced = false; c._h = c._h || { meta: "", q: {} };
    S.unsubQ = Cl().watchQuestions(c.id, (changes) => { if (S.cls === c) onRemoteQuestions(c, changes); }, (e) => setSync("err", e));
  }
  function onRemoteQuestions(c, changes) {
    stashAll(); const curId = Q() && Q().id; let touched = false;
    for (const ch of changes) {
      if (ch.pending) continue; // 自己剛寫出去的回聲
      if (ch.type === "removed") { const i = c.qs.findIndex((q) => q.id === ch.id); if (i >= 0) { c.qs.splice(i, 1); touched = true; } delete c._h.q[ch.id]; continue; }
      const d = ch.data; let q = c.qs.find((x) => x.id === ch.id);
      if (!q) { q = SM.Q.create(d.type || "spectrum", d.title, d.cfg); q.id = ch.id; q.res = {}; c.qs.push(q); touched = true; }
      const qh = c._h.q[q.id] || (c._h.q[q.id] = { cfg: "", res: {} });
      if (d.type) { // 題目設定：若本機有尚未推送的修改以本機為準，否則以雲端為準
        const hd = st8({ title: d.title, type: d.type, cfg: d.cfg }), hl = st8({ title: q.title, type: q.type, cfg: q.cfg });
        const dirty = qh.cfg !== "" && hl !== qh.cfg;
        if (!dirty) { if (hd !== hl) { q.title = d.title; q.type = d.type; q.cfg = d.cfg; touched = true; } qh.cfg = hd; }
      }
      for (const g of Object.keys(d.res || {})) {
        const remote = d.res[g], hr = st8(remote), local = q.res[g];
        if (hr === qh.res[g]) continue;                                   // 已是同步狀態
        if (local && qh.res[g] !== undefined && st8(local) !== qh.res[g]) continue; // 本機有尚未同步的修改：以本機為準，稍後會推送
        q.res[g] = remote; qh.res[g] = hr; touched = true;
      }
    }
    const firstSync = !c._synced; if (firstSync) { c._synced = true; touched = true; }
    if (c._qorder) sortQs(c);
    if (c._metaRemote) { c._h.meta = st8(metaOf(c)); c._h.qorder = st8(c.qs.map((q) => q.id)); } // 雲端已有這班的設定才視為已同步；新建的班級要等著被推送
    if (touched) { loadAll(); const i = S.qs.findIndex((q) => q.id === curId); S.cur = Math.max(0, i >= 0 ? i : Math.min(S.cur, S.qs.length - 1)); if (!S.qs.length) S.cur = 0; renderList(); if (Q()) { renderPanel(); drawOv(); refresh(true); } else { $("chart").getContext("2d").clearRect(0, 0, 9999, 9999); } }
    setSync("ok"); if (firstSync) scheduleSave(); // 補推在等待首次同步期間產生的本機變更
    if (S.live) applyFollow();
  }
  async function uploadLocal() {
    if (!guard()) return; const todo = S.classes.filter((c) => !c._cloud); if (!todo.length) return msg("沒有尚未上傳的本機班級。");
    if (!confirm("把這 " + todo.length + " 個本機班級（" + todo.map((c) => c.name).join("、") + "）上傳到雲端？\\n上傳後，所有裝置都能看到班級名稱、題目、各組圓點與人數（不含姓名與影像）。")) return;
    stashAll(); for (const c of todo) { c._cloud = true; c._synced = true; c._h = { meta: "", q: {} }; await pushClass(c); }
    watchActive(); syncClassBar(); msg("已上傳 " + todo.length + " 班到雲端。");
  }
  async function startCloud() {
    setSync("wait");
    await new Promise((res) => { let first = true; Cl().watchClasses((ch) => { onRemoteClasses(ch); if (first) { first = false; res(); } }, (e) => { setSync("err", e); if (first) { first = false; res(); } }); });
    if (S.cls && S.cls._cloud) watchActive();
    else if (!SM.Auth.isTeacher()) { const n = visibleClasses()[0]; if (n) await switchClass(n.id); }
  }

  /* ================= 班級／組別 ================= */
  const groupsOf = () => { const n = S.cls ? S.cls.groups : 4; return Array.from({ length: n }, (_, i) => String(i + 1)); };
  const validGroup = (g) => g === "all" || g === "merge" || groupsOf().includes(g);
  function stashAll() { if (S.cls) S.qs.forEach((q) => SM.Q.stash(q, S.group)); }
  function loadAll() { S.qs.forEach((q) => SM.Q.load(q, S.group, S.cls.groups)); }
  /* 校準以 0–1 比例座標存在「班級」底下：本班所有組別、所有題目共用，只需校準一次；
     換鏡頭解析度（長寬比相同）仍可沿用。舊版存的是像素座標，第一次讀取時自動換算。 */
  const toNorm = (c) => (c.corners || []).map((p) => (p[0] > 1.5 || p[1] > 1.5) && c.sz ? [p[0] / c.sz[0], p[1] / c.sz[1]] : p.slice());
  function applyClassCalib() {
    const c = S.cls; if (!c) return;
    S.floor = c.floor; $("floorW").value = c.floor.w; $("floorD").value = c.floor.d;
    const n = toNorm(c); c.corners = n; S.corners = [];
    if (n.length === 4 && S.sw) { const same = !c.sz || Math.abs(c.sz[0] / c.sz[1] - S.sw / S.sh) < 0.03; if (same) S.corners = n.map((p) => [p[0] * S.sw, p[1] * S.sh]); }
    rebuildH(); S.calibDirty = false; calibInfo();
  }
  function calibInfo() { const c = S.cls, saved = c && c.corners && c.corners.length === 4; $("calibInfo").textContent = !c ? "" : !saved ? "📐 本班尚未校準" : S.sw && !S.corners.length ? "📐 本班有校準，但目前畫面的長寬比不同，請重新校準" : "📐 本班已校準（套用於本班所有組別與題目）"; }
  function syncClassBar() {
    const cs = $("clsSel"); cs.innerHTML = ""; visibleClasses().forEach((c) => cs.append(h("option", { value: c.id }, c.name + (cloudOn() && !c._cloud ? "（僅本機）" : "")))); if (S.cls) cs.value = S.cls.id;
    const gs = $("grpSel"); gs.innerHTML = ""; groupsOf().forEach((g) => gs.append(h("option", { value: g }, SM.Q.groupName(g)))); gs.append(h("option", { value: "all" }, "全班同場（一次站完）"), h("option", { value: "merge" }, "合併檢視（第1–" + groupsOf().length + "組相加・唯讀）")); gs.value = S.group;
    $("grpN").value = S.cls ? S.cls.groups : 4;
  }
  function afterSwitch() { publishLive(false); S.undo = []; S.stab.reset(); S.boxes = []; if (S.tool === "center") setTool(null); syncClassBar(); renderList(); renderPanel(); drawOv(); refresh(); }
  function setGroup(g) { if (g === S.group || !validGroup(g)) return syncClassBar(); stopLoop(); stashAll(); S.group = g; loadAll(); afterSwitch(); msg(g === "merge" ? "合併檢視：把第 1–" + groupsOf().length + " 組的圓點相加；唯讀。" : "已切到「" + SM.Q.groupName(g) + "」。"); }
  async function switchClass(id) {
    if (S.cls && id === S.cls.id) return; stopLoop(); await saveClass();
    const c = S.classes.find((x) => x.id === id); if (!c) return;
    S.cls = c; S.qs = c.qs; S.cur = Math.min(c.cur || 0, S.qs.length - 1); S.group = c.group && c.group !== "merge" && validGroup(c.group) ? c.group : "1"; S.filter = ""; $("qSearch").value = "";
    loadAll(); applyClassCalib(); watchActive(); afterSwitch(); msg("已切換到「" + c.name + "」。" + (c.corners.length === 4 && !calibrated() && S.sw ? "（這班儲存的校準與目前畫面大小不同，請重新校準。）" : ""));
  }
  const tplConfigs = () => S.meta.template || SM.Q.configsOf(SM.Q.sampleSet());
  async function addClasses(names) {
    const made = names.map((n) => SM.Q.newClass(n, tplConfigs(), 4)); if (!made.length) return;
    if (S.cls && toNorm(S.cls).length === 4) made.forEach((c) => { c.corners = toNorm(S.cls); c.sz = S.cls.sz; c.floor = { w: S.cls.floor.w, d: S.cls.floor.d }; }); // 同一間教室：新班級自動沿用校準
    made.forEach((c) => { if (cloudOn()) { c._cloud = true; c._synced = true; c._h = { meta: "", q: {} }; } S.classes.push(c); if (!S.noSave) SM.Store.putClass(c); });
    S.classes.sort((a, b) => a.created - b.created); await switchClass(made[0].id); for (const c of made) await pushClass(c); syncClassBar();
  }
  $("clsSel").onchange = (e) => switchClass(e.target.value);
  $("grpSel").onchange = (e) => setGroup(e.target.value);
  $("grpN").onchange = (e) => { const n = +e.target.value; if (n < S.cls.groups && S.qs.some((q) => Object.keys(q.res).some((g) => +g > n && q.res[g] && q.res[g].pts && q.res[g].pts.length)) && !confirm("減少組數不會刪除資料，但第 " + (n + 1) + " 組以後會在清單中隱藏（調回即可看到）。繼續？")) return syncClassBar(); stashAll(); S.cls.groups = n; if (!validGroup(S.group)) S.group = "1"; loadAll(); afterSwitch(); };
  $("cNew").onclick = () => { if (!guard()) return; const t = prompt("輸入班級名稱（要一次建立多個，用逗號或換行分隔，例如：701,702,703）", ""); if (!t) return; const names = t.split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean); addClasses(names); };
  $("cRen").onclick = () => { if (!guard()) return; const t = prompt("班級名稱", S.cls.name); if (t && t.trim()) { S.cls.name = t.trim(); syncClassBar(); refresh(true); } };
  $("cDel").onclick = async () => {
    if (!guard()) return;
    if (!confirm("刪除班級「" + S.cls.name + "」？它所有組別的結果與快照都會刪除，無法復原。\n（建議先按「匯出本班」備份）")) return;
    const id = S.cls.id, wasCloud = S.cls._cloud; stopLoop(); if (cloudOn() && wasCloud) { try { await Cl().deleteClass(id); } catch (e) { return setSync("err", e); } } S.classes = S.classes.filter((c) => c.id !== id); if (!S.noSave) await SM.Store.delClass(id);
    S.cls = null; if (!visibleClasses().length) { const c = SM.Q.newClass("第1班", tplConfigs(), 4); S.classes.push(c); if (!S.noSave) SM.Store.putClass(c); }
    await switchClass(visibleClasses()[0].id); syncClassBar();
  };
  $("cCalAll").onclick = async () => {
    if (!guard()) return; await saveClass(); const n = toNorm(S.cls);
    if (n.length !== 4) return msg("本班還沒校準。請先開啟鏡頭（或照片）按「① 校準地板」。");
    if (!confirm("把「" + S.cls.name + "」的校準（地板四角與實際大小）套用到全部 " + S.classes.length + " 個班級？\n（只適用於同一間教室、同一個鏡頭位置；各班原本的校準會被取代，題目與結果不受影響）")) return;
    for (const c of S.classes) { if (c === S.cls) continue; c.corners = n.map((p) => p.slice()); c.sz = S.cls.sz; c.floor = { w: S.cls.floor.w, d: S.cls.floor.d }; if (!S.noSave) await SM.Store.putClass(SM.Q.plainClass(c, c.qs)); }
    msg("已把校準套用到全部 " + S.classes.length + " 個班級。");
  };
  $("cUpload").onclick = uploadLocal;
  $("cTplSave").onclick = () => { S.meta.template = SM.Q.configsOf(S.qs); scheduleSave(); msg("已把本班的 " + S.qs.length + " 題存為「範本題組」。之後新增班級會自動套用。"); };
  $("cTplApply").onclick = () => { if (!guard()) return; if (!confirm("用範本題組取代本班全部題目？本班各組結果與快照會被清除。")) return; S.qs = SM.Q.fromConfigs(tplConfigs()); S.cls.qs = S.qs; S.cur = 0; afterSwitch(); msg("已套用範本題組（" + S.qs.length + " 題）。"); };
  $("qSearch").oninput = (e) => { S.filter = e.target.value; renderList(); };

  /* 備份 / 匯入 */
  const stamp = () => new Date().toISOString().slice(0, 10);
  $("cExp").onclick = () => { SM.Q.download("社會計量班級_" + S.cls.name + "_" + stamp() + ".json", JSON.stringify({ format: "sociometry-class", v: 1, class: plainNow() }), "application/json"); msg("已匯出本班備份（JSON）。請存放在你自己的電腦，不要上傳公開網站。"); };
  $("cBackup").onclick = async () => { await saveClass(); const all = S.classes.map((c) => (c === S.cls ? plainNow() : SM.Q.plainClass(c, c.qs))); SM.Q.download("社會計量全部備份_" + stamp() + ".json", JSON.stringify({ format: "sociometry-backup", v: 1, exported: new Date().toISOString(), template: S.meta.template, classes: all }), "application/json"); msg("已匯出全部 " + all.length + " 班備份。請存放在你自己的電腦，不要上傳公開網站。"); };
  $("cImp").onclick = () => { if (guard()) $("cFile").click(); };
  $("cFile").onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text()), list = d.format === "sociometry-backup" ? d.classes : d.format === "sociometry-class" ? [d.class] : null; if (!list) throw new Error("不是本工具的備份檔");
      let first = null, n = 0; await saveClass();
      for (const c of list) {
        const i = S.classes.findIndex((x) => x.id === c.id);
        if (i >= 0 && !confirm("已有同一個班級「" + S.classes[i].name + "」。要用備份覆蓋嗎？（取消＝略過這班）")) continue;
        c.groups = c.groups || 4; c.corners = c.corners || []; c.floor = c.floor || { w: 8, d: 6 }; if (i >= 0) { if (S.cls && S.cls.id === c.id) S.cls = null; S.classes[i] = c; } else S.classes.push(c);
        if (!S.noSave) await SM.Store.putClass(c); first = first || c; n++;
      }
      if (d.template && !S.meta.template) S.meta.template = d.template;
      if (first) { S.cls = null; await switchClass(first.id); } syncClassBar(); msg("已匯入 " + n + " 班。");
    } catch (err) { msg("匯入失敗：" + err.message); } e.target.value = "";
  };
  $("cCsvAll").onclick = async () => { await saveClass(); const all = S.classes.map((c) => (c === S.cls ? plainNow() : SM.Q.plainClass(c, c.qs))); if (!SM.Q.snapCount(all)) return msg("還沒有任何快照。"); SM.Q.download("社會計量_全部班級_" + stamp() + ".csv", SM.Q.toCSV(all)); msg("已匯出全部班級 CSV（" + SM.Q.snapCount(all) + " 筆快照）。"); };

  /* 鍵盤 */
  addEventListener("keydown", (e) => {
    if (S.live) { if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen().catch(() => {}); return; } // 跟隨投影頁沒有任何操作快速鍵
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
    else if (e.key === "ArrowRight") selectQ(S.cur + 1); else if (e.key === "ArrowLeft") selectQ(S.cur - 1);
    else if (/^[1-9]$/.test(e.key) && +e.key <= S.cls.groups) setGroup(e.key); else if (e.key === "a" || e.key === "A") setGroup("all"); else if (e.key === "m" || e.key === "M") setGroup("merge");
    else if (e.key === "s" || e.key === "S") $("bScan").click(); else if (e.key === "l" || e.key === "L") $("bLock").click();
    else if (e.key === "e" || e.key === "E") $("bEdit").click(); else if (e.key === "p" || e.key === "P") $("bProj").click();
  });

  /* ================= 啟動 ================= */
  async function boot() {
    const P = new URLSearchParams(location.search); S.noSave = P.has("fresh") || isLive; // fresh=1：測試模式，不讀也不寫儲存；#live 跟隨投影頁也不寫任何東西
    let meta = null;
    if (!S.noSave) {
      const mode = await SM.Store.init(); try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
      S.classes = (await SM.Store.allClasses()).sort((a, b) => a.created - b.created); meta = await SM.Store.getMeta("app");
      if (!S.classes.length) { const leg = SM.Q.migrateLegacy && SM.Q.migrateLegacy(); if (leg) { S.classes.push(leg.cls); if (leg.settings) meta = Object.assign(meta || {}, { settings: leg.settings }); await SM.Store.putClass(leg.cls); } }
      if (mode === "ls") msg("⚠ 這個瀏覽器不能用 IndexedDB，改用 localStorage（容量較小）。請定期「全部備份」。");
    }
    await SM.Auth.init(); applyAuth();
    if (P.get("fakecloud")) { try { await SM.loadScript(["tools/fakecloud.js"]); } catch (e) { console.warn(e); } }
    if (!P.has("fresh") || P.get("fakecloud")) { if (await Cl().init()) SM.Auth.useCloud(); }
    if (meta) { Object.assign(S.settings, meta.settings || {}); S.meta.template = meta.template || null; }
    if (!SM.MODELS[S.settings.model]) S.settings.model = "yolov10s";
    if (!navigator.gpu && !(meta && meta.settings) && S.settings.model === "yolov10s") S.settings.model = "yolov10n"; // 沒有 WebGPU 時 WASM 較慢
    if (!S.classes.length) S.classes.push(SM.Q.newClass(S.noSave ? "測試班" : "第1班", tplConfigs(), 4));
    const want = meta && S.classes.find((c) => c.id === meta.cur);
    S.cls = want || S.classes[0]; S.qs = S.cls.qs; S.cur = Math.min(S.cls.cur || 0, S.qs.length - 1);
    S.group = S.cls.group && S.cls.group !== "merge" && validGroup(S.cls.group) ? S.cls.group : "1";
    loadAll(); initSettings(); applyClassCalib(); syncClassBar(); renderList(); renderPanel(); hint(); refresh();

    /* 測試用網址參數：?img=照片 &cal=8 個 0–1 的角點 &q=題序 &g=組別 &fresh=1(不讀寫儲存) */
    if (P.has("g") && validGroup(P.get("g"))) setGroup(P.get("g"));
    if (P.has("q")) selectQ(+P.get("q") - 1);
    S.imgReady = () => {
      if (P.has("cal")) { const a = P.get("cal").split(",").map(Number); S.corners = [0, 1, 2, 3].map((i) => [a[2 * i] * S.sw, a[2 * i + 1] * S.sh]); rebuildH(); }
      drawOv(); refresh(); S.imgReady = null;
    };
    if (P.get("img")) loadImg(P.get("img"));
    S.ready = true;
    if (cloudOn()) await startCloud(); setSync("ok"); applyAuth(); renderPanel();
    if (isLive) {
      addEventListener("dblclick", () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });
      if (!cloudOn()) { liveDraw(null); msg("跟隨投影需要雲端同步（請確認 js/config.js 的 firebase 設定與網路）。"); return; }
      addEventListener("resize", () => { if (Q()) refresh(true); else liveDraw(null); });
      Cl().watchLive((d) => { S.follow = d; applyFollow(); }, (e) => setSync("err", e));
      liveDraw(Q() && S.follow ? buildView(Q()) : null);
    }
  }
  try { S.devName = sessionStorage.getItem("sm.dev") || ("裝置" + Math.random().toString(36).slice(2, 5).toUpperCase()); sessionStorage.setItem("sm.dev", S.devName); } catch (e) { S.devName = "裝置"; }
  $("liveMode").onchange = (e) => { S.liveMode = e.target.value; if (S.liveMode === "always") publishLive(true); };
  $("bLive").onclick = () => { if (!cloudOn()) return msg("跟隨投影需要雲端同步（目前是僅本機模式）。"); window.open(location.href.split("#")[0].split("?")[0] + "#live", "sociometry_live", "popup,width=1280,height=720"); msg("已開啟跟隨投影：它會自動顯示「任何電腦正在操作」的那一題，連續掃描的結果即時更新。把它拖到投影幕並雙擊全螢幕；這個頁面不用登入。"); };
  window.SMApp = { S, scanOnce, refresh, buildView, selectQ, rebuildH, drawOv, toFloor, snapshot, setGroup, switchClass, addClasses, saveClass, plainNow, boot: () => S.bootP };
  S.bootP = boot();
})();
