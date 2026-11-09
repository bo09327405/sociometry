/* 三種社會計量技術（＋色卡輔助）：各自的預設設定、設定面板、疊在影像上的輔助線、計數與圖表資料。
   座標約定：floor 座標單位是「公尺」，原點在地板左上角（遠端左），x 向右、y 向近端。 */
(function () {
  const SM = window.SM;
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { if (attrs[k] == null) continue; if (k === "class") e.className = attrs[k]; else if (k.startsWith("on")) e[k] = attrs[k]; else if (k === "value") e.value = attrs[k]; else e.setAttribute(k, attrs[k]); }
    kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
    return e;
  };
  SM.h = h;
  const opt = (v, t, sel) => { const o = h("option", { value: v }, t); if (String(sel) === String(v)) o.selected = true; return o; };
  const select = (vals, cur, on) => { const s = h("select", { onchange: () => on(s.value) }, vals.map(([v, t]) => opt(v, t, cur))); return s; };
  const text = (cur, on, size) => h("input", { type: "text", value: cur, size: size || 10, oninput: (e) => on(e.target.value) });
  const num = (cur, on, min, max, step) => h("input", { type: "number", value: cur, min, max, step: step || 1, onchange: (e) => on(+e.target.value) });
  const row = (...k) => h("div", { class: "row" }, k);
  const lab = (t) => h("label", {}, t);

  const MATRIX_DEFAULT = ["捷運", "公車", "走路", "家長接送", "腳踏車", "其他", "", "", "", "", "", ""];

  const Modes = (SM.Modes = {
    spectrum: {
      name: "光譜", en: "Human Spectrum", hint: "一條線，兩端是極端立場，依程度站在線上。",
      defaults: () => ({ dir: "u", rev: false, bins: 5, endA: "非常舒適", endB: "非常不舒適" }),
      panel(q, on) {
        const c = q.cfg;
        return [
          row(lab("方向"), select([["u", "左 → 右"], ["v", "遠 → 近"]], c.dir, (v) => { c.dir = v; on(); }),
            h("label", { class: "chk" }, h("input", { type: "checkbox", checked: c.rev ? "" : null, onchange: (e) => { c.rev = e.target.checked; on(); } }), " 兩端對調"),
            lab("格數"), select([3, 5, 7, 11].map((n) => [n, n]), c.bins, (v) => { c.bins = +v; on(); })),
          row(lab("A 端"), text(c.endA, (v) => { c.endA = v; on(); }, 12), lab("B 端"), text(c.endB, (v) => { c.endB = v; on(); }, 12)),
        ];
      },
      /* 回傳 [{label,counts}]；t∈[0,1] 沿著光譜線的位置，A 端為 0 */
      compute(q, pts, ctx) {
        const c = q.cfg, n = c.bins, cnt = new Array(n).fill(0);
        pts.forEach((p) => {
          const [fx, fy] = ctx.toFloor(p.x, p.y);
          let t = c.dir === "u" ? fx / ctx.floor.w : fy / ctx.floor.d;
          if (c.rev) t = 1 - t;
          cnt[Math.floor(SM.clamp(t, 0, 0.9999) * n)]++;
        });
        return { labels: cnt.map((_, i) => (i === 0 ? "1（" + c.endA + "）" : i === n - 1 ? n + "（" + c.endB + "）" : String(i + 1))), counts: cnt, extra: { endA: c.endA, endB: c.endB } };
      },
      overlay(c, q, ctx, k) {
        const cf = q.cfg, n = cf.bins, W = ctx.floor.w, D = ctx.floor.d;
        c.setLineDash([8 * k, 6 * k]); c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 2 * k;
        for (let i = 1; i < n; i++) { const t = i / n; const a = cf.dir === "u" ? [t * W, 0] : [0, t * D], b = cf.dir === "u" ? [t * W, D] : [W, t * D]; ctx.line(c, a, b); }
        c.setLineDash([]);
        const A = cf.rev ? 1 : 0, B = 1 - A;
        const pos = (t) => (cf.dir === "u" ? [t * W, D * 0.06] : [W * 0.5, t * D]);
        ctx.tag(c, pos(A + (A ? -0.03 : 0.03)), cf.endA, "#7bd88f", k);
        ctx.tag(c, pos(B + (B ? -0.03 : 0.03)), cf.endB, "#ff7a5c", k);
      },
      /* 疊在影像上的格子編號 */
    },

    matrix: {
      name: "矩陣", en: "Locograms", hint: "把空間分成區域，每區代表一個選項。",
      defaults: () => ({ cols: 3, rows: 2, labels: MATRIX_DEFAULT.slice() }),
      panel(q, on, rebuild) {
        const c = q.cfg, box = h("div", { class: "row labels" });
        const fill = () => { box.innerHTML = ""; for (let i = 0; i < c.cols * c.rows; i++) box.append(h("input", { type: "text", size: 9, value: c.labels[i] || "", placeholder: "區域" + (i + 1), oninput: (e) => { c.labels[i] = e.target.value; on(); } })); };
        fill();
        return [
          row(lab("欄"), select([1, 2, 3, 4].map((n) => [n, n]), c.cols, (v) => { c.cols = +v; fill(); on(); }), lab("列"), select([1, 2, 3].map((n) => [n, n]), c.rows, (v) => { c.rows = +v; fill(); on(); }),
            h("span", { class: "mute" }, "（第一列＝離鏡頭較遠，由左而右編號）")),
          box,
        ];
      },
      compute(q, pts, ctx) {
        const c = q.cfg, cnt = new Array(c.cols * c.rows).fill(0);
        pts.forEach((p) => {
          const [fx, fy] = ctx.toFloor(p.x, p.y);
          const i = Math.min(c.cols - 1, Math.max(0, Math.floor(fx / ctx.floor.w * c.cols))), j = Math.min(c.rows - 1, Math.max(0, Math.floor(fy / ctx.floor.d * c.rows)));
          cnt[j * c.cols + i]++;
        });
        return { labels: cnt.map((_, i) => c.labels[i] || "區域" + (i + 1)), counts: cnt, extra: { cols: c.cols, rows: c.rows } };
      },
      overlay(c, q, ctx, k) {
        const cf = q.cfg, W = ctx.floor.w, D = ctx.floor.d;
        c.setLineDash([8 * k, 6 * k]); c.strokeStyle = "rgba(255,255,255,.75)"; c.lineWidth = 2 * k;
        for (let i = 1; i < cf.cols; i++) ctx.line(c, [W * i / cf.cols, 0], [W * i / cf.cols, D]);
        for (let j = 1; j < cf.rows; j++) ctx.line(c, [0, D * j / cf.rows], [W, D * j / cf.rows]);
        c.setLineDash([]);
        for (let j = 0; j < cf.rows; j++) for (let i = 0; i < cf.cols; i++) ctx.tag(c, [W * (i + 0.5) / cf.cols, D * (j + 0.5) / cf.rows], cf.labels[j * cf.cols + i] || "區域" + (j * cf.cols + i + 1), "#ffd37a", k, true);
      },
    },

    distance: {
      name: "關係距離", en: "Distance Metric", hint: "以某人或某主題為圓心，依心理距離站遠近。",
      defaults: () => ({ rings: 4, step: 1.0, center: null, centerLabel: "圓心", names: ["很近", "有點近", "有點遠", "很遠", "遙不可及"] }),
      panel(q, on, rebuild, app) {
        const c = q.cfg;
        const nameBox = h("div", { class: "row labels" });
        const fill = () => { nameBox.innerHTML = ""; for (let i = 0; i <= c.rings; i++) nameBox.append(h("input", { type: "text", size: 8, value: c.names[i] || "", placeholder: i < c.rings ? "第" + (i + 1) + "圈" : "圈外", oninput: (e) => { c.names[i] = e.target.value; on(); } })); };
        fill();
        return [
          row(lab("圓心名稱"), text(c.centerLabel, (v) => { c.centerLabel = v; on(); }, 10),
            h("button", { class: "tool", onclick: () => app.pickCenter() }, "在畫面上點選圓心"),
            h("span", { class: "mute", id: "centerInfo" }, c.center ? "圓心已設定" : "尚未設定圓心")),
          row(lab("圈數"), select([2, 3, 4, 5].map((n) => [n, n]), c.rings, (v) => { c.rings = +v; fill(); on(); }), lab("每圈寬度(公尺)"), num(c.step, (v) => { c.step = Math.max(0.2, v || 1); on(); }, 0.2, 6, 0.1)),
          h("div", { class: "mute" }, "各圈名稱（最後一格＝最外圈之外）："), nameBox,
        ];
      },
      compute(q, pts, ctx) {
        const c = q.cfg, nb = c.rings + 1, cnt = new Array(nb).fill(0), dots = [];
        const names = Array.from({ length: nb }, (_, i) => c.names[i] || (i < c.rings ? "第" + (i + 1) + "圈（≤" + (c.step * (i + 1)).toFixed(1).replace(/\.0$/, "") + "公尺）" : "圈外"));
        if (c.center) pts.forEach((p) => {
          const [fx, fy] = ctx.toFloor(p.x, p.y), dx = fx - c.center.x, dy = fy - c.center.y, d = Math.hypot(dx, dy);
          const ring = Math.min(c.rings, Math.floor(d / c.step)), frac = ring < c.rings ? (d - ring * c.step) / c.step : (d - c.rings * c.step) / c.step;
          cnt[ring]++; dots.push({ ring, frac, ang: Math.atan2(dy, dx) });
        });
        return { labels: names, counts: cnt, extra: { dots, centerLabel: c.centerLabel, rings: c.rings, step: c.step, needCenter: !c.center } };
      },
      overlay(c, q, ctx, k) {
        const cf = q.cfg; if (!cf.center) return;
        const { x, y } = cf.center, cols = SM.RING_COLORS;
        for (let r = cf.rings; r >= 1; r--) {
          c.strokeStyle = cols[Math.min(r - 1, cols.length - 1)]; c.lineWidth = 3 * k; c.beginPath();
          for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2, p = ctx.toImg(x + Math.cos(t) * r * cf.step, y + Math.sin(t) * r * cf.step); a ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
          c.stroke();
        }
        const p = ctx.toImg(x, y); c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = 2 * k; c.beginPath(); c.arc(p[0], p[1], 9 * k, 0, 7); c.fill(); c.stroke();
        c.font = "bold " + 20 * k + "px sans-serif"; c.fillStyle = "#fff"; c.strokeText(cf.centerLabel, p[0] + 14 * k, p[1] - 12 * k); c.fillText(cf.centerLabel, p[0] + 14 * k, p[1] - 12 * k);
      },
    },

    cards: {
      name: "色卡（輔助）", en: "Colour cards", hint: "學生舉色卡選擇；輔助用，不是主要辨識方式。",
      defaults: () => ({ labels: ["捷運", "公車", "走路", "家長接送"] }),
      panel(q, on, rebuild, app) {
        const c = q.cfg, cols = ["#e4572e", "#5cb85c", "#f2c94c", "#4a9fd8"], names = ["紅", "綠", "黃", "藍"];
        return [
          row(lab("色卡意義"), [0, 1, 2, 3].map((i) => h("span", {}, h("span", { class: "sw", style: "background:" + cols[i] }), " ", text(c.labels[i] || "", (v) => { c.labels[i] = v; on(); }, 7),
            h("button", { class: "tool sm", onclick: () => { q.cardAdj[i]--; on(); } }, "−"), h("button", { class: "tool sm", onclick: () => { q.cardAdj[i]++; on(); } }, "＋")))),
          row(h("button", { class: "tool", onclick: () => app.cards.base() }, "拍背景基準"), h("button", { class: "tool", onclick: () => app.cards.sample() }, "取樣色卡"),
            h("span", { class: "mute" }, "步驟：大家還沒舉卡時先「拍背景基準」→「取樣色卡」依序點紅綠黃藍各一張 → 掃描。")),
        ];
      },
      compute(q) {
        const cnt = q.cardCount.map((n, i) => Math.max(0, n + (q.cardAdj[i] || 0)));
        return { labels: [0, 1, 2, 3].map((i) => q.cfg.labels[i] || ["紅", "綠", "黃", "藍"][i]), counts: cnt, extra: {} };
      },
      overlay() {},
    },
  });
})();
