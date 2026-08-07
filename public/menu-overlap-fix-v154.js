const style=document.createElement("style");
style.textContent=`
/* v1.5.4: do not clip the row action menu at the bottom of the white file panel */
.drop-zone{overflow:visible!important}
.file-table-wrap{overflow:visible!important}
.file-table tbody tr:nth-last-child(-n+3) .row-menu{top:auto!important;bottom:34px!important}
.row-menu{z-index:120!important}
@media(max-width:900px){
  .file-table-wrap{overflow:visible!important}
  .file-table tbody tr:nth-last-child(-n+4) .row-menu{top:auto!important;bottom:34px!important}
}
`;
document.head.appendChild(style);
console.info("sorapbox row menu overlap fix v1.5.4 loaded");
