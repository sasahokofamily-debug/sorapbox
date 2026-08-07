import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const KEY = "sorapbox:remember-login";

function rememberEnabled(){
  return localStorage.getItem(KEY) !== "0";
}

async function applyPersistence(remember, savePreference=false){
  if(savePreference) localStorage.setItem(KEY, remember ? "1" : "0");
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

// app.js は従来 local persistence を指定しているため、端末設定を最後に再適用する。
applyPersistence(rememberEnabled(), false).catch(error=>console.warn("login persistence", error));

const style=document.createElement("style");
style.textContent=`
.account-remember-row{display:flex;align-items:flex-start;gap:12px;padding:13px 14px;border:1px solid #dbe4ef;border-radius:13px;background:#f8fbff;cursor:pointer}
.account-remember-row input{width:20px;height:20px;margin:2px 0 0;accent-color:#1677ff;flex:none;cursor:pointer}
.account-remember-copy{display:block;min-width:0}.account-remember-copy strong{display:block;font-size:14px;color:#172033}.account-remember-copy small{display:block;margin-top:4px;color:#64748b;font-size:12px;line-height:1.5;font-weight:500}
`;
document.head.appendChild(style);

function setStatus(text,type=""){
  const el=document.getElementById("accountRememberStatus");
  if(!el)return;
  el.textContent=text;
  el.className=`account-status ${type}`.trim();
}

function installRememberSetting(){
  const dialog=document.getElementById("accountDialog");
  if(!dialog || dialog.querySelector("#accountRememberLogin")) return;
  const scroll=dialog.querySelector(".account-scroll");
  if(!scroll)return;

  const section=document.createElement("section");
  section.className="account-section";
  section.id="accountLoginSection";
  section.innerHTML=`
    <h3>ログイン</h3>
    <label class="account-remember-row">
      <input id="accountRememberLogin" type="checkbox">
      <span class="account-remember-copy">
        <strong>この端末でログイン状態を保持</strong>
        <small>ONにすると、この端末のこのブラウザだけで次回もログイン状態を保持します。他の端末には引き継がれません。OFFの場合はブラウザを閉じるまで保持します。</small>
      </span>
    </label>
    <p id="accountRememberStatus" class="account-status"></p>`;

  const sections=scroll.querySelectorAll(".account-section");
  const passwordSection=sections[1];
  if(passwordSection) scroll.insertBefore(section,passwordSection);
  else scroll.appendChild(section);

  const checkbox=section.querySelector("#accountRememberLogin");
  checkbox.checked=rememberEnabled();
  checkbox.onchange=async()=>{
    const desired=checkbox.checked;
    const previous=!desired;
    checkbox.disabled=true;
    setStatus("設定を変更しています…");
    try{
      await applyPersistence(desired,true);
      setStatus(
        desired
          ? "この端末では、ブラウザを閉じてもログイン状態を保持します。"
          : "ログイン保持をOFFにしました。ブラウザを閉じるとログアウトします。",
        "ok"
      );
    }catch(error){
      checkbox.checked=previous;
      localStorage.setItem(KEY, previous ? "1" : "0");
      setStatus("ログイン保持の設定を変更できませんでした。","err");
      console.warn("login persistence change",error);
    }finally{
      checkbox.disabled=false;
    }
  };
}

const observer=new MutationObserver(()=>installRememberSetting());
observer.observe(document.documentElement,{childList:true,subtree:true});
installRememberSetting();

console.info("sorapbox login persistence v1.4 loaded");
