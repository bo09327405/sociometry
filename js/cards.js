/* 輔助：色卡辨識（從原型移植）。把影像縮到 720px 寬，用色相／飽和度分類，
   再扣掉「背景基準」影像中本來就有的顏色（木地板、淺藍制服會造成大量誤判，所以建議一定要拍基準）。 */
(function () {
  const SM = window.SM;
  const COLORS = [{ k: "red", c: "#e4572e" }, { k: "green", c: "#5cb85c" }, { k: "yellow", c: "#f2c94c" }, { k: "blue", c: "#4a9fd8" }];
  const C = (SM.Cards = { base: null, samples: {}, sampling: -1, params: { hueTol: 14, sat: 0.55, minA: 10 } });
  function hsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
  C.grab = function (src, sw, sh) { const sc = Math.min(1, 720 / sw), w = Math.round(sw * sc), h = Math.round(sh * sc); const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(src, 0, 0, w, h); return { sc, w, h, d: cx.getImageData(0, 0, w, h).data }; };
  C.setBase = (src, sw, sh) => { C.base = C.grab(src, sw, sh); };
  C.sampleAt = function (src, x, y) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 7; const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(src, x - 3, y - 3, 7, 7, 0, 0, 7, 7);
    const d = c.getImageData(0, 0, 7, 7).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, hh = hsv(r / n, g / n, b / n); C.samples[COLORS[C.sampling].k] = { h: hh[0], s: hh[1], v: hh[2] }; C.sampling++;
    if (C.sampling >= 4) C.sampling = -1; return C.sampling;
  };
  /* roi: 影像像素座標 [x0,y0,x1,y1]；回傳 {counts:[4], pts:[{x,y,r,c}]} */
  C.detect = function (src, sw, sh, roiImg) {
    const g = C.grab(src, sw, sh), sc = g.sc, w = g.w, h = g.h, d = g.d, B = C.base && C.base.w === w && C.base.h === h ? C.base.d : null;
    const roi = roiImg ? roiImg.map((v) => v * sc) : [0, 0, w, h], { hueTol, sat: sMin, minA } = C.params;
    const lab = new Int8Array(w * h).fill(-1), rng = { red: (x) => x < 14 || x > 345, yellow: (x) => x >= 42 && x <= 68, green: (x) => x >= 88 && x <= 165, blue: (x) => x >= 195 && x <= 255 };
    for (let y = Math.max(0, Math.floor(roi[1])); y < Math.min(h, roi[3]); y++) for (let x = Math.max(0, Math.floor(roi[0])); x < Math.min(w, roi[2]); x++) {
      const i = (y * w + x) * 4; if (B && Math.abs(d[i] - B[i]) + Math.abs(d[i + 1] - B[i + 1]) + Math.abs(d[i + 2] - B[i + 2]) < 70) continue;
      const [hh, s, v] = hsv(d[i], d[i + 1], d[i + 2]); if (v < 0.3) continue;
      let best = -1, bd = 1e9;
      for (let k = 0; k < 4; k++) { const sm = C.samples[COLORS[k].k]; if (sm) { let dh = Math.abs(hh - sm.h); dh = Math.min(dh, 360 - dh); if (dh <= hueTol && s >= 0.7 * sm.s && v >= 0.6 * sm.v && dh < bd) { bd = dh; best = k; } } else if (rng[COLORS[k].k](hh) && s >= sMin) { best = k; break; } }
      if (best >= 0) lab[y * w + x] = best;
    }
    const seen = new Uint8Array(w * h), out = [], counts = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (lab[p] < 0 || seen[p]) continue; const k = lab[p], st = [p]; seen[p] = 1; let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (st.length) { const q = st.pop(); n++; const qx = q % w, qy = (q - qx) / w; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const np = ny * w + nx; if (!seen[np] && lab[np] === k) { seen[np] = 1; st.push(np); } } }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n >= minA && n >= 0.35 * bw * bh && bw < w * 0.2 && bh < h * 0.2) { counts[k]++; out.push({ x: (x0 + x1) / 2 / sc, y: (y0 + y1) / 2 / sc, r: Math.max(bw, bh) / 2 / sc + 4, c: COLORS[k].c }); }
    }
    return { counts, pts: out };
  };
  C.COLORS = COLORS;
})();
