const ROOT_LABEL="マイファイル";

const style=document.createElement("style");
style.textContent=`
.sora-folder-back{display:inline-flex;align-items:center;gap:6px;margin-right:8px;padding:6px 10px;border:1px solid #dbe4ef;border-radius:10px;background:#fff;color:#334155;font:inherit;font-size:12px;font-weight:800;box-shadow:0 3px 10px rgba(15,23,42,.05)}
.sora-folder-back:hover{background:#f3f7fc;border-color:#bdd4ef}.sora-folder-back span{font-size:16px;line-height:1}
`;
document.head.appendChild(style);

function installBack(){
  const crumbs=document.getElementById("breadcrumbs");
  if(!crumbs)return;
  const buttons=[...crumbs.querySelectorAll("button")];
  let back=crumbs.querySelector(".sora-folder-back");
  if(buttons.length<=1){back?.remove();return}
  if(!back){
    back=document.createElement("button");
    back.type="button";
    back.className="sora-folder-back";
    back.innerHTML="<span>←</span> 戻る";
    crumbs.prepend(back);
  }
  back.onclick=()=>{
    const current=[...crumbs.querySelectorAll("button:not(.sora-folder-back)")];
    if(current.length<=1)return;
    current[current.length-2].click();
  };
}

const observer=new MutationObserver(installBack);
observer.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener("click",e=>{if(e.target.closest(".breadcrumbs,.file-name-button,.nav-item"))setTimeout(installBack,40)});
installBack();
console.info("sorapbox folder navigation v1.5.6 loaded");
