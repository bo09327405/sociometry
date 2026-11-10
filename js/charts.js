/* 圖表繪製（主畫面預覽與投影視窗共用）。輸入 v 是可序列化的「檢視資料」。
   光譜 → 長條圖（綠→紅）；矩陣 → 方塊圖；關係距離 → 同心圓；色卡 → 長條圖 */
(function () {
  const SM = window.SM;
  const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const BG = "#0d1017", FG = "#ffffff", MUTE = "#b9c2d3";
  const RING_COLORS = ["#ff7a45", "#ffb02e", "#f2e04a", "#7bd88f", "#5fb4ff", "#9b8cff"];
  SM.RING_COLORS = RING_COLORS;

  function fit(c, text, maxW, size, weight) { // 文字太長時縮小字級
    c.font = (weight || "") + " " + size + "px " + FONT;
    const w = c.measureText(text).width;
    return w > maxW ? size * maxW / w : size;
  }
  function header(c, W, H, v) {
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    c.textBaseline = "middle"; c.textAlign = "left"; c.fillStyle = FG;
    const totalTxt = v.total + " 人";
    c.font = "bold " + H * 0.075 + "px " + FONT; const tw = c.measureText(totalTxt).width;
    const sz = fit(c, v.title || "", W * 0.92 - tw, H * 0.075, "bold");
    c.font = "bold " + sz + "px " + FONT; c.fillStyle = FG; c.fillText(v.title || "", W * 0.04, H * 0.075);
    c.textAlign = "right"; c.fillStyle = "#ffc24a"; c.font = "bold " + H * 0.075 + "px " + FONT; c.fillText(totalTxt, W * 0.96, H * 0.075);
    if (v.locked) { c.font = "bold " + H * 0.03 + "px " + FONT; c.fillStyle = "#7bd88f"; c.fillText("✓ 已鎖定", W * 0.96, H * 0.135); }
  }
  const pct = (n, t) => (t ? Math.round((n * 100) / t) + "%" : "");

  function bars(c, W, H, v, colorOf) {
    const n = v.counts.length, gx = W * 0.05, gw = W * 0.9, gy = H * 0.2, gh = H * 0.5, bw = gw / n, max = Math.max(1, ...v.counts);
    c.strokeStyle = "#3a4356"; c.lineWidth = Math.max(2, H * 0.004); c.beginPath(); c.moveTo(gx, gy + gh); c.lineTo(gx + gw, gy + gh); c.stroke();
    v.counts.forEach((cnt, i) => {
      const h = gh * cnt / max, x = gx + i * bw + bw * 0.1, w = bw * 0.8;
      c.fillStyle = colorOf(i, n); c.fillRect(x, gy + gh - h, w, h);
      c.textAlign = "center"; c.fillStyle = FG; c.font = "bold " + Math.min(bw * 0.5, H * 0.11) + "px " + FONT;
      c.fillText(cnt, x + w / 2, gy + gh - h - H * 0.045);
      c.font = Math.min(bw * 0.3, H * 0.05) + "px " + FONT; c.fillStyle = MUTE;
      c.fillText(pct(cnt, v.total), x + w / 2, gy + gh + H * 0.04);
    });
  }

  const drawers = {
    spectrum(c, W, H, v) {
      header(c, W, H, v);
      bars(c, W, H, v, (i, n) => "hsl(" + (130 - 130 * (n > 1 ? i / (n - 1) : 0)) + ",72%,52%)");
      const y = H * 0.87, gx = W * 0.05, gw = W * 0.9, sz = Math.min(H * 0.085, W * 0.06);
      c.font = "bold " + sz + "px " + FONT;
      const wa = c.measureText(v.endA || "").width, wb = c.measureText(v.endB || "").width;
      c.textAlign = "left"; c.fillStyle = "#7bd88f"; c.fillText(v.endA || "", gx, y);
      c.textAlign = "right"; c.fillStyle = "#ff7a5c"; c.fillText(v.endB || "", gx + gw, y);
      c.strokeStyle = "#8793a8"; c.lineWidth = Math.max(3, H * 0.006);
      const x1 = gx + wa + W * 0.03, x2 = gx + gw - wb - W * 0.03;
      if (x2 > x1 + 20) { c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.moveTo(x2 - H * 0.025, y - H * 0.02); c.lineTo(x2, y); c.lineTo(x2 - H * 0.025, y + H * 0.02); c.stroke(); }
    },
    cards(c, W, H, v) {
      header(c, W, H, v);
      const cols = SM.CARD_COLORS.map((x) => x.c);
      bars(c, W, H, v, (i) => cols[i % cols.length]);
      const n = v.counts.length, gx = W * 0.05, bw = W * 0.9 / n;
      c.textAlign = "center"; c.fillStyle = FG;
      v.labels.forEach((l, i) => { const s = fit(c, l, bw * 0.92, H * 0.07, "bold"); c.font = "bold " + s + "px " + FONT; c.fillText(l, gx + i * bw + bw / 2, H * 0.86); });
    },
    matrix(c, W, H, v) {
      header(c, W, H, v);
      const gx = W * 0.04, gy = H * 0.16, gw = W * 0.92, gh = H * 0.8, cw = gw / v.cols, ch = gh / v.rows, max = Math.max(1, ...v.counts), top = Math.max(...v.counts);
      v.counts.forEach((n, i) => {
        const x = gx + (i % v.cols) * cw, y = gy + Math.floor(i / v.cols) * ch, a = 0.15 + 0.7 * n / max;
        c.fillStyle = "rgba(60,160,255," + a + ")"; c.fillRect(x + 5, y + 5, cw - 10, ch - 10);
        c.strokeStyle = n === top && n > 0 ? "#ffc24a" : "#4a5468"; c.lineWidth = n === top && n > 0 ? 6 : 2; c.strokeRect(x + 5, y + 5, cw - 10, ch - 10);
        c.textAlign = "center"; c.fillStyle = FG; c.font = "bold " + Math.min(ch * 0.42, cw * 0.4, H * 0.22) + "px " + FONT;
        c.fillText(n, x + cw / 2, y + ch * 0.4);
        const l = v.labels[i] || "", s = fit(c, l, cw * 0.88, Math.min(ch * 0.17, H * 0.085), "bold");
        c.font = "bold " + s + "px " + FONT; c.fillText(l, x + cw / 2, y + ch * 0.72);
        c.font = Math.min(ch * 0.1, H * 0.05) + "px " + FONT; c.fillStyle = "#dbe6ff"; c.fillText(pct(n, v.total), x + cw / 2, y + ch * 0.89);
      });
    },
    distance(c, W, H, v) {
      header(c, W, H, v);
      const nb = v.counts.length, cx = W * 0.3, cy = H * 0.56, R = Math.min(W * 0.27, H * 0.38), step = R / nb;
      for (let i = nb - 1; i >= 0; i--) {
        c.beginPath(); c.arc(cx, cy, step * (i + 1), 0, 7);
        c.fillStyle = "rgba(255,255,255," + (0.03 + 0.012 * (nb - i)) + ")"; c.fill();
        c.strokeStyle = i === nb - 1 ? "#6b7a94" : "#4d5b73"; c.lineWidth = Math.max(2, H * 0.004);
        c.setLineDash(i === nb - 1 ? [H * 0.015, H * 0.012] : []); c.stroke(); c.setLineDash([]);
      }
      if (v.needCenter) { c.textAlign = "center"; c.fillStyle = "#ffb02e"; c.font = "bold " + H * 0.05 + "px " + FONT; c.fillText("尚未設定圓心", cx, cy - R * 0.5); }
      (v.dots || []).forEach((d) => {
        const rr = step * (d.ring + Math.min(1, Math.max(0.12, d.frac))) , x = cx + Math.cos(d.ang) * rr, y = cy + Math.sin(d.ang) * rr;
        c.beginPath(); c.arc(x, y, Math.max(5, H * 0.017), 0, 7); c.fillStyle = RING_COLORS[Math.min(d.ring, RING_COLORS.length - 1)]; c.fill();
        c.strokeStyle = "#0d1017"; c.lineWidth = 2; c.stroke();
      });
      c.beginPath(); c.arc(cx, cy, Math.max(7, H * 0.022), 0, 7); c.fillStyle = "#fff"; c.fill();
      c.textAlign = "center"; c.fillStyle = "#0d1017"; c.font = "bold " + H * 0.02 + "px " + FONT;
      c.fillStyle = FG; c.font = "bold " + Math.min(H * 0.05, R * 0.3) + "px " + FONT;
      c.fillText(v.centerLabel || "圓心", cx, cy + Math.max(H * 0.06, R * 0.1) + 6);
      // 右側圖例：每圈人數
      const lx = W * 0.6, ly = H * 0.2, lh = H * 0.7 / nb, max = Math.max(1, ...v.counts);
      v.counts.forEach((n, i) => {
        const y = ly + i * lh, col = RING_COLORS[Math.min(i, RING_COLORS.length - 1)];
        c.textAlign = "left"; c.fillStyle = col; c.beginPath(); c.arc(lx + H * 0.02, y + lh * 0.3, H * 0.02, 0, 7); c.fill();
        c.fillStyle = FG; const l = v.labels[i] || "", s = fit(c, l, W * 0.34, H * 0.055, "bold"); c.font = "bold " + s + "px " + FONT; c.fillText(l, lx + H * 0.06, y + lh * 0.3);
        const bwid = (W * 0.2) * n / max; c.fillStyle = col; c.fillRect(lx, y + lh * 0.56, Math.max(2, bwid), lh * 0.2);
        c.textAlign = "left"; c.fillStyle = FG; c.textBaseline = "middle"; c.font = "bold " + Math.min(lh * 0.36, H * 0.07) + "px " + FONT; c.fillText(n + " 人", lx + Math.max(2, bwid) + H * 0.02, y + lh * 0.66);
      });
    },
  };

  SM.Charts = {
    draw(cv, v, waitText) {
      const c = cv.getContext("2d"), W = cv.width, H = cv.height;
      if (!v) { c.fillStyle = BG; c.fillRect(0, 0, W, H); c.fillStyle = MUTE; c.font = H * 0.05 + "px " + FONT; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(waitText || "等待主畫面傳送資料…", W * 0.04, H * 0.1); return; }
      (drawers[v.type] || drawers.spectrum)(c, W, H, v);
      if (v.sub) { c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = "#8793a8"; c.font = H * 0.028 + "px " + FONT; c.fillText(v.sub, W * 0.04, H * 0.975); }
    },
  };
})();
