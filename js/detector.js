/* 偵測引擎：YOLOv10（ONNX Runtime Web，WebGPU→WASM）或 COCO-SSD（TensorFlow.js）。
   做法：把「地板＋站立人影的範圍」切成有重疊的分塊，每塊各自偵測，
   丟掉貼著分塊內側邊界的被切斷框，再做 NMS 合併。影像全程只在本機記憶體處理。 */
(function () {
  const SM = window.SM;
  const ORT_VER = "1.20.1";
  const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/";
  const MODELS = {
    yolov10n: { label: "YOLOv10n（9 MB，較快）", kind: "yolo", file: "models/yolov10n.onnx",
      url: "https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx" },
    yolov10s: { label: "YOLOv10s（29 MB，較準）", kind: "yolo", file: "models/yolov10s.onnx",
      url: "https://huggingface.co/onnx-community/yolov10s/resolve/main/onnx/model.onnx" },
    cocossd: { label: "COCO-SSD（舊版，較不準）", kind: "coco" },
  };
  SM.MODELS = MODELS;

  const D = (SM.Detector = {
    sessions: {}, ortReady: null, cocoModel: null, backend: "", userBuffers: {},
    lastInfo: "",
  });

  /* 使用者手動選的本機模型檔（file:// 無法 fetch 相對路徑時使用） */
  D.setUserModel = async function (key, file) { D.userBuffers[key] = await file.arrayBuffer(); delete D.sessions[key]; };

  async function loadOrt() {
    if (D.ortReady) return D.ortReady;
    D.ortReady = (async () => {
      await SM.loadScript(["vendor/ort.webgpu.min.js", ORT_CDN + "ort.webgpu.min.js"]);
      const local = location.protocol !== "file:";
      ort.env.wasm.wasmPaths = ORT_CDN; // 離線時由 tools/offline_setup.py 放到 vendor/ 並改用 vendor/
      if (local) { try { const r = await fetch("vendor/ort-wasm-simd-threaded.jsep.wasm", { method: "HEAD" }); if (r.ok) ort.env.wasm.wasmPaths = new URL("vendor/", location.href).href; } catch (e) {} }
      ort.env.wasm.numThreads = (self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1);
    })();
    return D.ortReady;
  }

  async function fetchModel(key) {
    const m = MODELS[key];
    if (D.userBuffers[key]) return D.userBuffers[key];
    const tryFetch = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); };
    if (location.protocol !== "file:") { try { return await tryFetch(m.file); } catch (e) {} }
    return tryFetch(m.url);
  }

  D.ensure = async function (key, onStatus) {
    const m = MODELS[key];
    if (m.kind === "yolo") {
      if (D.sessions[key]) return D.sessions[key];
      onStatus && onStatus("載入偵測模型 " + m.label + "…（第一次需要下載，之後會快取）");
      await loadOrt();
      const buf = await fetchModel(key);
      let sess = null, lastErr = null;
      for (const ep of D.forceBackend ? [D.forceBackend] : ["webgpu", "wasm"]) {
        try { sess = await ort.InferenceSession.create(buf, { executionProviders: [ep], graphOptimizationLevel: "all" }); D.backend = ep; break; }
        catch (e) { lastErr = e; }
      }
      if (!sess) throw lastErr;
      D.sessions[key] = sess;
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 640;
      D.work = canvas; D.workCtx = canvas.getContext("2d", { willReadFrequently: true });
      return sess;
    }
    if (D.cocoModel) return D.cocoModel;
    onStatus && onStatus("載入 COCO-SSD…");
    await SM.loadScript(["vendor/tf.min.js", "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"]);
    await SM.loadScript(["vendor/coco-ssd.min.js", "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"]);
    D.cocoModel = await cocoSsd.load({ base: "mobilenet_v2" });
    D.backend = "tfjs";
    return D.cocoModel;
  };

  /* ---- 單一分塊偵測。回傳 [{x,y,w,h,s}]（座標相對於分塊） ---- */
  async function detectYolo(sess, src, sx, sy, sw, sh, thr) {
    const S = 640, sc = Math.min(S / sw, S / sh), nw = Math.round(sw * sc), nh = Math.round(sh * sc);
    const px = Math.floor((S - nw) / 2), py = Math.floor((S - nh) / 2);
    const c = D.workCtx;
    c.fillStyle = "#727272"; c.fillRect(0, 0, S, S);
    c.drawImage(src, sx, sy, sw, sh, px, py, nw, nh);
    const d = c.getImageData(0, 0, S, S).data, n = S * S, f = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { f[i] = d[j] / 255; f[n + i] = d[j + 1] / 255; f[2 * n + i] = d[j + 2] / 255; }
    const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, S, S]) });
    const o = out[sess.outputNames[0]], dims = o.dims, a = o.data, res = [];
    const push = (x1, y1, x2, y2, s) => {
      x1 = (x1 - px) / sc; x2 = (x2 - px) / sc; y1 = (y1 - py) / sc; y2 = (y2 - py) / sc;
      res.push({ x: Math.max(0, x1), y: Math.max(0, y1), w: Math.min(sw, x2) - Math.max(0, x1), h: Math.min(sh, y2) - Math.max(0, y1), s });
    };
    if (dims[2] === 6) { // YOLOv10：[1,300,6] = x1,y1,x2,y2,score,class（已內建去重）
      for (let i = 0; i < dims[1]; i++) { const k = i * 6; if (a[k + 5] === 0 && a[k + 4] >= thr) push(a[k], a[k + 1], a[k + 2], a[k + 3], a[k + 4]); }
    } else { // YOLOv8/11：[1,84,N]，需自行 NMS
      const N = dims[2];
      for (let i = 0; i < N; i++) { const s = a[4 * N + i]; if (s >= thr) { const cx = a[i], cy = a[N + i], w = a[2 * N + i], h = a[3 * N + i]; push(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, s); } }
    }
    return res;
  }
  async function detectCoco(m, src, sx, sy, sw, sh, thr) {
    const k = Math.min(1, 1024 / sw), w = Math.round(sw * k), h = Math.round(sh * k);
    const cv = D.cocoCv || (D.cocoCv = document.createElement("canvas")); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const r = await m.detect(cv, 60, thr);
    return r.filter((q) => q.class === "person").map((q) => ({ x: q.bbox[0] / k, y: q.bbox[1] / k, w: q.bbox[2] / k, h: q.bbox[3] / k, s: q.score }));
  }

  /* ---- NMS：IoU 或「小框被大框包住」都視為重複 ---- */
  function nms(boxes, iouT, containT) {
    boxes.sort((a, b) => b.s - a.s);
    const keep = [];
    for (const b of boxes) {
      let dup = false;
      for (const k of keep) {
        const x1 = Math.max(b.x, k.x), y1 = Math.max(b.y, k.y), x2 = Math.min(b.x + b.w, k.x + k.w), y2 = Math.min(b.y + b.h, k.y + k.h);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        if (!inter) continue;
        const iou = inter / (b.w * b.h + k.w * k.h - inter), cont = inter / Math.min(b.w * b.h, k.w * k.h);
        if (iou > iouT || cont > containT) { dup = true; break; }
      }
      if (!dup) keep.push(b);
    }
    return keep;
  }
  SM.nms = nms;

  /* ---- 對外：偵測整個範圍 ----
     opts: {model, tiles:"2x2", thr, roi:[x,y,w,h], overlap, iou, contain}
     回傳 {boxes:[{x,y,w,h,s}], ms, backend} （座標＝來源影像像素） */
  D.detect = async function (src, W, H, opts, onStatus) {
    const key = opts.model, m = MODELS[key], engine = await D.ensure(key, onStatus);
    const roi = opts.roi || [0, 0, W, H];
    const [cn, rn] = (opts.tiles || "2x2").split("x").map(Number);
    const ov = opts.overlap ?? 0.25;
    const tw = roi[2] / (cn - (cn - 1) * ov), th = roi[3] / (rn - (rn - 1) * ov);
    const t0 = performance.now();
    let all = [];
    for (let j = 0; j < rn; j++) for (let i = 0; i < cn; i++) {
      const x0 = Math.min(roi[0] + i * tw * (1 - ov), roi[0] + roi[2] - tw), y0 = Math.min(roi[1] + j * th * (1 - ov), roi[1] + roi[3] - th);
      const r = m.kind === "yolo" ? await detectYolo(engine, src, x0, y0, tw, th, opts.thr) : await detectCoco(engine, src, x0, y0, tw, th, opts.thr);
      const e = Math.max(3, Math.min(tw, th) * 0.012); // 貼近「內側」分塊邊界 → 多半是被切斷的框，鄰塊會有完整的
      for (const b of r) {
        if ((i > 0 && b.x < e) || (j > 0 && b.y < e) || (i < cn - 1 && b.x + b.w > tw - e) || (j < rn - 1 && b.y + b.h > th - e)) continue;
        all.push({ x: b.x + x0, y: b.y + y0, w: b.w, h: b.h, s: b.s });
      }
      await SM.sleep(0);
    }
    const boxes = nms(all, opts.iou ?? 0.5, opts.contain ?? 0.8);
    return { boxes, ms: performance.now() - t0, backend: D.backend };
  };

  /* ---- 腳點估計 ----
     bottom：框底中點（預設；高處斜拍、腿沒被擋住時最直接）
     occl：實驗性。若框高/框寬偏小（下半身被前排擋住），假設站立者高約為寬的 2.4 倍往下補。尚未用真實站位驗證。 */
  SM.footPoint = function (b, mode, W, H) {
    let y = b.y + b.h;
    if (mode === "occl" && b.h < b.w * 2.4) y = Math.min(H, b.y + b.w * 2.4);
    return { x: b.x + b.w / 2, y };
  };
})();
