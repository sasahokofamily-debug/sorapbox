import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app),ROOT="root",CHUNK=256*1024,MAX=10*1024*1024;
let user=null,items=[],unsub=null,stream=null,capturedBlob=null,capturedUrl=null;
const thumbJobs=new Map();

const style=document.createElement("style");
style.textContent=`
.file-icon.image.sora-photo-thumb{padding:0!important;overflow:hidden!important;background:#eef4fb!important;border-radius:10px!important;color:transparent!important}
.file-icon.image.sora-photo-thumb img{width:100%;height:100%;object-fit:cover;display:block}
#soraCameraButton,#soraCameraTopButton{white-space:nowrap}
#soraCameraDialog{width:min(94vw,720px);max-height:92vh;border:0;border-radius:24px;padding:0;background:#fff;color:#172033;box-shadow:0 28px 90px rgba(15,23,42,.32)}
#soraCameraDialog::backdrop{background:rgba(15,23,42,.58);backdrop-filter:blur(4px)}
.sora-camera-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e5eaf1}.sora-camera-head h2{margin:0;font-size:21px}.sora-camera-close{width:38px;height:38px;border:0;border-radius:50%;background:#f0f4f9;font-size:22px;cursor:pointer}
.sora-camera-body{padding:18px 20px 22px;overflow:auto;max-height:calc(92vh - 74px)}
.sora-camera-view{position:relative;background:#0f172a;border-radius:18px;overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}.sora-camera-view video,.sora-camera-view img{width:100%;height:100%;object-fit:contain;display:block}.sora-camera-placeholder{color:#cbd5e1;text-align:center;padding:24px;line-height:1.6}
.sora-camera-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:13px}.sora-camera-btn{border:1px solid #d5deea;background:#fff;color:#172033;border-radius:11px;padding:10px 14px;font:inherit;font-weight:800;cursor:pointer}.sora-camera-btn.primary{background:#1677ff;border-color:#1677ff;color:#fff}.sora-camera-btn:disabled{opacity:.5;cursor:wait}
.sora-camera-fields{display:grid;grid-template-columns:1fr 140px;gap:10px;margin-top:16px}.sora-camera-field span{display:block;font-size:12px;font-weight:800;color:#536174;margin-bottom:6px}.sora-camera-field input,.sora-camera-field select{width:100%;height:44px;border:1px solid #ccd7e5;border-radius:11px;padding:0 12px;font:inherit;background:#fff}
.sora-camera-status{min-height:20px;font-size:13px;font-weight:750;margin:11px 0 0;color:#536174}.sora-camera-status.ok{color:#16834a}.sora-camera-status.err{color:#c0392b}
@media(max-width:620px){.sora-camera-fields{grid-template-columns:1fr}.sora-camera-actions .sora-camera-btn{flex:1}.heading-actions #soraCameraButton{padding-left:10px;padding-right:10px}}
`;
document.head.appendChild(style);

function from64(s){const b=atob(s||""),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function to64(a){let s="";for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,Math.min(i+32768,a.length)));return btoa(s)}
function extFor(type){return type==="image/png"?"png":"jpg"}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`}
function currentFolder(){
  const active=document.querySelector('.nav-item.active')?.dataset.view;
  if(active&&active!=="files")return ROOT;
  const names=[...document.querySelectorAll("#breadcrumbs button")].map(x=>x.textContent.trim()).slice(1);
  let parent=ROOT;
  for(const name of names){const f=items.find(x=>x.type==="folder"&&!x.trashed&&(x.parentId||ROOT)===parent&&x.name===name);if(!f)break;parent=f.id}
  return parent;
}
function setCamStatus(text,type=""){const n=document.getElementById("soraCameraStatus");if(n){n.textContent=text;n.className=`sora-camera-status ${type}`.trim()}}

async function blobToThumb(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error("画像を読み込めませんでした。"));img.src=url});
    const sw=img.naturalWidth||img.width,sh=img.naturalHeight||img.height,side=Math.min(sw,sh),sx=(sw-side)/2,sy=(sh-side)/2;
    const c=document.createElement("canvas");c.width=96;c.height=96;const ctx=c.getContext("2d",{alpha:false});
    ctx.drawImage(img,sx,sy,side,side,0,0,96,96);
    let out=c.toDataURL("image/webp",.72);if(!out.startsWith("data:image/webp"))out=c.toDataURL("image/jpeg",.75);return out;
  }finally{URL.revokeObjectURL(url)}
}
async function itemBlob(item){
  const snap=await getDocs(query(collection(db,"users",user.uid,"items",item.id,"chunks"),orderBy("index","asc")));
  if(snap.empty)throw new Error("画像データがありません。");
  return new Blob(snap.docs.map(d=>from64(d.data().data)),{type:item.mimeType||"image/jpeg"});
}
async function ensureThumb(item){
  if(item.thumbnailDataUrl)return item.thumbnailDataUrl;
  if(thumbJobs.has(item.id))return thumbJobs.get(item.id);
  const p=(async()=>{
    try{const data=await blobToThumb(await itemBlob(item));await setDoc(doc(db,"users",user.uid,"items",item.id),{ownerId:user.uid,thumbnailDataUrl:data,updatedAt:item.updatedAt||serverTimestamp()},{merge:true});return data}
    catch(e){console.warn("thumbnail",item.name,e);return null}
    finally{thumbJobs.delete(item.id)}
  })();thumbJobs.set(item.id,p);return p;
}
function setThumb(icon,src){if(!icon||!src)return;icon.textContent="";icon.classList.add("sora-photo-thumb");let img=icon.querySelector("img");if(!img){img=document.createElement("img");img.alt="";icon.appendChild(img)}img.src=src}
async function paintThumbs(){
  if(!user)return;
  const active=document.querySelector('.nav-item.active')?.dataset.view||"files",parent=currentFolder(),used=new Set();
  for(const row of document.querySelectorAll("#fileList tr")){
    const icon=row.querySelector(".file-icon.image");if(!icon)continue;
    const name=row.querySelector(".file-name-button strong")?.textContent||row.querySelector("strong")?.textContent||"";
    let candidates=items.filter(x=>x.type==="file"&&!x.trashed&&String(x.mimeType||"").startsWith("image/")&&x.name===name);
    if(active==="files")candidates=candidates.filter(x=>(x.parentId||ROOT)===parent);
    const item=candidates.find(x=>!used.has(x.id))||candidates[0];if(!item)continue;used.add(item.id);
    if(item.thumbnailDataUrl){setThumb(icon,item.thumbnailDataUrl);continue}
    ensureThumb(item).then(src=>src&&setThumb(icon,src));
  }
}
let paintTimer=0;function schedulePaint(){clearTimeout(paintTimer);paintTimer=setTimeout(paintThumbs,80)}

function makeCameraDialog(){
  if(document.getElementById("soraCameraDialog"))return document.getElementById("soraCameraDialog");
  const d=document.createElement("dialog");d.id="soraCameraDialog";d.innerHTML=`
  <div class="sora-camera-head"><h2>📷 写真を撮る</h2><button class="sora-camera-close" id="soraCameraClose" type="button">×</button></div>
  <div class="sora-camera-body">
    <div class="sora-camera-view" id="soraCameraView"><div class="sora-camera-placeholder">カメラを起動すると、ここに映像が表示されます。</div></div>
    <div class="sora-camera-actions">
      <button class="sora-camera-btn primary" id="soraTakePhoto" type="button">● 撮影</button>
      <button class="sora-camera-btn" id="soraRetakePhoto" type="button" hidden>↻ 撮り直す</button>
      <button class="sora-camera-btn" id="soraChoosePhoto" type="button">写真を選ぶ</button>
      <input id="soraPhotoFallback" type="file" accept="image/*" capture="environment" hidden>
    </div>
    <div class="sora-camera-fields">
      <label class="sora-camera-field"><span>保存する名前</span><input id="soraPhotoName" maxlength="100"></label>
      <label class="sora-camera-field"><span>画像形式</span><select id="soraPhotoFormat"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></label>
    </div>
    <div class="sora-camera-actions"><button class="sora-camera-btn primary" id="soraSavePhoto" type="button" disabled>名前を付けて保存</button></div>
    <p class="sora-camera-status" id="soraCameraStatus"></p>
  </div>`;
  document.body.appendChild(d);
  d.querySelector("#soraCameraClose").onclick=()=>closeCamera();
  d.querySelector("#soraTakePhoto").onclick=takePhoto;
  d.querySelector("#soraRetakePhoto").onclick=()=>startCamera();
  d.querySelector("#soraChoosePhoto").onclick=()=>d.querySelector("#soraPhotoFallback").click();
  d.querySelector("#soraPhotoFallback").onchange=async e=>{const f=e.target.files?.[0];e.target.value="";if(f)await useChosenPhoto(f)};
  d.querySelector("#soraSavePhoto").onclick=savePhoto;
  d.addEventListener("close",stopStream);
  return d;
}
function stopStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
function clearCaptured(){if(capturedUrl)URL.revokeObjectURL(capturedUrl);capturedUrl=null;capturedBlob=null}
function closeCamera(){const d=makeCameraDialog();stopStream();clearCaptured();if(d.open)d.close()}
async function openCamera(){const d=makeCameraDialog();d.querySelector("#soraPhotoName").value=`写真_${stamp()}.jpg`;d.querySelector("#soraPhotoFormat").value="image/jpeg";d.querySelector("#soraSavePhoto").disabled=true;d.querySelector("#soraRetakePhoto").hidden=true;setCamStatus("");if(!d.open)d.showModal();await startCamera()}
async function startCamera(){
  const d=makeCameraDialog(),view=d.querySelector("#soraCameraView");stopStream();clearCaptured();d.querySelector("#soraSavePhoto").disabled=true;d.querySelector("#soraRetakePhoto").hidden=true;
  view.innerHTML='<div class="sora-camera-placeholder">カメラを起動しています…</div>';
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});const v=document.createElement("video");v.autoplay=true;v.playsInline=true;v.muted=true;v.srcObject=stream;view.replaceChildren(v);await v.play().catch(()=>{});setCamStatus("撮影ボタンを押してください。")}
  catch(e){view.innerHTML='<div class="sora-camera-placeholder">カメラを直接起動できませんでした。<br>「写真を選ぶ」からカメラ撮影もできます。</div>';setCamStatus("カメラの許可を確認してください。","err")}
}
async function takePhoto(){
  const d=makeCameraDialog(),v=d.querySelector("video");if(!v||!v.videoWidth){setCamStatus("カメラ映像を待ってから撮影してください。","err");return}
  const max=1920,scale=Math.min(1,max/Math.max(v.videoWidth,v.videoHeight)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));c.getContext("2d").drawImage(v,0,0,c.width,c.height);
  stopStream();const type=d.querySelector("#soraPhotoFormat").value;capturedBlob=await new Promise(res=>c.toBlob(res,type,type==="image/jpeg"?.9:undefined));if(!capturedBlob){setCamStatus("写真を作成できませんでした。","err");return}showCaptured(capturedBlob);setCamStatus("写真を確認して、名前を付けて保存してください。","ok")
}
async function useChosenPhoto(file){
  if(file.size>MAX){setCamStatus("写真は10MB以下にしてください。","err");return}
  const d=makeCameraDialog(),type=d.querySelector("#soraPhotoFormat").value,url=URL.createObjectURL(file);
  try{const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});const max=1920,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);capturedBlob=await new Promise(res=>c.toBlob(res,type,type==="image/jpeg"?.9:undefined));showCaptured(capturedBlob);setCamStatus("名前を付けて保存できます。","ok")}
  catch{setCamStatus("画像を読み込めませんでした。","err")}finally{URL.revokeObjectURL(url)}
}
function showCaptured(blob){const d=makeCameraDialog(),view=d.querySelector("#soraCameraView");stopStream();if(capturedUrl)URL.revokeObjectURL(capturedUrl);capturedUrl=URL.createObjectURL(blob);const img=document.createElement("img");img.src=capturedUrl;img.alt="撮影した写真";view.replaceChildren(img);d.querySelector("#soraRetakePhoto").hidden=false;d.querySelector("#soraSavePhoto").disabled=false}
function normalizedName(name,type){const ext=extFor(type),base=(name||`写真_${stamp()}`).trim().replace(/\.(jpe?g|png)$/i,"");return `${base||`写真_${stamp()}`}.${ext}`}
async function savePhoto(){
  const d=makeCameraDialog(),btn=d.querySelector("#soraSavePhoto");if(!user||!capturedBlob)return;let type=d.querySelector("#soraPhotoFormat").value;
  if(capturedBlob.type!==type){const url=URL.createObjectURL(capturedBlob);try{const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext("2d").drawImage(img,0,0);capturedBlob=await new Promise(res=>c.toBlob(res,type,type==="image/jpeg"?.9:undefined));showCaptured(capturedBlob)}finally{URL.revokeObjectURL(url)}}
  if(capturedBlob.size>MAX){setCamStatus("写真が10MBを超えています。JPEGを選んでください。","err");return}
  const name=normalizedName(d.querySelector("#soraPhotoName").value,type),parentId=currentFolder(),itemRef=doc(collection(db,"users",user.uid,"items"));btn.disabled=true;setCamStatus("写真を保存しています…");
  try{
    const thumb=await blobToThumb(capturedBlob).catch(()=>null),count=Math.max(1,Math.ceil(capturedBlob.size/CHUNK));
    await setDoc(itemRef,{ownerId:user.uid,type:"file",name,size:capturedBlob.size,mimeType:type,parentId,trashed:false,uploadStatus:"uploading",chunkCount:0,thumbnailDataUrl:thumb||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    for(let i=0;i<count;i++){const start=i*CHUNK,end=Math.min(capturedBlob.size,start+CHUNK),part=new Uint8Array(await capturedBlob.slice(start,end).arrayBuffer());await setDoc(doc(collection(itemRef,"chunks"),String(i).padStart(5,"0")),{ownerId:user.uid,index:i,data:to64(part),byteLength:part.length});setCamStatus(`保存中 ${i+1}/${count}…`)}
    await setDoc(itemRef,{ownerId:user.uid,uploadStatus:"ready",chunkCount:count,updatedAt:serverTimestamp()},{merge:true});setCamStatus(`「${name}」を保存しました。`,`ok`);setTimeout(()=>closeCamera(),700)
  }catch(e){console.error(e);setCamStatus(e?.message||"保存に失敗しました。","err")}finally{btn.disabled=false}
}
function installCameraButtons(){
  const heading=document.querySelector(".heading-actions"),upload=document.getElementById("uploadButton");
  if(heading&&upload&&!document.getElementById("soraCameraButton")){const b=document.createElement("button");b.id="soraCameraButton";b.className="secondary-button";b.type="button";b.textContent="📷 写真";b.onclick=openCamera;heading.insertBefore(b,upload)}
  const top=document.querySelector(".top-actions"),up=document.getElementById("uploadTopButton");
  if(top&&up&&!document.getElementById("soraCameraTopButton")){const b=document.createElement("button");b.id="soraCameraTopButton";b.className="secondary-button compact";b.type="button";b.textContent="📷";b.title="写真を撮る";b.onclick=openCamera;top.insertBefore(b,up)}
}

onAuthStateChanged(auth,u=>{user=u;items=[];if(unsub){unsub();unsub=null}if(!u)return;installCameraButtons();unsub=onSnapshot(collection(db,"users",u.uid,"items"),s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));schedulePaint()},e=>console.warn("media items",e));setTimeout(()=>{installCameraButtons();schedulePaint()},400)});
const observer=new MutationObserver(()=>{installCameraButtons();schedulePaint()});observer.observe(document.documentElement,{childList:true,subtree:true});
console.info("sorapbox media enhancements v1.5 loaded");