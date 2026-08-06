import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const MAX_FILE_SIZE = 250 * 1024 * 1024;
const DISPLAY_QUOTA = 1024 * 1024 * 1024;
const ROOT = "root";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

const $ = (id) => document.getElementById(id);
const els = {
  loading: $("loadingScreen"), authScreen: $("authScreen"), appShell: $("appShell"),
  authForm: $("authForm"), authTitle: $("authTitle"), authLead: $("authLead"),
  email: $("emailInput"), password: $("passwordInput"), authError: $("authError"),
  authSubmit: $("authSubmit"), switchAuthMode: $("switchAuthMode"), togglePassword: $("togglePassword"),
  userButton: $("userButton"), userMenu: $("userMenu"), userEmail: $("userEmail"),
  avatarInitial: $("avatarInitial"), logoutButton: $("logoutButton"),
  sidebar: $("sidebar"), sidebarShade: $("sidebarShade"), mobileMenuButton: $("mobileMenuButton"), closeSidebar: $("closeSidebar"),
  pageTitle: $("pageTitle"), pageSubtitle: $("pageSubtitle"), breadcrumbs: $("breadcrumbs"),
  search: $("searchInput"), newFolder: $("newFolderButton"), upload: $("uploadButton"), uploadTop: $("uploadTopButton"),
  emptyUpload: $("emptyUploadButton"), fileInput: $("fileInput"), refresh: $("refreshButton"), sort: $("sortButton"),
  fileList: $("fileList"), itemCount: $("itemCount"), emptyState: $("emptyState"), emptyTitle: $("emptyTitle"),
  emptyText: $("emptyText"), dropZone: $("dropZone"), dropOverlay: $("dropOverlay"), uploadQueue: $("uploadQueue"),
  storageText: $("storageText"), storageBar: $("storageBar"),
  textDialog: $("textDialog"), textDialogForm: $("textDialogForm"), textDialogTitle: $("textDialogTitle"),
  textDialogLabel: $("textDialogLabel"), textDialogInput: $("textDialogInput"), textDialogError: $("textDialogError"),
  textDialogSubmit: $("textDialogSubmit"), confirmDialog: $("confirmDialog"), confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"), confirmOk: $("confirmOk"), previewDialog: $("previewDialog"),
  previewName: $("previewName"), previewMeta: $("previewMeta"), previewBody: $("previewBody"), closePreview: $("closePreview"),
  toastRegion: $("toastRegion")
};

let authMode = "login";
let currentUser = null;
let currentView = "files";
let currentFolderId = ROOT;
let allItems = [];
let unsubscribeItems = null;
let sortMode = "updated";
let textDialogHandler = null;
let dragDepth = 0;

function showOnly(screen) {
  els.loading.classList.toggle("hidden", screen !== "loading");
  els.authScreen.classList.toggle("hidden", screen !== "auth");
  els.appShell.classList.toggle("hidden", screen !== "app");
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  els.toastRegion.append(node);
  setTimeout(() => node.remove(), 3800);
}

function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "メールアドレスの形式が正しくありません。",
    "auth/missing-password": "パスワードを入力してください。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/email-already-in-use": "このメールアドレスはすでに登録されています。",
    "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらくしてからやり直してください。",
    "auth/network-request-failed": "ネットワークに接続できませんでした。",
    "storage/unauthorized": "このファイルを操作する権限がありません。",
    "storage/canceled": "アップロードをキャンセルしました。",
    "storage/quota-exceeded": "Firebase Storageの容量上限に達しました。",
    "permission-denied": "Firestoreのルールまたはデータベース設定を確認してください。"
  };
  return messages[code] || error?.message || "処理に失敗しました。";
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  els.authTitle.textContent = signup ? "アカウント作成" : "ログイン";
  els.authLead.textContent = signup ? "新しいソラップBOXを作成します。" : "メールアドレスとパスワードを入力してください。";
  els.authSubmit.textContent = signup ? "無料で作成" : "ログイン";
  els.switchAuthMode.textContent = signup ? "すでにアカウントを持っている" : "新しいアカウントを作る";
  els.password.autocomplete = signup ? "new-password" : "current-password";
  els.authError.textContent = "";
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = els.email.value.trim();
  const password = els.password.value;
  if (!email || password.length < 6) {
    els.authError.textContent = "メールアドレスと6文字以上のパスワードを入力してください。";
    return;
  }
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = authMode === "signup" ? "作成中…" : "ログイン中…";
  els.authError.textContent = "";
  try {
    const credential = authMode === "signup"
      ? await createUserWithEmailAndPassword(auth, email, password)
      : await signInWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      email: credential.user.email,
      updatedAt: serverTimestamp(),
      ...(authMode === "signup" ? { createdAt: serverTimestamp() } : {})
    }, { merge: true });
  } catch (error) {
    els.authError.textContent = friendlyError(error);
  } finally {
    els.authSubmit.disabled = false;
    setAuthMode(authMode);
  }
});

els.switchAuthMode.addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
els.togglePassword.addEventListener("click", () => {
  const visible = els.password.type === "text";
  els.password.type = visible ? "password" : "text";
  els.togglePassword.setAttribute("aria-label", visible ? "パスワードを表示" : "パスワードを隠す");
});
els.logoutButton.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (unsubscribeItems) { unsubscribeItems(); unsubscribeItems = null; }
  allItems = [];
  currentFolderId = ROOT;
  currentView = "files";
  if (!user) {
    showOnly("auth");
    render();
    return;
  }
  els.userEmail.textContent = user.email || "sorapbox user";
  els.avatarInitial.textContent = (user.email || "S").charAt(0).toUpperCase();
  showOnly("app");
  subscribeItems();
});

function subscribeItems() {
  if (!currentUser) return;
  unsubscribeItems = onSnapshot(
    collection(db, "users", currentUser.uid, "items"),
    (snapshot) => {
      allItems = snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
      render();
    },
    (error) => {
      console.error(error);
      toast(`${friendlyError(error)} Firebase側の設定を確認してください。`, "error");
      render();
    }
  );
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return new Date(value).getTime() || 0;
}

function formatDate(value) {
  const millis = timestampValue(value);
  if (!millis) return "たった今";
  const date = new Date(millis);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function itemMap() { return new Map(allItems.map((item) => [item.id, item])); }

function getVisibleItems() {
  const term = els.search.value.trim().toLocaleLowerCase("ja");
  const map = itemMap();
  let items;
  if (currentView === "trash") {
    items = allItems.filter((item) => item.trashed && !(map.get(item.parentId)?.trashed));
  } else if (currentView === "recent") {
    items = allItems.filter((item) => !item.trashed && item.type === "file");
  } else {
    items = allItems.filter((item) => !item.trashed && (item.parentId || ROOT) === currentFolderId);
  }
  if (term) {
    const source = currentView === "trash" ? allItems.filter((item) => item.trashed) : allItems.filter((item) => !item.trashed);
    items = source.filter((item) => String(item.name || "").toLocaleLowerCase("ja").includes(term));
  }
  return items.sort((a, b) => {
    if (sortMode === "name") return String(a.name).localeCompare(String(b.name), "ja", { numeric: true });
    if (a.type !== b.type && currentView === "files") return a.type === "folder" ? -1 : 1;
    return timestampValue(b.updatedAt || b.createdAt) - timestampValue(a.updatedAt || a.createdAt);
  });
}

function fileKind(item) {
  if (item.type === "folder") return { className: "folder", label: "▰", typeLabel: "フォルダ" };
  const mime = item.mimeType || "";
  const ext = String(item.name || "").split(".").pop().toLowerCase();
  if (mime.startsWith("image/")) return { className: "image", label: "IMG", typeLabel: "画像" };
  if (mime.startsWith("video/")) return { className: "video", label: "▶", typeLabel: "動画" };
  if (mime === "application/pdf" || ext === "pdf") return { className: "pdf", label: "PDF", typeLabel: "PDF" };
  if (["zip","rar","7z","gz","tar"].includes(ext)) return { className: "archive", label: "ZIP", typeLabel: "圧縮ファイル" };
  return { className: "", label: (ext || "FILE").slice(0, 4).toUpperCase(), typeLabel: mime || "ファイル" };
}

function render() {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === currentView));
  const term = els.search.value.trim();
  if (currentView === "files") {
    const folder = allItems.find((item) => item.id === currentFolderId);
    els.pageTitle.textContent = folder?.name || "マイファイル";
    els.pageSubtitle.textContent = term ? `「${term}」の検索結果` : "ファイルやフォルダを整理できます。";
  } else if (currentView === "recent") {
    els.pageTitle.textContent = "最近";
    els.pageSubtitle.textContent = "最近更新されたファイルです。";
  } else {
    els.pageTitle.textContent = "ゴミ箱";
    els.pageSubtitle.textContent = "完全に削除するまで保存容量を使用します。";
  }
  els.newFolder.classList.toggle("hidden", currentView !== "files");
  renderBreadcrumbs();
  renderItems();
  renderStorage();
}

function renderBreadcrumbs() {
  els.breadcrumbs.replaceChildren();
  if (currentView !== "files") return;
  const map = itemMap();
  const chain = [];
  let id = currentFolderId;
  while (id && id !== ROOT && map.has(id)) {
    const item = map.get(id);
    chain.unshift(item);
    id = item.parentId;
  }
  const rootButton = document.createElement("button");
  rootButton.type = "button";
  rootButton.textContent = "マイファイル";
  rootButton.onclick = () => { currentFolderId = ROOT; render(); };
  els.breadcrumbs.append(rootButton);
  chain.forEach((item) => {
    const separator = document.createElement("span");
    separator.textContent = "›";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.name;
    button.onclick = () => { currentFolderId = item.id; render(); };
    els.breadcrumbs.append(separator, button);
  });
}

function renderItems() {
  const items = getVisibleItems();
  els.fileList.replaceChildren();
  els.itemCount.textContent = `${items.length}個のアイテム`;
  items.forEach((item) => els.fileList.append(createRow(item)));
  const empty = items.length === 0;
  els.emptyState.classList.toggle("hidden", !empty);
  els.fileList.closest(".file-table-wrap").classList.toggle("hidden", empty);
  if (currentView === "trash") {
    els.emptyTitle.textContent = "ゴミ箱は空です";
    els.emptyText.textContent = "削除したファイルとフォルダがここに表示されます。";
    els.emptyUpload.classList.add("hidden");
  } else if (currentView === "recent") {
    els.emptyTitle.textContent = "最近のファイルはありません";
    els.emptyText.textContent = "ファイルをアップロードすると、ここに表示されます。";
    els.emptyUpload.classList.remove("hidden");
  } else {
    els.emptyTitle.textContent = els.search.value ? "見つかりませんでした" : "まだファイルがありません";
    els.emptyText.textContent = els.search.value ? "別の名前で検索してください。" : "ファイルをここへドラッグするか、アップロードボタンを押してください。";
    els.emptyUpload.classList.toggle("hidden", Boolean(els.search.value));
  }
}

function createRow(item) {
  const tr = document.createElement("tr");
  const kind = fileKind(item);
  const nameCell = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "file-name-cell";
  const icon = document.createElement("span");
  icon.className = `file-icon ${kind.className}`.trim();
  icon.textContent = kind.label;
  const nameButton = document.createElement("button");
  nameButton.className = "file-name-button";
  nameButton.type = "button";
  const strong = document.createElement("strong"); strong.textContent = item.name || "名前なし";
  const small = document.createElement("small"); small.textContent = kind.typeLabel;
  nameButton.append(strong, small);
  nameButton.onclick = () => openItem(item);
  wrap.append(icon, nameButton); nameCell.append(wrap);

  const updatedCell = document.createElement("td"); updatedCell.textContent = formatDate(item.updatedAt || item.createdAt);
  const sizeCell = document.createElement("td"); sizeCell.textContent = item.type === "folder" ? "—" : formatBytes(item.size);
  const actionCell = document.createElement("td");
  const menuWrap = document.createElement("div"); menuWrap.className = "row-menu-wrap";
  const menuButton = document.createElement("button"); menuButton.className = "row-menu-button"; menuButton.type = "button"; menuButton.textContent = "•••"; menuButton.ariaLabel = "操作メニュー";
  const menu = document.createElement("div"); menu.className = "row-menu hidden";
  const actions = currentView === "trash"
    ? [["復元", () => restoreItem(item)], ["完全に削除", () => permanentlyDelete(item), "danger"]]
    : [
        [item.type === "folder" ? "開く" : "プレビュー", () => openItem(item)],
        ...(item.type === "file" ? [["ダウンロード", () => downloadItem(item)]] : []),
        ["名前を変更", () => renameItem(item)],
        ["ゴミ箱へ移動", () => trashItem(item), "danger"]
      ];
  actions.forEach(([label, handler, className]) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    if (className) button.className = className;
    button.onclick = (event) => { event.stopPropagation(); menu.classList.add("hidden"); handler(); };
    menu.append(button);
  });
  menuButton.onclick = (event) => {
    event.stopPropagation();
    document.querySelectorAll(".row-menu").forEach((node) => { if (node !== menu) node.classList.add("hidden"); });
    menu.classList.toggle("hidden");
  };
  menuWrap.append(menuButton, menu); actionCell.append(menuWrap);
  tr.append(nameCell, updatedCell, sizeCell, actionCell);
  return tr;
}

document.addEventListener("click", () => document.querySelectorAll(".row-menu").forEach((node) => node.classList.add("hidden")));

function renderStorage() {
  const bytes = allItems.filter((item) => item.type === "file").reduce((sum, item) => sum + Number(item.size || 0), 0);
  const percent = Math.min(100, (bytes / DISPLAY_QUOTA) * 100);
  els.storageText.textContent = `${formatBytes(bytes)} / 1 GB`;
  els.storageBar.style.width = `${Math.max(bytes ? 1 : 0, percent)}%`;
}

function openItem(item) {
  if (item.trashed) return;
  if (item.type === "folder") {
    currentView = "files";
    currentFolderId = item.id;
    els.search.value = "";
    render();
    return;
  }
  previewItem(item);
}

async function previewItem(item) {
  try {
    els.previewName.textContent = item.name;
    els.previewMeta.textContent = `${formatBytes(item.size)} ・ ${formatDate(item.updatedAt || item.createdAt)}`;
    els.previewBody.innerHTML = '<div class="preview-unavailable"><div>◌</div><p>読み込んでいます…</p></div>';
    els.previewDialog.showModal();
    const url = await getDownloadURL(ref(storage, item.storagePath));
    const mime = item.mimeType || "";
    els.previewBody.replaceChildren();
    let node;
    if (mime.startsWith("image/")) { node = document.createElement("img"); node.src = url; node.alt = item.name; }
    else if (mime.startsWith("video/")) { node = document.createElement("video"); node.src = url; node.controls = true; node.autoplay = true; }
    else if (mime.startsWith("audio/")) { node = document.createElement("audio"); node.src = url; node.controls = true; node.autoplay = true; }
    else if (mime === "application/pdf" || item.name.toLowerCase().endsWith(".pdf")) { node = document.createElement("iframe"); node.src = url; node.title = item.name; }
    else {
      node = document.createElement("div"); node.className = "preview-unavailable";
      node.innerHTML = `<div>▤</div><h2>このファイルは直接表示できません</h2><p>${escapeHtml(item.name)}</p>`;
      const button = document.createElement("button"); button.className = "primary-button"; button.textContent = "ダウンロード"; button.onclick = () => downloadItem(item);
      node.append(button);
    }
    els.previewBody.append(node);
  } catch (error) {
    els.previewBody.innerHTML = `<div class="preview-unavailable"><div>!</div><h2>プレビューできませんでした</h2><p>${escapeHtml(friendlyError(error))}</p></div>`;
  }
}

function escapeHtml(value) {
  const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML;
}

els.closePreview.addEventListener("click", () => els.previewDialog.close());

async function downloadItem(item) {
  try {
    const url = await getDownloadURL(ref(storage, item.storagePath));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name; anchor.target = "_blank"; anchor.rel = "noopener";
    document.body.append(anchor); anchor.click(); anchor.remove();
  } catch (error) { toast(friendlyError(error), "error"); }
}

function descendantsOf(itemId) {
  const result = [];
  const walk = (parentId) => allItems.filter((item) => item.parentId === parentId).forEach((item) => { result.push(item); if (item.type === "folder") walk(item.id); });
  walk(itemId);
  return result;
}

async function trashItem(item) {
  const ok = await confirmAction("ゴミ箱へ移動しますか？", item.type === "folder" ? "フォルダ内のファイルもまとめてゴミ箱へ移動します。" : `「${item.name}」をゴミ箱へ移動します。`, "移動する");
  if (!ok) return;
  try {
    const targets = [item, ...descendantsOf(item.id)];
    const batch = writeBatch(db);
    targets.forEach((target) => batch.update(doc(db, "users", currentUser.uid, "items", target.id), { trashed: true, trashedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await batch.commit();
    toast("ゴミ箱へ移動しました。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function restoreItem(item) {
  try {
    const targets = [item, ...descendantsOf(item.id)];
    const batch = writeBatch(db);
    const map = itemMap();
    const safeParent = item.parentId && map.get(item.parentId)?.trashed ? ROOT : (item.parentId || ROOT);
    targets.forEach((target, index) => batch.update(doc(db, "users", currentUser.uid, "items", target.id), {
      trashed: false, trashedAt: null, updatedAt: serverTimestamp(), ...(index === 0 ? { parentId: safeParent } : {})
    }));
    await batch.commit();
    toast("元の場所へ復元しました。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function permanentlyDelete(item) {
  const ok = await confirmAction("完全に削除しますか？", "この操作は取り消せません。フォルダの場合は中身もすべて削除されます。", "完全に削除");
  if (!ok) return;
  const targets = [item, ...descendantsOf(item.id)];
  try {
    for (const target of targets.filter((entry) => entry.type === "file" && entry.storagePath)) {
      try { await deleteObject(ref(storage, target.storagePath)); }
      catch (error) { if (error?.code !== "storage/object-not-found") throw error; }
    }
    const batch = writeBatch(db);
    targets.forEach((target) => batch.delete(doc(db, "users", currentUser.uid, "items", target.id)));
    await batch.commit();
    toast("完全に削除しました。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function createFolder() {
  const name = await promptText("新しいフォルダ", "フォルダ名", "新しいフォルダ", "作成");
  if (!name) return;
  try {
    const itemRef = doc(collection(db, "users", currentUser.uid, "items"));
    await setDoc(itemRef, { ownerId: currentUser.uid, type: "folder", name, parentId: currentFolderId, trashed: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast("フォルダを作成しました。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function renameItem(item) {
  const name = await promptText("名前を変更", "新しい名前", item.name, "変更");
  if (!name || name === item.name) return;
  try {
    await updateDoc(doc(db, "users", currentUser.uid, "items", item.id), { name, updatedAt: serverTimestamp() });
    toast("名前を変更しました。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

function promptText(title, label, value, submitLabel) {
  return new Promise((resolve) => {
    els.textDialogTitle.textContent = title; els.textDialogLabel.textContent = label; els.textDialogInput.value = value;
    els.textDialogSubmit.textContent = submitLabel; els.textDialogError.textContent = "";
    textDialogHandler = resolve;
    els.textDialog.showModal();
    setTimeout(() => { els.textDialogInput.focus(); els.textDialogInput.select(); }, 50);
  });
}

els.textDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = els.textDialogInput.value.trim();
  if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
    els.textDialogError.textContent = "1文字以上で、/ と \\ を含まない名前にしてください。";
    return;
  }
  els.textDialog.close();
  textDialogHandler?.(value); textDialogHandler = null;
});
els.textDialog.addEventListener("close", () => { if (textDialogHandler) { textDialogHandler(null); textDialogHandler = null; } });

function confirmAction(title, text, buttonLabel) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title; els.confirmText.textContent = text; els.confirmOk.textContent = buttonLabel;
    els.confirmDialog.showModal();
    els.confirmDialog.addEventListener("close", () => resolve(els.confirmDialog.returnValue === "ok"), { once: true });
  });
}

function uploadDestination() { return currentView === "files" ? currentFolderId : ROOT; }

function uploadFiles(fileList) {
  if (!currentUser) return;
  const files = [...fileList];
  if (!files.length) return;
  files.forEach(uploadOne);
}

function uploadOne(file) {
  if (file.size > MAX_FILE_SIZE) { toast(`${file.name} は250MBを超えています。`, "error"); return; }
  const itemRef = doc(collection(db, "users", currentUser.uid, "items"));
  const storagePath = `users/${currentUser.uid}/files/${itemRef.id}`;
  const uploadTask = uploadBytesResumable(ref(storage, storagePath), file, { contentType: file.type || "application/octet-stream", customMetadata: { originalName: file.name } });
  const queueNode = createUploadNode(file, uploadTask);
  els.uploadQueue.classList.remove("hidden");
  els.uploadQueue.append(queueNode.root);
  uploadTask.on("state_changed", (snapshot) => {
    const percent = snapshot.totalBytes ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100 : 0;
    queueNode.bar.style.width = `${percent}%`;
    queueNode.status.textContent = `${Math.round(percent)}% ・ ${formatBytes(snapshot.bytesTransferred)} / ${formatBytes(snapshot.totalBytes)}`;
  }, (error) => {
    queueNode.root.remove(); cleanupUploadQueue();
    if (error?.code !== "storage/canceled") toast(`${file.name}: ${friendlyError(error)}`, "error");
  }, async () => {
    try {
      await setDoc(itemRef, {
        ownerId: currentUser.uid, type: "file", name: file.name, parentId: uploadDestination(), storagePath,
        mimeType: file.type || "application/octet-stream", size: file.size, trashed: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      queueNode.status.textContent = "完了"; queueNode.bar.style.width = "100%";
      setTimeout(() => { queueNode.root.remove(); cleanupUploadQueue(); }, 900);
    } catch (error) {
      try { await deleteObject(ref(storage, storagePath)); } catch (_) {}
      queueNode.root.remove(); cleanupUploadQueue(); toast(`${file.name}: ${friendlyError(error)}`, "error");
    }
  });
}

function createUploadNode(file, task) {
  const root = document.createElement("div"); root.className = "upload-item";
  const icon = document.createElement("span"); icon.textContent = "⇧";
  const info = document.createElement("div"); info.className = "upload-info";
  const strong = document.createElement("strong"); strong.textContent = file.name;
  const status = document.createElement("small"); status.textContent = `準備中 ・ ${formatBytes(file.size)}`;
  const progress = document.createElement("div"); progress.className = "progress";
  const bar = document.createElement("i"); progress.append(bar); info.append(strong, status, progress);
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "upload-cancel"; cancel.textContent = "×"; cancel.ariaLabel = "キャンセル"; cancel.onclick = () => task.cancel();
  root.append(icon, info, cancel); return { root, bar, status };
}
function cleanupUploadQueue() { if (!els.uploadQueue.children.length) els.uploadQueue.classList.add("hidden"); }

[els.upload, els.uploadTop, els.emptyUpload].forEach((button) => button.addEventListener("click", () => els.fileInput.click()));
els.fileInput.addEventListener("change", () => { uploadFiles(els.fileInput.files); els.fileInput.value = ""; });
els.newFolder.addEventListener("click", createFolder);

["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => document.addEventListener(eventName, (event) => { event.preventDefault(); event.stopPropagation(); }));
document.addEventListener("dragenter", () => { dragDepth += 1; els.dropOverlay.classList.remove("hidden"); });
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.dropOverlay.classList.add("hidden"); });
document.addEventListener("drop", (event) => { dragDepth = 0; els.dropOverlay.classList.add("hidden"); uploadFiles(event.dataTransfer.files); });

function setView(view) {
  currentView = view; currentFolderId = ROOT; els.search.value = ""; closeSidebar(); render();
}
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
els.search.addEventListener("input", render);
els.sort.addEventListener("click", () => { sortMode = sortMode === "updated" ? "name" : "updated"; els.sort.textContent = sortMode === "updated" ? "更新順 ↕" : "名前順 ↕"; render(); });
els.refresh.addEventListener("click", () => { render(); toast("最新の表示に更新しました。", "success"); });
document.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); els.search.focus(); } });

els.userButton.addEventListener("click", (event) => { event.stopPropagation(); els.userMenu.classList.toggle("hidden"); });
document.addEventListener("click", () => els.userMenu.classList.add("hidden"));
els.userMenu.addEventListener("click", (event) => event.stopPropagation());
function openSidebar() { els.sidebar.classList.add("open"); els.sidebarShade.classList.remove("hidden"); }
function closeSidebar() { els.sidebar.classList.remove("open"); els.sidebarShade.classList.add("hidden"); }
els.mobileMenuButton.addEventListener("click", openSidebar); els.closeSidebar.addEventListener("click", closeSidebar); els.sidebarShade.addEventListener("click", closeSidebar);

setAuthMode("login");
setTimeout(() => { if (!currentUser && !els.loading.classList.contains("hidden")) showOnly("auth"); }, 7000);
