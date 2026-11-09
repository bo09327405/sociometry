/* 題組、班級與組別的資料結構；匯出 CSV / JSON。
   結構：班級 → 題目（設定只存一份）→ 結果 res[組別]（圓點、快照、鎖定）。
   組別：'1'..'N'（輪流上場）、'all'（全班同場，一次站完）、'merge'（合併 1..N，唯讀檢視）。
   程式其他部分操作的是「目前組別」的工作欄位 q.pts / q.hidden / q.locked / q.snaps…；
   切換組別或存檔時由 stash / load 在工作欄位與 q.res 之間搬移。 */
(function () {
  const SM = window.SM;
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const WF = ["pts", "hidden", "locked", "snaps", "cardAdj", "cardCount", "cardPts"];
  const Q = (SM.Q = { uid, WF });

  Q.emptyRes = () => ({ pts: [], hidden: [], locked: false, snaps: [], cardAdj: [0, 0, 0, 0, 0], cardCount: [0, 0, 0, 0, 0], cardPts: [] });
  Q.groupName = (g) => (g === "all" ? "全班同場" : g === "merge" ? "合併檢視" : "第" + g + "組");

  Q.create = function (type, title, cfg) {
    const q = { id: uid(), title: title || "新題目", type, cfg: cfg || SM.Modes[type].defaults(), res: {} };
    return Object.assign(q, Q.emptyRes());
  };
  Q.sampleSet = function () {
    const a = Q.create("spectrum", "你現在住的地方，舒適嗎？"); a.cfg.endA = "非常舒適"; a.cfg.endB = "非常不舒適";
    const b = Q.create("matrix", "你通常怎麼來上學？"); b.cfg.cols = 3; b.cfg.rows = 2; b.cfg.labels = ["捷運", "公車", "走路", "家長接送", "腳踏車", "其他", "", "", "", "", "", ""];
    const c = Q.create("distance", "你覺得自己離「買得起房」有多近？"); c.cfg.centerLabel = "房子"; c.cfg.rings = 4; c.cfg.step = 1.0; c.cfg.names = ["很近", "有點近", "有點遠", "很遠", "遙不可及"];
    return [a, b, c];
  };
  Q.configsOf = (qs) => qs.map((q) => ({ title: q.title, type: q.type, cfg: JSON.parse(JSON.stringify(q.cfg)) }));
  Q.fromConfigs = (cs) => cs.map((x) => { const q = Q.create(x.type, x.title); q.cfg = Object.assign(SM.Modes[x.type].defaults(), JSON.parse(JSON.stringify(x.cfg || {}))); return q; });

  /* 工作欄位 → q.res[g] */
  Q.stash = function (q, g) {
    if (g === "merge") { q.res.merge = { snaps: q.snaps }; return; }
    const r = {}; WF.forEach((k) => (r[k] = q[k])); q.res[g] = r;
  };
  /* q.res[g] → 工作欄位 */
  Q.load = function (q, g, n) {
    if (g === "merge") {
      const e = Q.emptyRes(); e.pts = []; e.cardCount = [0, 0, 0, 0, 0]; e.cardAdj = [0, 0, 0, 0, 0];
      for (let i = 1; i <= n; i++) { const r = q.res[String(i)]; if (!r) continue; e.pts = e.pts.concat(r.pts.map((p) => ({ x: p.x, y: p.y, m: p.m }))); for (let k = 0; k < 5; k++) { e.cardCount[k] += r.cardCount[k] || 0; e.cardAdj[k] += r.cardAdj[k] || 0; } }
      e.snaps = (q.res.merge && q.res.merge.snaps) || []; WF.forEach((k) => (q[k] = e[k])); return;
    }
    const r = q.res[g] || Q.emptyRes(); WF.forEach((k) => (q[k] = r[k] !== undefined ? r[k] : Q.emptyRes()[k])); ["cardAdj", "cardCount"].forEach((k) => { while (q[k].length < 5) q[k].push(0); }); // 舊資料只有 4 色
  };
  Q.resOf = (q, g, cur) => (g === cur ? Object.fromEntries(WF.map((k) => [k, q[k]])) : q.res[g]);

  /* 可存檔的純資料（不含工作欄位）。呼叫前請先 stash 目前組別 */
  Q.plainQ = (q) => ({ id: q.id, title: q.title, type: q.type, cfg: q.cfg, res: q.res });
  Q.newClass = function (name, configs, groups) {
    return { id: uid(), name: name || "新班級", groups: groups || 4, created: Date.now(), corners: [], sz: null, floor: { w: 8, d: 6 }, cur: 0, group: "1", qs: Q.fromConfigs(configs && configs.length ? configs : Q.configsOf(Q.sampleSet())).map(Q.plainQ) };
  };
  Q.plainClass = (c, qs) => ({ id: c.id, name: c.name, groups: c.groups, created: c.created, corners: c.corners, sz: c.sz, floor: c.floor, cur: c.cur, group: c.group, qs: qs.map(Q.plainQ) });

  /* CSV：UTF-8 + BOM，Excel 直接開啟不會亂碼。classes: [{name, qs:[{title,type,res}]}] */
  Q.toCSV = function (classes) {
    const rows = [["時間", "班級", "組別", "題序", "題目", "技術", "選項", "人數", "占比", "偵測人數", "手動新增", "手動刪除", "是否鎖定", "備註"]];
    classes.forEach((c) => c.qs.forEach((q, qi) => Object.keys(q.res).forEach((g) => (q.res[g].snaps || []).forEach((s) => s.labels.forEach((l, i) =>
      rows.push([s.t, c.name, Q.groupName(s.g || g), qi + 1, q.title, SM.Modes[q.type].name, l, s.counts[i], s.total ? (s.counts[i] / s.total).toFixed(3) : "0", s.det, s.add, s.del, s.locked ? "是" : "否", s.note || ""]))))));
    return "﻿" + rows.map((r) => r.map((x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  };
  Q.snapCount = (classes) => classes.reduce((a, c) => a + c.qs.reduce((b, q) => b + Object.values(q.res).reduce((d, r) => d + ((r.snaps || []).length), 0), 0), 0);
  /* 舊版（單一題組，localStorage 'sociometry.v1'）→ 轉成一個班級，結果放在第 1 組 */
  Q.migrateLegacy = function () {
    let d = null; try { d = JSON.parse(localStorage.getItem("sociometry.v1")); } catch (e) {}
    if (!d || !d.qs || !d.qs.length) return null;
    const qs = d.qs.map((o) => { const q = Q.create(o.type, o.title, o.cfg); const r = {}; WF.forEach((k) => (r[k] = o[k] !== undefined ? o[k] : Q.emptyRes()[k])); q.res["1"] = r; return Q.plainQ(q); });
    const cls = { id: uid(), name: "原有題組", groups: 4, created: Date.now(), corners: d.corners && d.corners.length === 4 ? d.corners : [], sz: d.sz || null, floor: d.floor || { w: 8, d: 6 }, cur: d.cur || 0, group: "1", qs };
    return { cls, settings: d.settings };
  };
  Q.download = function (name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" })); a.download = name; document.body.append(a); a.click(); a.remove();
  };
})();
