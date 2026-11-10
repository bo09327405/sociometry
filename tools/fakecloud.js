/* 測試用「假雲端」：用 localStorage 模擬 Firestore（同一個瀏覽器的多個分頁共用資料），
   用來在沒有 Firebase 專案時測試同步邏輯。網址加 ?fakecloud=1 才會載入；正式使用不會用到。
   模擬：鍵排序（Firestore 行為）、本機寫入先回傳 pending 再確認、教師／學生寫入權限（學生只能更新 res）。
   身分：sessionStorage.fakeUser = 'teacher@x'（教師）或空（學生）。 */
(function () {
  const SM = window.SM, KEY = "sm.fakecloud", TEACHERS = ["teacher@x"];
  SM.CONFIG.firebase = { apiKey: "fake", projectId: "fake" };
  SM.CONFIG.teachers = (SM.CONFIG.teachers || []).concat(TEACHERS);
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { classes: {} }; } catch (e) { return { classes: {} }; } };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const sortKeys = (v) => (v === null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(sortKeys) : Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])])));
  const user = () => sessionStorage.getItem("fakeUser") || "";
  const isT = () => TEACHERS.includes(user());
  const deny = () => Promise.reject(Object.assign(new Error("permission-denied"), { code: "permission-denied" }));
  const listeners = new Set();
  const notify = (opt) => listeners.forEach((l) => l.run(opt || {}));
  addEventListener("storage", (e) => { if (e.key === KEY) setTimeout(() => notify(), 5); });
  const local = (id) => { notify({ pending: id }); setTimeout(() => notify({ force: id }), 30); };

  function watch(getMap, cb) {
    let prev = null;
    const l = { run(opt) {
      const cur = getMap(), out = [];
      for (const id of Object.keys(cur)) { const j = JSON.stringify(cur[id]); if (!prev || !(id in prev)) out.push({ type: "added", id, data: JSON.parse(j), pending: opt.pending === id }); else if (prev[id] !== j || opt.force === id || opt.pending === id) out.push({ type: "modified", id, data: JSON.parse(j), pending: opt.pending === id }); }
      if (prev) for (const id of Object.keys(prev)) if (!(id in cur)) out.push({ type: "removed", id, data: {}, pending: false });
      const np = {}; for (const id of Object.keys(cur)) np[id] = JSON.stringify(cur[id]); const first = !prev; prev = np;
      if (out.length || first) cb(out);
    } };
    listeners.add(l); setTimeout(() => l.run({}), 5);
    return () => listeners.delete(l);
  }
  const authCbs = [], liveCbs = new Set();
  const liveNotify = () => liveCbs.forEach((f) => f());
  addEventListener("storage", (e) => { if (e.key === KEY) setTimeout(liveNotify, 5); });
  SM.Cloud.testBackend = {
    signIn: async () => { sessionStorage.setItem("fakeUser", "teacher@x"); authCbs.forEach((f) => f({ email: user(), name: "測試教師", verified: true })); },
    signOut: async () => { sessionStorage.removeItem("fakeUser"); authCbs.forEach((f) => f(null)); },
    onAuth: (cb) => { authCbs.push(cb); setTimeout(() => cb(user() ? { email: user(), name: "測試教師", verified: true } : null), 5); },
    watchClasses: (cb) => watch(() => Object.fromEntries(Object.entries(load().classes).map(([id, c]) => [id, c.meta])), cb),
    watchQuestions: (cid, cb) => watch(() => (load().classes[cid] || { questions: {} }).questions, cb),
    putClassMeta: async (m) => { if (!isT()) return deny(); const d = load(); d.classes[m.id] = d.classes[m.id] || { meta: null, questions: {} }; d.classes[m.id].meta = sortKeys(JSON.parse(JSON.stringify(m))); save(d); local(m.id); },
    setQuestionConfig: async (cid, q) => { const d = load(), c = d.classes[cid]; if (!c) return Promise.reject(new Error("no class")); c.questions[q.id] = sortKeys(Object.assign({}, c.questions[q.id], JSON.parse(JSON.stringify({ id: q.id, title: q.title, type: q.type, cfg: q.cfg })))); save(d); local(q.id); },
    updateRes: async (cid, qid, g, val) => { const d = load(), c = d.classes[cid]; if (!c || !c.questions[qid]) return isT() ? Promise.reject(new Error("not-found")) : deny(); const q = c.questions[qid]; q.res = q.res || {}; q.res[g] = JSON.parse(JSON.stringify(val)); c.questions[qid] = sortKeys(q); save(d); local(qid); },
    updateQorder: async (cid, list) => { const d = load(), c = d.classes[cid]; if (!c) return Promise.reject(new Error("no class")); c.meta.qorder = list; save(d); local(cid); },
    setLive: async (o) => { const d = load(); d.live = JSON.parse(JSON.stringify(o)); save(d); setTimeout(() => liveNotify(), 0); },
    watchLive: (cb) => { let prev = null; const run = () => { const j = JSON.stringify(load().live || null); if (j !== prev) { prev = j; cb(JSON.parse(j)); } }; liveCbs.add(run); setTimeout(run, 5); return () => liveCbs.delete(run); },
    deleteQuestion: async (cid, qid) => { const d = load(); if (d.classes[cid]) delete d.classes[cid].questions[qid]; save(d); local(qid); },
    deleteClass: async (cid) => { if (!isT()) return deny(); const d = load(); delete d.classes[cid]; save(d); notify(); },
  };
  SM.fakeCloud = { reset: () => localStorage.removeItem(KEY), dump: load, setUser: (u) => (u ? sessionStorage.setItem("fakeUser", u) : sessionStorage.removeItem("fakeUser")) };
})();
