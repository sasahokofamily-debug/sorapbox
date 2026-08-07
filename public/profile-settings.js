import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let profile = {};
let profileUnsub = null;
let pendingAvatar = undefined;

const style = document.createElement("style");
style.textContent = `
#accountSettingsButton{font-weight:800!important}
#accountDialog{width:min(92vw,620px);max-height:min(88vh,820px);border:0;border-radius:24px;padding:0;background:#fff;color:#172033;box-shadow:0 28px 90px rgba(15,23,42,.28)}
#accountDialog::backdrop{background:rgba(15,23,42,.48);backdrop-filter:blur(5px)}
.account-head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px 14px;border-bottom:1px solid #e8edf5}.account-head h2{margin:0;font-size:22px}.account-close{width:38px;height:38px;border:0;border-radius:50%;background:#f0f4f9;font-size:22px;cursor:pointer}
.account-scroll{padding:20px 22px 26px;overflow:auto;max-height:calc(88vh - 74px)}
.account-section{border:1px solid #e4eaf2;border-radius:18px;padding:18px;margin-bottom:16px;background:#fff}.account-section h3{font-size:16px;margin:0 0 14px}.account-muted{color:#64748b;font-size:12px;line-height:1.55}
.account-avatar-row{display:flex;align-items:center;gap:16px;margin-bottom:16px}.account-avatar-preview{width:82px;height:82px;border-radius:50%;background:linear-gradient(135deg,#1677ff,#695cff);display:grid;place-items:center;color:#fff;font-size:30px;font-weight:900;overflow:hidden;flex:none;box-shadow:0 7px 24px rgba(22,119,255,.22)}.account-avatar-preview img{width:100%;height:100%;object-fit:cover;display:block}
.account-avatar-actions{display:flex;gap:8px;flex-wrap:wrap}.account-btn{border:1px solid #d7e0eb;background:#fff;color:#172033;border-radius:11px;padding:10px 13px;font:inherit;font-weight:750;cursor:pointer}.account-btn:hover{background:#f6f9fc}.account-btn.primary{background:#1677ff;border-color:#1677ff;color:#fff}.account-btn.danger{color:#c03535}.account-btn:disabled{opacity:.55;cursor:wait}
.account-field{display:block;margin:12px 0}.account-field span{display:block;font-size:12px;font-weight:800;color:#536174;margin-bottom:6px}.account-field input{width:100%;height:44px;border:1px solid #ccd7e5;border-radius:11px;padding:0 12px;font:inherit;outline:none;background:#fff}.account-field input:focus{border-color:#1677ff;box-shadow:0 0 0 3px rgba(22,119,255,.12)}.account-field input[readonly]{background:#f5f7fa;color:#64748b}
.account-status{min-height:20px;margin:10px 0 0;font-size:13px;font-weight:700}.account-status.ok{color:#16834a}.account-status.err{color:#c0392b}.account-actions-end{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.avatar-button .profile-avatar-img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}.avatar-button.has-profile-image{padding:0;overflow:hidden}.avatar-button.has-profile-image #avatarInitial{display:none}
@media(max-width:600px){#accountDialog{width:96vw;border-radius:20px}.account-scroll{padding:16px}.account-section{padding:15px}.account-avatar-row{align-items:flex-start}.account-avatar-preview{width:70px;height:70px}.account-actions-end{flex-direction:column}.account-actions-end .account-btn{width:100%}}
`;
document.head.appendChild(style);

function makeDialog(){
  if(document.getElementById("accountDialog")) return document.getElementById("accountDialog");
  const dialog=document.createElement("dialog");
  dialog.id="accountDialog";
  dialog.innerHTML=`
    <div class="account-head">
      <h2>アカウント設定</h2>
      <button id="accountCloseButton" class="account-close" type="button" aria-label="閉じる">×</button>
    </div>
    <div class="account-scroll">
      <section class="account-section">
        <h3>プロフィール</h3>
        <div class="account-avatar-row">
          <div id="accountAvatarPreview" class="account-avatar-preview"><span id="accountAvatarLetter">S</span></div>
          <div>
            <div class="account-avatar-actions">
              <button id="accountChooseAvatar" class="account-btn primary" type="button">画像を選ぶ</button>
              <button id="accountRemoveAvatar" class="account-btn danger" type="button">初期アイコンに戻す</button>
              <input id="accountAvatarInput" type="file" accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg" hidden>
            </div>
            <p class="account-muted">PNG・JPG・SVG対応。選んだ画像は192×192に自動縮小して保存します。</p>
          </div>
        </div>
        <label class="account-field"><span>表示名</span><input id="accountDisplayName" type="text" maxlength="40" placeholder="表示名を入力"></label>
        <label class="account-field"><span>メールアドレス</span><input id="accountEmail" type="email" readonly></label>
        <div class="account-actions-end"><button id="accountSaveProfile" class="account-btn primary" type="button">プロフィールを保存</button></div>
        <p id="accountProfileStatus" class="account-status"></p>
      </section>

      <section class="account-section">
        <h3>パスワード変更</h3>
        <p class="account-muted">安全のため、現在のパスワードを確認してから変更します。</p>
        <label class="account-field"><span>現在のパスワード</span><input id="accountCurrentPassword" type="password" autocomplete="current-password"></label>
        <label class="account-field"><span>新しいパスワード</span><input id="accountNewPassword" type="password" minlength="6" autocomplete="new-password" placeholder="6文字以上"></label>
        <label class="account-field"><span>新しいパスワード（確認）</span><input id="accountConfirmPassword" type="password" minlength="6" autocomplete="new-password"></label>
        <div class="account-actions-end"><button id="accountChangePassword" class="account-btn primary" type="button">パスワードを変更</button></div>
        <p id="accountPasswordStatus" class="account-status"></p>
      </section>
    </div>`;
  document.body.appendChild(dialog);
  bindDialog(dialog);
  return dialog;
}

function messageFor(error){
  const code=error?.code||"";
  const map={
    "auth/invalid-credential":"現在のパスワードが違います。",
    "auth/wrong-password":"現在のパスワードが違います。",
    "auth/weak-password":"新しいパスワードを6文字以上にしてください。",
    "auth/requires-recent-login":"もう一度ログインしてから変更してください。",
    "auth/too-many-requests":"操作回数が多すぎます。少し時間をおいてください。",
    "permission-denied":"プロフィールの保存権限がありません。Firestoreルールを確認してください。"
  };
  return map[code] || error?.message || "処理に失敗しました。";
}

function initials(){
  const source=(profile.displayName||currentUser?.email||"S").trim();
  return (source[0]||"S").toUpperCase();
}

function renderAvatar(target,dataUrl,letterId){
  target.replaceChildren();
  if(dataUrl){
    const img=document.createElement("img");
    img.src=dataUrl;
    img.alt="アカウントアイコン";
    target.appendChild(img);
  }else{
    const span=document.createElement("span");
    if(letterId) span.id=letterId;
    span.textContent=initials();
    target.appendChild(span);
  }
}

function applyTopProfile(){
  const button=document.getElementById("userButton");
  const letter=document.getElementById("avatarInitial");
  if(button){
    let img=button.querySelector(".profile-avatar-img");
    if(profile.avatarDataUrl){
      if(!img){img=document.createElement("img");img.className="profile-avatar-img";img.alt="アカウントアイコン";button.appendChild(img)}
      img.src=profile.avatarDataUrl;
      button.classList.add("has-profile-image");
      if(letter) letter.style.display="none";
    }else{
      img?.remove();
      button.classList.remove("has-profile-image");
      if(letter){letter.style.display="";letter.textContent=initials()}
    }
  }
  const menuName=document.getElementById("userEmail");
  if(menuName) menuName.textContent=profile.displayName||currentUser?.email||"sorapbox user";
  const menu=document.getElementById("userMenu");
  if(menu){
    const info=[...menu.children].find(n=>n.tagName==="SPAN");
    if(info) info.textContent=currentUser?.email||"";
  }
}

function fillDialog(){
  const d=makeDialog();
  const name=d.querySelector("#accountDisplayName");
  const email=d.querySelector("#accountEmail");
  name.value=profile.displayName||"";
  email.value=currentUser?.email||"";
  pendingAvatar=undefined;
  renderAvatar(d.querySelector("#accountAvatarPreview"),profile.avatarDataUrl,"accountAvatarLetter");
  setStatus("accountProfileStatus","");
  setStatus("accountPasswordStatus","");
  ["accountCurrentPassword","accountNewPassword","accountConfirmPassword"].forEach(id=>d.querySelector(`#${id}`).value="");
}

function setStatus(id,text,type=""){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=text;
  el.className=`account-status ${type}`.trim();
}

async function imageToSmallDataUrl(file){
  if(file.size>5*1024*1024) throw new Error("画像は5MB以下にしてください。");
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  const allowed=["png","jpg","jpeg","svg"];
  if(!file.type.startsWith("image/")&&!allowed.includes(ext)) throw new Error("PNG・JPG・SVGを選んでください。");
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("画像を読み込めませんでした。"));img.src=url});
    const size=192,canvas=document.createElement("canvas");
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx) throw new Error("画像を変換できませんでした。");
    const sw=img.naturalWidth||img.width,sh=img.naturalHeight||img.height;
    if(!sw||!sh) throw new Error("画像サイズを確認できませんでした。");
    const side=Math.min(sw,sh),sx=(sw-side)/2,sy=(sh-side)/2;
    ctx.clearRect(0,0,size,size);
    ctx.drawImage(img,sx,sy,side,side,0,0,size,size);
    let out=canvas.toDataURL("image/webp",0.86);
    if(!out.startsWith("data:image/webp")) out=canvas.toDataURL("image/png");
    if(out.length>650000) throw new Error("画像データが大きすぎます。別の画像を選んでください。");
    return out;
  }finally{URL.revokeObjectURL(url)}
}

function bindDialog(dialog){
  const q=id=>dialog.querySelector(`#${id}`);
  q("accountCloseButton").onclick=()=>dialog.close();
  q("accountChooseAvatar").onclick=()=>q("accountAvatarInput").click();
  q("accountAvatarInput").onchange=async()=>{
    const file=q("accountAvatarInput").files?.[0];
    q("accountAvatarInput").value="";
    if(!file)return;
    setStatus("accountProfileStatus","画像を変換しています…");
    try{
      pendingAvatar=await imageToSmallDataUrl(file);
      renderAvatar(q("accountAvatarPreview"),pendingAvatar,"accountAvatarLetter");
      setStatus("accountProfileStatus","新しいアイコンを選びました。保存すると反映されます。","ok");
    }catch(error){setStatus("accountProfileStatus",messageFor(error),"err")}
  };
  q("accountRemoveAvatar").onclick=()=>{
    pendingAvatar=null;
    renderAvatar(q("accountAvatarPreview"),null,"accountAvatarLetter");
    setStatus("accountProfileStatus","初期アイコンに戻します。保存すると反映されます。","ok");
  };
  q("accountSaveProfile").onclick=async()=>{
    if(!currentUser)return;
    const button=q("accountSaveProfile"),name=q("accountDisplayName").value.trim();
    if(name.length>40){setStatus("accountProfileStatus","表示名は40文字以内にしてください。","err");return}
    button.disabled=true;setStatus("accountProfileStatus","保存しています…");
    try{
      const changes={uid:currentUser.uid,email:currentUser.email||"",displayName:name,updatedAt:serverTimestamp()};
      if(pendingAvatar!==undefined) changes.avatarDataUrl=pendingAvatar;
      await setDoc(doc(db,"users",currentUser.uid),changes,{merge:true});
      await updateProfile(currentUser,{displayName:name||null}).catch(()=>{});
      pendingAvatar=undefined;
      setStatus("accountProfileStatus","プロフィールを保存しました。","ok");
    }catch(error){setStatus("accountProfileStatus",messageFor(error),"err")}
    finally{button.disabled=false}
  };
  q("accountChangePassword").onclick=async()=>{
    if(!currentUser?.email)return;
    const button=q("accountChangePassword"),current=q("accountCurrentPassword").value,newPass=q("accountNewPassword").value,confirm=q("accountConfirmPassword").value;
    if(!current){setStatus("accountPasswordStatus","現在のパスワードを入力してください。","err");return}
    if(newPass.length<6){setStatus("accountPasswordStatus","新しいパスワードは6文字以上にしてください。","err");return}
    if(newPass!==confirm){setStatus("accountPasswordStatus","新しいパスワードが一致しません。","err");return}
    button.disabled=true;setStatus("accountPasswordStatus","本人確認中…");
    try{
      const credential=EmailAuthProvider.credential(currentUser.email,current);
      await reauthenticateWithCredential(currentUser,credential);
      await updatePassword(currentUser,newPass);
      q("accountCurrentPassword").value="";q("accountNewPassword").value="";q("accountConfirmPassword").value="";
      setStatus("accountPasswordStatus","パスワードを変更しました。","ok");
    }catch(error){setStatus("accountPasswordStatus",messageFor(error),"err")}
    finally{button.disabled=false}
  };
}

function installMenuButton(){
  const menu=document.getElementById("userMenu"),logout=document.getElementById("logoutButton");
  if(!menu||!logout||document.getElementById("accountSettingsButton"))return;
  const b=document.createElement("button");
  b.id="accountSettingsButton";b.type="button";b.textContent="⚙ アカウント設定";
  b.onclick=event=>{event.stopPropagation();fillDialog();makeDialog().showModal();menu.classList.add("hidden")};
  menu.insertBefore(b,logout);
}

onAuthStateChanged(auth,user=>{
  currentUser=user;
  if(profileUnsub){profileUnsub();profileUnsub=null}
  profile={};pendingAvatar=undefined;
  if(!user)return;
  installMenuButton();
  profileUnsub=onSnapshot(doc(db,"users",user.uid),snap=>{
    profile=snap.exists()?snap.data():{};
    applyTopProfile();
  },error=>console.warn("profile snapshot",error));
  setTimeout(installMenuButton,500);
});

const observer=new MutationObserver(()=>installMenuButton());
observer.observe(document.documentElement,{childList:true,subtree:true});
console.info("sorapbox account settings v1.3 loaded");
