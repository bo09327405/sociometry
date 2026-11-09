/* 儲存層：班級資料存在瀏覽器的 IndexedDB（容量大、每班一筆）；不可用時退回 localStorage。
   資料只在這台電腦的這個瀏覽器、這個網址（來源）底下；不上傳。 */
(function () {
  const SM = window.SM;
  const DBN = "sociometry", V = 1;
  let db = null, mode = "idb", ready = false;
  const LS = "sociometry.v2.";

  function open() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no idb"));
      const r = indexedDB.open(DBN, V);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("classes", { keyPath: "id" }); d.createObjectStore("meta"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("blocked"));
    });
  }
  const tx = (store, m, fn) => new Promise((res, rej) => { const t = db.transaction(store, m), s = t.objectStore(store), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

  const Store = (SM.Store = {
    get mode() { return mode; },
    get ready() { return ready; },
    async init() { try { db = await open(); mode = "idb"; } catch (e) { db = null; mode = "ls"; } ready = true; return mode; },
    async allClasses() {
      if (db) return (await tx("classes", "readonly", (s) => s.getAll())) || [];
      const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS + "class.")) out.push(JSON.parse(localStorage.getItem(k))); } } catch (e) {} return out;
    },
    async putClass(c) {
      if (db) return tx("classes", "readwrite", (s) => s.put(c));
      localStorage.setItem(LS + "class." + c.id, JSON.stringify(c));
    },
    async delClass(id) {
      if (db) return tx("classes", "readwrite", (s) => s.delete(id));
      localStorage.removeItem(LS + "class." + id);
    },
    async getMeta(k) {
      if (db) return tx("meta", "readonly", (s) => s.get(k));
      try { return JSON.parse(localStorage.getItem(LS + "meta." + k)); } catch (e) { return null; }
    },
    async setMeta(k, v) {
      if (db) return tx("meta", "readwrite", (s) => s.put(v, k));
      localStorage.setItem(LS + "meta." + k, JSON.stringify(v));
    },
  });
})();
