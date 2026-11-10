/* 雲端同步（Firebase：Authentication + Firestore）。未在 js/config.js 填入 firebase 設定時完全不啟用（維持純本機）。
   資料模型：
     classes/{班級id}                 班級設定：name, groups, created, corners[{x,y}], sz, floor, qorder[題目id]
     classes/{班級id}/questions/{題目id}   title, type, cfg, res{ '1':{pts,hidden,locked,snaps,…}, '2':…, 'all':… }
   學生（不用登入）只能讀取，並只能更新題目文件的 res（各組結果）；教師（Google 登入）才能新增／刪除／改名班級與改題目。
   真正的權限由 Firestore 安全規則（firestore.rules）在伺服器端執行，不靠這裡的前端判斷。 */
(function () {
  const SM = window.SM, V = "10.12.2", BASE = "https://www.gstatic.com/firebasejs/" + V + "/";
  const Cloud = (SM.Cloud = { on: false, db: null, auth: null, err: "", testBackend: null });
  const cfg = () => (SM.CONFIG && SM.CONFIG.firebase) || {};
  Cloud.configured = () => !!(cfg().apiKey && cfg().projectId);
  const clean = (o) => JSON.parse(JSON.stringify(o)); // 去掉 undefined（Firestore 不接受）

  /* 穩定序列化（Firestore 會把 map 的鍵排序，比較雜湊時要忽略鍵順序） */
  Cloud.stable = function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  };

  /* corners：Firestore 不允許巢狀陣列 → 存成 [{x,y}] */
  Cloud.cornersOut = (c) => (c || []).map((p) => ({ x: p[0], y: p[1] }));
  Cloud.cornersIn = (c) => (c || []).map((p) => [p.x, p.y]);

  Cloud.init = async function () {
    if (!Cloud.configured()) return false;
    try {
      if (Cloud.testBackend) { Object.assign(Cloud, Cloud.testBackend); Cloud.on = true; return true; } // 測試用假後端
      await SM.loadScript([BASE + "firebase-app-compat.js"]); await SM.loadScript([BASE + "firebase-auth-compat.js"]); await SM.loadScript([BASE + "firebase-firestore-compat.js"]);
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg());
      Cloud.fb = firebase; Cloud.auth = firebase.auth(); Cloud.db = firebase.firestore(); Cloud.on = true;
      return true;
    } catch (e) { Cloud.err = "無法載入雲端同步（需要網路）：" + e.message; return false; }
  };

  /* ---- 登入（Google，彈出視窗） ---- */
  Cloud.signIn = () => Cloud.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  Cloud.signOut = () => Cloud.auth.signOut();
  Cloud.onAuth = (cb) => Cloud.auth.onAuthStateChanged((u) => cb(u && !u.isAnonymous ? { email: u.email, name: u.displayName || u.email, verified: !!u.emailVerified } : null));

  /* ---- 讀取（即時監聽） ---- */
  Cloud.watchClasses = (cb, err) => Cloud.db.collection("classes").onSnapshot((snap) => cb(snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data(), pending: c.doc.metadata.hasPendingWrites }))), err);
  Cloud.watchQuestions = (cid, cb, err) => Cloud.db.collection("classes").doc(cid).collection("questions").onSnapshot((snap) => cb(snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data(), pending: c.doc.metadata.hasPendingWrites }))), err);

  /* ---- 寫入 ---- */
  Cloud.putClassMeta = (m) => Cloud.db.collection("classes").doc(m.id).set(clean(m));
  Cloud.updateQorder = (cid, list) => Cloud.db.collection("classes").doc(cid).update({ qorder: list }); // 題目順序（學生也能改）
  Cloud.setQuestionConfig = (cid, q) => Cloud.db.collection("classes").doc(cid).collection("questions").doc(q.id).set(clean({ id: q.id, title: q.title, type: q.type, cfg: q.cfg }), { merge: true });
  Cloud.updateRes = (cid, qid, g, val) => {
    const ref = Cloud.db.collection("classes").doc(cid).collection("questions").doc(qid), v = clean(val);
    // 以欄位路徑只更新這一組的結果，不同裝置同時編輯不同組不會互相覆蓋
    return ref.update(new firebase.firestore.FieldPath("res", String(g)), v).catch((e) => (e && e.code === "not-found" ? ref.set({ id: qid, res: { [g]: v } }, { merge: true }) : Promise.reject(e)));
  };
  Cloud.deleteQuestion = (cid, qid) => Cloud.db.collection("classes").doc(cid).collection("questions").doc(qid).delete();
  Cloud.deleteClass = async (cid) => {
    const col = Cloud.db.collection("classes").doc(cid).collection("questions"), snap = await col.get();
    for (const d of snap.docs) await d.ref.delete();
    await Cloud.db.collection("classes").doc(cid).delete();
  };
})();
