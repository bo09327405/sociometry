/* 部署設定。googleClientId 留空＝不啟用 Google 登入（所有人都能管理班級）。
   Client ID 是公開資訊（不是密鑰），可以放在公開 repo；取得方式見 README「Google 登入」。 */
window.SM = window.SM || {};
SM.CONFIG = {
  googleClientId: "",
  // 固定的教師 email 清單（寫在公開 repo 會公開這些 email，建議留空）。
  // 留空時：這台電腦上「第一個成功登入的 Google 帳號」自動成為管理者，之後可在介面新增其他教師。
  teachers: [],
};
