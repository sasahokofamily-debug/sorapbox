import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  getDocs, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const MAX = 10 * 1024 * 1024;
const CHUNK = 256 * 1024;
const ROOT = "root";
const TIMEOUT_MS = 25000;
const input = document.getElementById("fileInput");
const queue = document.getElementById("uploadQueue");
const toasts = document.getElementById("toastRegion");
let running = false;

function bytes(n=0){if(!n)return"0 B";const u=["B","KB","MB"],i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),2),v=n/1024**i;return`${v>=10||!i?v.toFixed(0):v.toFixed(1)} ${u[i]}`}
function toast(message,type=""){const n=document.createElement("div");n.className=`toast ${type}`.trim();n.textContent=message;toasts?.append(n);setTimeout(()=>n.remove(),6500)}
function to64(a){let s="";for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,Math.min(i+32768,a.length)));return btoa(s)}
function withTimeout(promise,label){let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error(`${label}が25秒以上応答しませんでした。再試行してください。`);e.code="upload-timeout";reject(e)},TIMEOUT_MS)});return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer))}
function makeNode(file){const root=document.createElement("div");root.className="upload-item";const icon=document.createElement("span");icon.textContent="⇧";const info=document.createElement("div");info.className="upload-info";const strong=document.createElement("strong");strong.textContent=file.name;const status=document.createElement("small");status.textContent=`1% ・ 接続確認中… ・ ${bytes(file.size)}`;const progress=document.createElement("div");progress.className="progress";const bar=document.createElement("i");bar.style.width="1%";progress.append(bar);info.append(strong,status,progress);const cancel=document.createElement("button");cancel.type="button";cancel.className="upload-cancel";cancel.textContent="×";const ctl={cancel:false};cancel.onclick=()=>{ctl.cancel=true;cancel.disabled=true;status.textContent="キャンセル中…"};root.append(icon,info,cancel);return{root,status,bar,ctl}}
async function cleanup(itemRef){try{const snap=await getDocs(collection(itemRef,"chunks")),docs=snap.docs;for(let i=0;i<docs.length;i+=400){const b=writeBatch(db);docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit()}}catch(e){console.warn("chunk cleanup",e)}try{await deleteDoc(itemRef)}catch(e){console.warn("item cleanup",e)}}

async function parentFolder(user){
  const view=document.querySelector('.nav-item.active')?.dataset.view;
  if(view&&view!=="files")return ROOT;
  const crumbs=[...document.querySelectorAll("#breadcrumbs button")].slice(1).map(b=>b.textContent.trim()).filter(Boolean);
  if(!crumbs.length)return ROOT;
  try{
    const snap=await getDocs(collection(db,"users",user.uid,"items"));
    const items=snap.docs.map(d=>({id:d.id,...d.data()}));
    let parent=ROOT;
    for(const name of crumbs){
      const folder=items.find(x=>x.type==="folder"&&!x.trashed&&(x.parentId||ROOT)===parent&&String(x.name||"")===name);
      if(!folder)return ROOT;
      parent=folder.id;
    }
    return parent;
  }catch(e){console.warn("resolve current folder",e);return ROOT}
}

async function uploadOne(file){
  const user=auth.currentUser;if(!user){toast("ログインし直してください。","error");return}
  if(file.size>MAX){toast(`${file.name} は無料版の上限10MBを超えています。`,`error`);return}
  const node=makeNode(file);queue.classList.remove("hidden");queue.append(node.root);const itemRef=doc(collection(db,"users",user.uid,"items"));
  try{
    node.status.textContent=`1% ・ 保存先を準備中… ・ ${bytes(file.size)}`;
    const folderId=await parentFolder(user);
    await withTimeout(setDoc(itemRef,{ownerId:user.uid,type:"file",name:file.name,parentId:folderId,storageMode:"firestore-chunks",uploadStatus:"uploading",chunkCount:0,mimeType:file.type||"application/octet-stream",size:file.size,trashed:false,sourceModifiedAtMs:Number(file.lastModified||0)||null,uploadedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()}),"保存先の準備");
    node.bar.style.width="3%";node.status.textContent=`3% ・ ファイルを読み込み中… ・ ${bytes(file.size)}`;
    const data=new Uint8Array(await file.arrayBuffer()),count=Math.max(1,Math.ceil(data.length/CHUNK));
    for(let i=0;i<count;i++){
      if(node.ctl.cancel){const e=new Error("キャンセルしました。");e.code="cancelled";throw e}
      const part=data.subarray(i*CHUNK,Math.min((i+1)*CHUNK,data.length));node.status.textContent=`${Math.max(4,Math.round(3+(i/count)*94))}% ・ ${i+1}/${count} 個目を保存中…`;
      const chunkRef=doc(collection(itemRef,"chunks"),String(i).padStart(5,"0"));
      await withTimeout(setDoc(chunkRef,{ownerId:user.uid,index:i,data:to64(part),byteLength:part.length}),`データ ${i+1}/${count} の保存`);
      const done=Math.min(file.size,(i+1)*CHUNK),percent=Math.min(97,Math.round(3+((i+1)/count)*94));node.bar.style.width=`${percent}%`;node.status.textContent=`${percent}% ・ ${bytes(done)} / ${bytes(file.size)}`;
    }
    node.status.textContent="98% ・ 最終処理中…";node.bar.style.width="98%";
    await withTimeout(updateDoc(itemRef,{uploadStatus:"ready",chunkCount:count,updatedAt:serverTimestamp()}),"最終処理");
    node.status.textContent="100% ・ 完了";node.bar.style.width="100%";toast(`${file.name} をこのフォルダに保存しました。`,`success`);setTimeout(()=>{node.root.remove();if(!queue.children.length)queue.classList.add("hidden")},1400);
  }catch(err){console.error("sorapbox upload",err);node.status.textContent=err.code==="cancelled"?"キャンセルしました":"エラー：保存できませんでした";node.bar.style.width="100%";await cleanup(itemRef);if(err.code!=="cancelled"){const text=err.code==="upload-timeout"?err.message:(err.code==="permission-denied"?"Firestoreのルールが未反映です。firestore,hosting を再デプロイしてください。":(err.message||"保存に失敗しました。"));toast(`${file.name}: ${text}`,"error")}setTimeout(()=>{node.root.remove();if(!queue.children.length)queue.classList.add("hidden")},3500)}
}
async function uploadSequential(files){if(running){toast("前のアップロードが終わってから追加してください。","error");return}running=true;try{for(const file of files)await uploadOne(file)}finally{running=false}}
if(input){input.onchange=()=>{const files=[...input.files];input.value="";uploadSequential(files)}}
document.addEventListener("drop",event=>{if(!event.dataTransfer?.files?.length)return;event.preventDefault();event.stopImmediatePropagation();document.getElementById("dropOverlay")?.classList.add("hidden");uploadSequential([...event.dataTransfer.files])},true);
console.info("sorapbox FREE upload hotfix v1.2.2 folder-aware loaded");
