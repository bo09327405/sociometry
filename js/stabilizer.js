/* 連續掃描的穩定計數：保留最近 N 張影格的偵測點，
   把不同影格中「位置接近」的點歸成一群，只留在過半影格都出現的群，位置取中位數。
   這樣單一影格的漏抓／誤抓（閃爍）不會讓人數跳動。 */
(function () {
  const SM = window.SM;
  SM.Stabilizer = class {
    constructor(n) { this.n = n; this.frames = []; }
    resize(n) { this.n = n; while (this.frames.length > n) this.frames.shift(); }
    reset() { this.frames = []; }
    push(pts) { this.frames.push(pts.map((p) => ({ x: p.x, y: p.y }))); while (this.frames.length > this.n) this.frames.shift(); }
    get size() { return this.frames.length; }
    /* r：同一個人在不同影格之間允許的最大位移（像素） */
    result(r) {
      const F = this.frames.length, need = Math.ceil(F / 2), clusters = [];
      this.frames.forEach((fr, fi) => {
        fr.forEach((p) => {
          let best = null, bd = r;
          for (const c of clusters) {
            if (c.frames.has(fi)) continue;
            const d = Math.hypot(c.cx - p.x, c.cy - p.y);
            if (d < bd) { bd = d; best = c; }
          }
          if (!best) { best = { xs: [], ys: [], frames: new Set(), cx: p.x, cy: p.y }; clusters.push(best); }
          best.xs.push(p.x); best.ys.push(p.y); best.frames.add(fi);
          best.cx = SM.median(best.xs); best.cy = SM.median(best.ys);
        });
      });
      return clusters.filter((c) => c.frames.size >= need).map((c) => ({ x: c.cx, y: c.cy }));
    }
  };
})();
