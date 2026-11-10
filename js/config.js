/* 部署設定。googleClientId 留空＝不啟用 Google 登入（所有人都能管理班級）。
   Client ID 是公開資訊（不是密鑰），可以放在公開 repo；取得方式見 README「Google 登入」。 */
window.SM = window.SM || {};
SM.CONFIG = {
  googleClientId: "459536923115-0shnjk9m762klapudh6fhk1ph6pks8db.apps.googleusercontent.com",
  // 教師 email 的 SHA-256 雜湊（小寫 email）：公開 repo 裡不會直接出現 email。
  // 註：email 雜湊仍可被「猜 email」反推，只是不被搜尋引擎直接索引；這只是把關，不是機密。
  // 新增教師：在介面按「教師名單」（存在該電腦瀏覽器），或把 SHA-256 加進這裡。
  teacherHashes: [
    "7b32f16f8749eab2f550af094f449c1257a0fadd36caa4cadec1f09649536a7b",
    "21e8fe2595d2efe7c31cdd5e5f3f3e1d69567bf0fd5a264ab20aea1bf1576bd2",
  ],
  // 也可直接寫明文 email（會公開在 repo）。
  teachers: [],
  // 雲端同步（Firebase）。留空＝只存在各自瀏覽器、不同步。設定步驟見 README「雲端同步」。
  // 這些值是公開的網頁設定（不是密鑰），安全性由 Firestore 規則決定。
  firebase: { apiKey: "", authDomain: "", projectId: "", appId: "" },
};
