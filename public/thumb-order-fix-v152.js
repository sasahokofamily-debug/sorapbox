import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app),ROOT="root";
let user=null,items=[],unsub=null,timer=0;
const jobs=new Map();

function ms(v){return !v?0:typeof v.toMillis==="function"?v.toMillis():v.seconds?v.seconds*1000:new Date(v).getTime()||0}
function from64(s){const b=atob(s||""),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
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
async function itemBlob(item){
  const s=await getDocs(query(collection(db,"users",user.uid,"items",item.id,"chunks"),orderBy("index","asc")));
  if(s.empty)throw new Error("画像データがありません");
  return new Blob(s.docs.map(d=>from64(d.data().data)),{type:item.mimeType||"image/jpeg"});
}
async function makeThumb(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
    const side=Math.min(img.naturalWidth,img.naturalHeight),sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;
    const c=document.createElement("canvas");c.width=96;c.height=96;
    const ctx=c.getContext("2d");if(!ctx)return null;
    ctx.drawImage(img,sx,sy,side,side,0,0,96,96);
    let out=c.toDataURL("image/webp",.72);
    if(!out.startsWith("data:image/webp"))out=c.toDataURL("image/jpeg",.75);
    return out;
  }finally{URL.revokeObjectURL(url)}
}
async function thumb(item){
  if(item.thumbnailDataUrl)return item.thumbnailDataUrl;
  if(jobs.has(item.id))return jobs.get(item.id);
  const p=(async()=>{
    try{
      const data=await makeThumb(await itemBlob(item));
      if(data)await setDoc(doc(db,"users",user.uid,"items",item.id),{ownerId:user.uid,thumbnailDataUrl:data},{merge:true});
      return data;
    }catch(e){console.warn("thumb order fix",item.id,e);return null}
    finally{jobs.delete(item.id)}
  })();
  jobs.set(item.id,p);return p;
}
function apply(row,item,src){
  if(!row?.isConnected||!item||!src)return;
  const icon=row.querySelector(".file-icon.image,.file-icon.sora-thumb-fixed");
  if(!icon)return;
  icon.classList.remove("image","sora-thumb");
  icon.classList.add("sora-thumb-fixed");
  icon.style.padding="0";icon.style.overflow="hidden";icon.style.borderRadius="10px";icon.textContent="";
  const img=document.createElement("img");img.src=src;img.alt="";img.style.cssText="display:block;width:100%;height:100%;object-fit:cover";
  icon.appendChild(img);
  row.dataset.soraItemId=item.id;
}
async function paint(){
  if(!user)return;
  const rows=[...document.querySelectorAll("#fileList tr")];
  const visible=visibleItems();
  for(let i=0;i<rows.length;i++){
    const row=rows[i],item=visible[i];
    if(!item||item.type!=="file"||!String(item.mimeType||"").startsWith("image/"))continue;
    const src=item.thumbnailDataUrl||await thumb(item);
    if(src)apply(row,item,src);
  }
}
function schedule(){clearTimeout(timer);timer=setTimeout(paint,260)}

onAuthStateChanged(auth,u=>{
  user=u;items=[];
  if(unsub){unsub();unsub=null}
  if(!u)return;
  unsub=onSnapshot(collection(db,"users",u.uid,"items"),s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));schedule()},e=>console.warn("thumb order snapshot",e));
  setTimeout(schedule,500);
});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
["searchInput","sortButton"].forEach(id=>document.getElementById(id)?.addEventListener("input",schedule));
document.addEventListener("click",e=>{if(e.target.closest(".nav-item,#sortButton,#breadcrumbs"))schedule()});
console.info("sorapbox thumbnail order fix v1.5.2 loaded");
