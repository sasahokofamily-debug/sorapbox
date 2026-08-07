import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app),ROOT="root";
let user=null,items=[],unsub=null,timer=0;

const style=document.createElement("style");
style.textContent=`
.sora-photo-dates{display:inline-flex;gap:6px;align-items:center;margin-left:10px;vertical-align:middle;white-space:nowrap;font-size:11px;color:#64748b;font-weight:650}
.sora-photo-date-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 6px;border-radius:8px;background:#f3f6fa;border:1px solid #e4eaf1}
@media(max-width:720px){.sora-photo-dates{display:flex;margin:4px 0 0;gap:4px;flex-wrap:wrap}.sora-photo-date-chip{font-size:10px;padding:2px 5px}}
`;
document.head.appendChild(style);

function ms(v){
  if(!v)return 0;
  if(typeof v==="number")return v;
  if(typeof v.toMillis==="function")return v.toMillis();
  if(v.seconds)return v.seconds*1000;
  return new Date(v).getTime()||0;
}
function fmt(v){
  const n=ms(v);if(!n)return "";
  return new Date(n).toLocaleString("ja-JP",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function currentFolder(){
  const view=document.querySelector('.nav-item.active')?.dataset.view;
  if(view&&view!=="files")return ROOT;
  let parent=ROOT;
  for(const name of [...document.querySelectorAll("#breadcrumbs button")].slice(1).map(x=>x.textContent.trim())){
    const f=items.find(x=>x.type==="folder"&&!x.trashed&&(x.parentId||ROOT)===parent&&x.name===name);
    if(!f)break;
    parent=f.id;
  }
  return parent;
}
function visibleItems(){
  const view=document.querySelector('.nav-item.active')?.dataset.view||"files";
  const folder=currentFolder();
  const q=(document.getElementById("searchInput")?.value||"").trim().toLowerCase();
  const map=new Map(items.map(x=>[x.id,x]));
  let a=view==="trash"
    ? items.filter(x=>x.trashed&&!map.get(x.parentId)?.trashed)
    : view==="recent"
      ? items.filter(x=>!x.trashed&&x.type==="file")
      : items.filter(x=>!x.trashed&&(x.parentId||ROOT)===folder);
  if(q)a=items.filter(x=>(view==="trash"?x.trashed:!x.trashed)&&String(x.name||"").toLowerCase().includes(q));
  const nameSort=(document.getElementById("sortButton")?.textContent||"").includes("名前");
  return a.sort((a,b)=>{
    if(nameSort)return String(a.name||"").localeCompare(String(b.name||""),"ja",{numeric:true});
    if(a.type!==b.type&&view==="files")return a.type==="folder"?-1:1;
    return ms(b.updatedAt||b.createdAt)-ms(a.updatedAt||a.createdAt);
  });
}
function chip(label,value){
  const s=document.createElement("span");s.className="sora-photo-date-chip";s.textContent=`${label} ${value}`;return s;
}
function paint(){
  if(!user)return;
  const rows=[...document.querySelectorAll("#fileList tr")],visible=visibleItems();
  rows.forEach((row,i)=>{
    row.querySelector(".sora-photo-dates")?.remove();
    const item=visible[i];
    if(!item||item.type!=="file"||!String(item.mimeType||"").startsWith("image/"))return;
    const nameButton=row.querySelector(".file-name-button");
    if(!nameButton)return;
    const taken=fmt(item.photoTakenAtMs||item.sourceModifiedAtMs||item.capturedAt);
    const added=fmt(item.uploadedAt||item.createdAt);
    if(!taken&&!added)return;
    const box=document.createElement("span");box.className="sora-photo-dates";box.dataset.soraItemId=item.id;
    if(taken)box.appendChild(chip("📷 撮影",taken));
    if(added)box.appendChild(chip("☁ 追加",added));
    nameButton.insertAdjacentElement("afterend",box);
    row.dataset.soraItemId=item.id;
  });
}
function schedule(){clearTimeout(timer);timer=setTimeout(paint,180)}

onAuthStateChanged(auth,u=>{
  user=u;items=[];
  if(unsub){unsub();unsub=null}
  if(!u)return;
  unsub=onSnapshot(collection(db,"users",u.uid,"items"),s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));schedule()},e=>console.warn("photo date snapshot",e));
  setTimeout(schedule,500);
});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
["searchInput","sortButton"].forEach(id=>document.getElementById(id)?.addEventListener("input",schedule));
document.addEventListener("click",e=>{if(e.target.closest(".nav-item,#sortButton,#breadcrumbs"))schedule()});
console.info("sorapbox photo date labels v1.5.3 loaded");
