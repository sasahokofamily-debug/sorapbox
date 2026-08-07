import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, collection, doc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app),ROOT="root";
let user=null,items=[],unsub=null,timer=0,moveItem=null;

const style=document.createElement("style");
style.textContent=`
#soraMoveDialog{width:min(92vw,520px);max-height:82vh;border:0;border-radius:20px;padding:0;background:#fff;color:#172033;box-shadow:0 28px 90px rgba(15,23,42,.28)}
#soraMoveDialog::backdrop{background:rgba(15,23,42,.48);backdrop-filter:blur(4px)}
.sora-move-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e6ebf2}.sora-move-head h2{margin:0;font-size:19px}.sora-move-close{width:36px;height:36px;border:0;border-radius:50%;font-size:20px;background:#f1f4f8}
.sora-move-body{padding:16px 18px 20px}.sora-move-name{margin:0 0 13px;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sora-folder-list{display:grid;gap:7px;max-height:52vh;overflow:auto}.sora-folder-choice{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;border:1px solid #e1e7ef;border-radius:11px;text-align:left;background:#fff;color:#263449;font:inherit;font-size:13px;font-weight:700}.sora-folder-choice:hover{background:#f4f8ff;border-color:#b9d5ff}.sora-folder-choice small{margin-left:auto;color:#8490a3;font-size:10px}.sora-move-status{min-height:19px;margin:11px 0 0;font-size:12px;font-weight:700;color:#64748b}.sora-move-status.err{color:#c0392b}
`;
document.head.appendChild(style);

function ms(v){return !v?0:typeof v.toMillis==="function"?v.toMillis():v.seconds?v.seconds*1000:new Date(v).getTime()||0}
function currentFolder(){
  const view=document.querySelector('.nav-item.active')?.dataset.view;
  if(view&&view!=="files")return ROOT;
  let parent=ROOT;
  const names=[...document.querySelectorAll("#breadcrumbs button")].slice(1).map(x=>x.textContent.trim());
  for(const name of names){
    const f=items.find(x=>x.type==="folder"&&!x.trashed&&(x.parentId||ROOT)===parent&&x.name===name);
    if(!f)break;
    parent=f.id;
  }
  return parent;
}
function visibleItems(){
  const view=document.querySelector('.nav-item.active')?.dataset.view||"files",folder=currentFolder();
  const q=(document.getElementById("searchInput")?.value||"").trim().toLowerCase(),map=new Map(items.map(x=>[x.id,x]));
  let a=view==="trash"?items.filter(x=>x.trashed&&!map.get(x.parentId)?.trashed):view==="recent"?items.filter(x=>!x.trashed&&x.type==="file"):items.filter(x=>!x.trashed&&(x.parentId||ROOT)===folder);
  if(q)a=items.filter(x=>(view==="trash"?x.trashed:!x.trashed)&&String(x.name||"").toLowerCase().includes(q));
  const nameSort=(document.getElementById("sortButton")?.textContent||"").includes("名前");
  return a.sort((a,b)=>nameSort?String(a.name||"").localeCompare(String(b.name||""),"ja",{numeric:true}):a.type!==b.type&&view==="files"?(a.type==="folder"?-1:1):ms(b.updatedAt||b.createdAt)-ms(a.updatedAt||a.createdAt));
}
function folderPath(folder){
  const map=new Map(items.filter(x=>x.type==="folder").map(x=>[x.id,x])),parts=[];let cur=folder,guard=0;
  while(cur&&guard++<30){parts.unshift(cur.name||"フォルダ");cur=map.get(cur.parentId)}
  return parts.join(" / ");
}
function dialog(){
  let d=document.getElementById("soraMoveDialog");if(d)return d;
  d=document.createElement("dialog");d.id="soraMoveDialog";
  d.innerHTML=`<div class="sora-move-head"><h2>📁 フォルダへ移動</h2><button id="soraMoveClose" class="sora-move-close" type="button">×</button></div><div class="sora-move-body"><p id="soraMoveName" class="sora-move-name"></p><div id="soraFolderList" class="sora-folder-list"></div><p id="soraMoveStatus" class="sora-move-status"></p></div>`;
  document.body.appendChild(d);d.querySelector("#soraMoveClose").onclick=()=>d.close();return d;
}
function openMove(item){
  moveItem=item;const d=dialog(),list=d.querySelector("#soraFolderList"),status=d.querySelector("#soraMoveStatus");
  d.querySelector("#soraMoveName").textContent=`「${item.name}」の移動先を選んでください`;
  status.textContent="";status.className="sora-move-status";list.replaceChildren();
  const choices=[{id:ROOT,name:"マイファイル",root:true},...items.filter(x=>x.type==="folder"&&!x.trashed&&x.id!==item.id).sort((a,b)=>folderPath(a).localeCompare(folderPath(b),"ja",{numeric:true}))];
  choices.forEach(f=>{
    if((item.parentId||ROOT)===f.id)return;
    const b=document.createElement("button");b.type="button";b.className="sora-folder-choice";
    const label=document.createElement("span");label.textContent=f.root?"📂 マイファイル":`📁 ${f.name}`;
    const small=document.createElement("small");small.textContent=f.root?"一番上":folderPath(f);
    b.append(label,small);b.onclick=()=>moveTo(f.id,d);list.appendChild(b);
  });
  if(!list.children.length){const p=document.createElement("p");p.textContent="移動できる別のフォルダがありません。";p.style.cssText="font-size:13px;color:#64748b;padding:12px";list.appendChild(p)}
  if(!d.open)d.showModal();
}
async function moveTo(folderId,d){
  if(!user||!moveItem)return;const status=d.querySelector("#soraMoveStatus");status.textContent="移動しています…";
  d.querySelectorAll(".sora-folder-choice").forEach(b=>b.disabled=true);
  try{
    await updateDoc(doc(db,"users",user.uid,"items",moveItem.id),{parentId:folderId,updatedAt:serverTimestamp()});
    status.textContent="移動しました。";setTimeout(()=>d.close(),450);
  }catch(e){console.error("move file",e);status.textContent="移動できませんでした。";status.className="sora-move-status err";d.querySelectorAll(".sora-folder-choice").forEach(b=>b.disabled=false)}
}
function install(){
  if(!user)return;const visible=visibleItems(),rows=[...document.querySelectorAll("#fileList tr")];
  rows.forEach((row,i)=>{
    const item=visible[i],menu=row.querySelector(".row-menu");if(!item||!menu||item.trashed||item.type!=="file")return;
    row.dataset.soraMoveItemId=item.id;
    let b=menu.querySelector(".sora-move-file");
    if(!b){b=document.createElement("button");b.type="button";b.className="sora-move-file";b.textContent="フォルダへ移動";const danger=menu.querySelector(".danger");menu.insertBefore(b,danger||null)}
    b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();menu.classList.add("hidden");const latest=items.find(x=>x.id===row.dataset.soraMoveItemId);if(latest)openMove(latest)};
  });
}
function schedule(){clearTimeout(timer);timer=setTimeout(install,120)}
onAuthStateChanged(auth,u=>{user=u;items=[];if(unsub){unsub();unsub=null}if(!u)return;unsub=onSnapshot(collection(db,"users",u.uid,"items"),s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));schedule()},e=>console.warn("folder move snapshot",e));setTimeout(schedule,400)});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener("click",e=>{if(e.target.closest(".nav-item,#sortButton,#breadcrumbs"))schedule()});
document.getElementById("searchInput")?.addEventListener("input",schedule);
console.info("sorapbox folder move v1.5.5 loaded");
