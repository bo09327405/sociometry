/* 共用小工具：命名空間 SM、透視轉換（homography）、載入腳本 */
(function () {
  const SM = (window.SM = window.SM || {});
  SM.$ = (id) => document.getElementById(id);

  /* ---- 高斯消去法解 n×n 線性方程 ---- */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /* 四點對應求透視矩陣 h（8 參數）。src、dst 各為 4 個 [x,y] */
  SM.homography = function (src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve(A, b);
  };
  SM.applyH = function (h, x, y) {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };

  /* 依序載入多個候選網址，第一個成功的就用（本機檔優先，再退到 CDN） */
  SM.loadScript = function (urls) {
    urls = [].concat(urls);
    return new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= urls.length) return reject(new Error("無法載入：" + urls.join(" | ")));
        const s = document.createElement("script");
        s.src = urls[i++];
        s.onload = () => resolve(s.src);
        s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      };
      next();
    });
  };

  /* 色卡：固定五色（紅黃藍綠白），順序＝設定面板與取樣順序 */
  SM.CARD_COLORS = [{ k: "red", name: "紅", c: "#e4572e" }, { k: "yellow", name: "黃", c: "#f2c94c" }, { k: "blue", name: "藍", c: "#4a9fd8" }, { k: "green", name: "綠", c: "#5cb85c" }, { k: "white", name: "白", c: "#f5f5f5" }];
  SM.sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 不用 requestAnimationFrame：分頁在背景時會停
  SM.median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  SM.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
})();
