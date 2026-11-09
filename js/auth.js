/* 老師 Google 登入：只有教師名單內的帳號能新增／改名／刪除班級，以及匯入、套用範本等會覆蓋資料的操作。
   ⚠ 這是「介面層的把關」，不是資安機制：程式與資料都在使用者自己的瀏覽器裡，
   懂瀏覽器開發者工具的人可以繞過。目的是防學生誤觸或在老師電腦上亂改。
   登入使用 Google Identity Services；憑證（JWT）只在瀏覽器內解碼取得 email，沒有任何後端驗證。 */
(function () {
  const SM = window.SM, cfg = SM.CONFIG || { googleClientId: "", teachers: [] };
  const Auth = (SM.Auth = { user: null, owners: [], onChange: () => {}, ready: false });
  const norm = (e) => String(e || "").trim().toLowerCase();

  Auth.enabled = () => !!cfg.googleClientId;
  Auth.teachers = () => Array.from(new Set((cfg.teachers || []).map(norm).concat(Auth.owners.map(norm)).filter(Boolean)));
  Auth.isTeacher = () => !Auth.enabled() || (!!Auth.user && (Auth.teachers().includes(norm(Auth.user.email)) || (!!Auth.user.hash && (cfg.teacherHashes || []).includes(Auth.user.hash))));
  Auth.sha256 = async (t) => { try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm(t))); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""); } catch (e) { return null; } };

  function parseJwt(t) { const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))))); }

  /* 收到 Google 的登入憑證。回傳 {ok, reason} */
  Auth.handleCredential = async function (jwt) {
    let c; try { c = parseJwt(jwt); } catch (e) { return { ok: false, reason: "憑證格式錯誤" }; }
    if (c.aud !== cfg.googleClientId) return { ok: false, reason: "憑證不是給這個網站的（Client ID 不符）" };
    if (!/^(https:\/\/)?accounts\.google\.com$/.test(c.iss || "")) return { ok: false, reason: "憑證簽發者不正確" };
    if (!c.email || c.email_verified === false) return { ok: false, reason: "此 Google 帳號的 email 未驗證" };
    if (c.exp * 1000 < Date.now()) return { ok: false, reason: "憑證已過期，請重新登入" };
    const hash = await Auth.sha256(c.email);
    if (!Auth.teachers().length && !(cfg.teacherHashes || []).length) { Auth.owners = [norm(c.email)]; await Auth.saveOwners(); } // 第一個登入者成為管理者
    Auth.user = { email: c.email, name: c.name || c.email, exp: c.exp * 1000, hash };
    try { sessionStorage.setItem("sm.auth", JSON.stringify(Auth.user)); } catch (e) {}
    Auth.onChange();
    return { ok: Auth.isTeacher(), reason: Auth.isTeacher() ? "" : "「" + c.email + "」不在教師名單內" };
  };
  Auth.saveOwners = async () => { try { if (SM.Store && SM.Store.ready) await SM.Store.setMeta("teachers", Auth.owners); } catch (e) {} };
  Auth.setOwners = async (list) => { Auth.owners = Array.from(new Set(list.map(norm).filter(Boolean))); await Auth.saveOwners(); Auth.onChange(); };
  Auth.logout = function () {
    Auth.user = null; try { sessionStorage.removeItem("sm.auth"); } catch (e) {}
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) {}
    Auth.onChange();
  };

  /* 讀取教師名單與（尚未過期的）登入狀態，並載入 Google 登入按鈕 */
  Auth.init = async function (box) {
    try { if (SM.Store && SM.Store.ready) Auth.owners = (await SM.Store.getMeta("teachers")) || []; } catch (e) {}
    try { const u = JSON.parse(sessionStorage.getItem("sm.auth")); if (u && u.exp > Date.now()) Auth.user = u; } catch (e) {}
    Auth.ready = true;
  };

  /* 只有按下「教師登入」才載入 Google 的程式（學生使用時完全不連 Google） */
  Auth.loadGsi = function () {
    if (Auth.gsi) return Auth.gsi;
    Auth.gsi = SM.loadScript(["https://accounts.google.com/gsi/client"]).then(() => {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (r) => { const x = await Auth.handleCredential(r.credential); if (!x.ok && Auth.onDenied) Auth.onDenied(x.reason); }, auto_select: false });
      Auth.renderButton = (el) => google.accounts.id.renderButton(el, { theme: "outline", size: "medium", text: "signin_with", locale: "zh-TW" });
    }).catch(() => { Auth.gsi = null; Auth.loadError = "無法載入 Google 登入（需要網路，且請用 https 或 http://localhost 開啟，不能雙擊 index.html）"; throw new Error(Auth.loadError); });
    return Auth.gsi;
  };
})();
