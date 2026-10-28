import { createClashResultsView } from "./clash-results-view.js";
import { buildClashReport } from "./clash-report.js";
import { buildClashLink, defaultClashCamera } from "./clash-link.js";
import { paintViewerBackground } from "../../app/scene-style.js";
import { adjacentClashIndex, filterClashResults, groupClashResults, serializeClashViewpoint } from "./clash-core.js";
import { runXktClashAnalysis } from "./clash-api.js";
import { extractEntityGeometry, clearClashGeometryCache, positionsAABB } from "./xkt-geometry.js";

const STATUS_LABELS={new:"Novo",reviewing:"Em análise",accepted:"Aceito",resolved:"Resolvido",ignored:"Ignorado"};
let sdkPromise; const loadBCFSDK=()=>sdkPromise||=import("https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js");
/** Ponto que representa a interferência: o maior agrupamento de pontos de contato,
 *  "encaixado" num ponto real. A média simples cai no vazio quando as peças se tocam em dois lugares. */
function representativePoint(points,fallback){
 if(!points?.length)return fallback;
 const cell=.5,clusters=new Map();
 for(const p of points){const key=p.map(v=>Math.floor(v/cell)).join(",");const c=clusters.get(key)||{n:0,s:[0,0,0]};c.n++;c.s[0]+=p[0];c.s[1]+=p[1];c.s[2]+=p[2];clusters.set(key,c);}
 let best=fallback,bestCount=-1;
 for(const key of clusters.keys()){const [x,y,z]=key.split(",").map(Number);let n=0;const sum=[0,0,0];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){const o=clusters.get(`${x+dx},${y+dy},${z+dz}`);if(o){n+=o.n;sum[0]+=o.s[0];sum[1]+=o.s[1];sum[2]+=o.s[2];}}
  if(n>bestCount){bestCount=n;best=sum.map(v=>v/n);}}
 let nearest=points[0],distance=Infinity;
 for(const p of points){const d=(p[0]-best[0])**2+(p[1]-best[1])**2+(p[2]-best[2])**2;if(d<distance){distance=d;nearest=p;}}
 return Array.from(nearest);
}
function download(name,content,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);}

export function createClashFeature({viewer,panel,models,transforms,getAllObjectIds,requestRenderFrame,jsPDF,xktLoader}) {
 let results=[],visibleResults=[],activeIndex=-1,marker=null,bcfPlugin=null,isolated=false,controller=null;
 let viewRevision=0, destroyed=false, viewSnapshot=null, currentMode="context", lastAnalysis=null, reportRunning=false;
 // Todos os objetos da cena (sem os modelos temporários da análise). Não depende do Explorer estar aberto.
 const allIds=()=>viewer.scene.objectIds.filter(id=>!String(id).startsWith("__"));
 // Guarda o que estava visível/raio-x antes da primeira interferência, para devolver ao sair.
 const takeSnapshot=()=>{if(!viewSnapshot)viewSnapshot={visible:new Set(viewer.scene.visibleObjectIds),xrayed:new Set(viewer.scene.xrayedObjectIds)};};
 const originalColors=new Map();
 const resultsView=createClashResultsView({viewer,onNavigate:direction=>showClash(adjacentClashIndex(activeIndex,visibleResults.length,direction)),onShowAll:()=>showClash(activeIndex,"focus"),onIsolate:()=>showClash(activeIndex,currentMode==="isolate"?"context":"isolate"),statusLabels:STATUS_LABELS,onStatusChange:status=>{const clash=visibleResults[activeIndex];if(!clash)return;clash.status=status;applyFilters();},onExport:()=>{const clash=visibleResults[activeIndex];if(clash)exportViewpoint(clash).catch(error=>summary.textContent=`Não foi possível exportar: ${error.message}`);}});
 panel.innerHTML=`<div class="collision-panel-header"><div><div class="collision-panel-title">Compatibilização BIM</div><div class="collision-panel-subtitle">Análise geométrica entre modelos XKT</div></div><button id="closeCollisionPanel" type="button" aria-label="Fechar painel">✕</button></div>
 <label class="collision-label">Preset<select id="clashPreset"><option value="">Seleção manual</option><option value="IFC_EST|IFC_HID">Estrutura × Hidráulica</option><option value="IFC_EST|IFC_ELE">Estrutura × Elétrica</option><option value="IFC_EST|IFC_CLI">Estrutura × Climatização</option><option value="IFC_ARQ|IFC_HID">Arquitetura × Instalações</option></select></label>
 <div class="clash-groups"><label class="collision-label">Grupo A<select id="collisionModelA"></select></label><span>×</span><label class="collision-label">Grupo B<select id="collisionModelB"></select></label></div>
 <div class="clash-type-filters"><details class="clash-type-filter" id="clashTypesA"></details><details class="clash-type-filter" id="clashTypesB"></details></div>
 <label class="collision-label">Tipo<select id="clashMode"><option value="intersection">Interferência física</option><option value="clearance">Proximidade / Folga</option></select></label><label id="clashDistanceLabel" class="collision-label">Precisão geométrica (m)<input id="collisionRadius" type="number" min="0.000001" max="1" step="0.001" value="0.001"></label>
 <div class="collision-actions"><button id="runCollisionCheck">Executar análise</button><button id="cancelCollisionCheck" hidden>Cancelar</button></div><p id="collisionSummary" class="collision-summary" role="status">Selecione dois modelos XKT.</p>
 <div class="clash-filters"><input id="clashSearch" type="search" placeholder="Buscar nome, ID, classe ou modelo"><select id="clashStatus"><option value="pending">Pendentes</option><option value="all">Todos os status</option><option value="resolved">Resolvidos</option></select></div><div id="clashNavigation" class="clash-navigation" hidden><button data-nav="-1">←</button><strong id="clashCounter">0 / 0</strong><button data-nav="1">→</button></div><div id="collisionResults" class="collision-results"></div><div class="collision-actions"><button id="copyClashLink" type="button" disabled title="Copia um link que abre esta interferência isolada no visualizador">Copiar link</button><button id="downloadCollisionPdf" disabled>Baixar PDF</button><button id="exportAllBcf" disabled>Exportar viewpoints</button></div>`;
 // O painel pode ser arrastado (viewer-authenticated.js), e o arraste bloqueia cliques em <summary>/<label>.
 // Nestas áreas o clique precisa funcionar normalmente, então o pointerdown não chega ao arraste.
 panel.querySelectorAll(".clash-type-filters,#collisionResults,.clash-filters,#clashNavigation").forEach(area=>area.addEventListener("pointerdown",event=>event.stopPropagation()));
 const $=s=>panel.querySelector(s), setA=$("#collisionModelA"),setB=$("#collisionModelB"),summary=$("#collisionSummary");
 // Nome igual ao do Explorer (displayName do modelo carregado); o id interno fica só como valor da opção.
 const modelLabel=m=>{const live=viewer.scene.models?.[m.id];const fromSrc=typeof m.src==="string"&&!/^(blob:|https?:|\/)/i.test(m.src)?m.src.replace(/\.[^/.]+$/,""):null;return live?.displayName||m.displayName||m.label||fromSrc||m.id;};
 // Lista montada na hora: inclui modelos carregados depois (upload, pasta, substituição)
 const getOptionModels=()=>models().filter(m=>m.src&&viewer.scene.models?.[m.id]).map(m=>({...m,label:modelLabel(m),transform:transforms()[m.id]||m.transform||{}})).sort((x,y)=>x.label.localeCompare(y.label,"pt-BR"));
 function refreshModelOptions(){
     const list=getOptionModels();
     [setA,setB].forEach((select,index)=>{const previous=select.value;select.innerHTML="";
         list.forEach(model=>{const o=document.createElement("option");o.value=model.id;o.textContent=model.label;o.title=model.label===model.id?model.id:`${model.label} (${model.id})`;select.append(o);});
         if(list.some(m=>m.id===previous))select.value=previous;else if(index===1&&list.length>1)select.selectedIndex=1;
         if(select.value!==previous)select.dispatchEvent(new Event("change"));});
 }
 const selected=s=>getOptionModels().find(m=>m.id===s.value);
 // Preset por disciplina: aceita o id exato (IFC_ELE) ou um nome que contenha a disciplina (XKT-ELE-220-TCE-PAV1)
 function findPresetOption(select,token){
     const options=[...select.options];const exact=options.find(o=>o.value===token);if(exact)return exact.value;
     const discipline=String(token).replace(/^IFC_/i,"").toUpperCase();const pattern=new RegExp(`(^|[^A-Z])${discipline}([^A-Z]|$)`);
     return options.find(o=>pattern.test(o.textContent.toUpperCase())||pattern.test(o.value.toUpperCase()))?.value||null;
 }
 const sceneIds=c=>[c.objectA,c.objectB].map(object=>{
     const candidates=[`${object.modelId}#${object.objectId}`,`${object.modelId}.${object.objectId}`,object.objectId];
     return candidates.find(id=>viewer.scene.objects[id] && (viewer.scene.objects[id].model?.id===object.modelId || id.startsWith(`${object.modelId}#`) || id.startsWith(`${object.modelId}.`))) || Object.keys(viewer.scene.objects).find(id=>viewer.scene.objects[id].model?.id===object.modelId && (id.endsWith(`#${object.objectId}`)||id.endsWith(`.${object.objectId}`))) || null;
 });
 const restore=({keepSnapshot=true}={})=>{viewRevision++;const ids=allIds();
     if(viewSnapshot){viewer.scene.setObjectsVisible(ids,false);viewer.scene.setObjectsVisible(ids.filter(id=>viewSnapshot.visible.has(id)),true);viewer.scene.setObjectsXRayed(ids,false);viewer.scene.setObjectsXRayed(ids.filter(id=>viewSnapshot.xrayed.has(id)),true);if(!keepSnapshot)viewSnapshot=null;}
     else viewer.scene.setObjectsXRayed(ids,false);
     viewer.scene.setObjectsHighlighted(ids,false);viewer.scene.setObjectsSelected(ids,false);for(const [id,color] of originalColors){const entity=viewer.scene.objects[id];if(entity)entity.colorize=color;}originalColors.clear();isolated=false;marker?.destroy?.();marker=null;resultsView.update(null);requestRenderFrame();};
 async function showClash(index,mode="context"){
     if(destroyed||!visibleResults.length)return;
     activeIndex=Math.max(0,Math.min(index,visibleResults.length-1));
     const clash=visibleResults[activeIndex],ids=sceneIds(clash),valid=ids.filter(Boolean);
     takeSnapshot();restore();const revision=viewRevision;currentMode=mode;
     if(mode==="isolate"){viewer.scene.setObjectsVisible(allIds(),false);isolated=true;}
     else if(mode==="context"){viewer.scene.setObjectsXRayed(allIds(),true);viewer.scene.setObjectsXRayed(valid,false);}
     // Em qualquer modo, as duas peças da interferência ficam visíveis (mesmo que o modelo esteja oculto no Explorer)
     viewer.scene.setObjectsVisible(valid,true);viewer.scene.setObjectsXRayed(valid,false);
     ids.forEach((id,i)=>{const entity=viewer.scene.objects[id];if(entity){originalColors.set(id,entity.colorize?Array.from(entity.colorize):null);entity.colorize=i===0?[1,.82,0]:[1,.18,.03];}});
     // Enquadra o ponto da interferência (peças longas, como eletrodutos, enquadrariam o prédio inteiro)
     const p=clash.position,r=1.5;
     if(p?.length===3)viewer.cameraFlight.flyTo({aabb:[p[0]-r,p[1]-r,p[2]-r,p[0]+r,p[1]+r,p[2]+r],duration:.6});
     else if(valid.length)viewer.cameraFlight.flyTo({aabb:viewer.scene.getAABB(valid),duration:.6});
     resultsView.update(clash,activeIndex,visibleResults.length,null,mode);render();requestRenderFrame();
     try{const {Marker}=await loadBCFSDK();if(destroyed||revision!==viewRevision)return;marker=new Marker(viewer.scene,{worldPos:clash.position,occludable:false});resultsView.update(clash,activeIndex,visibleResults.length,marker,mode);requestRenderFrame();}
     catch(error){if(revision===viewRevision)summary.textContent=`Resultado selecionado; não foi possível carregar a anotação 3D: ${error.message}`;}
 }
 async function exportViewpoint(clash){const {BCFViewpointsPlugin}=await loadBCFSDK();bcfPlugin||=new BCFViewpointsPlugin(viewer);download(`${clash.id}.bcfv`,JSON.stringify(serializeClashViewpoint(clash,bcfPlugin.getViewpoint({spacesVisible:false,openingsVisible:false})),null,2),"application/json");}
 function applyFilters(){const mode=$("#clashStatus").value,statuses=mode==="all"?Object.keys(STATUS_LABELS):mode==="resolved"?["resolved"]:["new","reviewing","accepted"];visibleResults=filterClashResults(results,{query:$("#clashSearch").value,statuses});activeIndex=visibleResults.length?Math.min(Math.max(activeIndex,0),visibleResults.length-1):-1;if(visibleResults.length)showClash(activeIndex);else {restore();render();}}
 // ---- Relatório em PDF: uma página por interferência, com imagem no modo isolamento
 const nextFrames=n=>new Promise(resolve=>{const step=k=>k<=0?resolve():requestAnimationFrame(()=>step(k-1));step(n);});
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const slug=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"modelo";
 async function captureClashImage(clash,index){
     await showClash(index,"isolate");
     // Vista padrão 3/4 de cima, olhando para o ponto da colisão (a mesma que o link abre)
     const p=clash.position,valid=sceneIds(clash).filter(Boolean);
     const camera=p?.length===3?defaultClashCamera(p,clashCameraDistance(valid)):null;
     if(camera)viewer.cameraFlight.jumpTo(camera);
     else if(valid.length)viewer.cameraFlight.jumpTo({aabb:viewer.scene.getAABB(valid)});
     requestRenderFrame();await nextFrames(3);await wait(150);requestRenderFrame();await nextFrames(2);
     const source=viewer.scene.canvas.canvas,W=1600,H=1200;
     const out=document.createElement("canvas");out.width=W;out.height=H;const ctx=out.getContext("2d");
     // Recorte central em 4:3, independente do tamanho da janela
     const targetAspect=W/H,sourceAspect=source.width/source.height;
     let sw=source.width,sh=source.height,sx=0,sy=0;
     if(sourceAspect>targetAspect){sw=sh*targetAspect;sx=(source.width-sw)/2;}else{sh=sw/targetAspect;sy=(source.height-sh)/2;}
     paintViewerBackground(ctx,W,H);ctx.drawImage(source,sx,sy,sw,sh,0,0,W,H);
     // Marcador numerado no ponto da interferência
     try{if(p?.length===3&&typeof viewer.scene.camera.projectWorldPos==="function"){
         const cp=viewer.scene.camera.projectWorldPos(p),scale=source.width/(source.clientWidth||source.width);
         const x=(cp[0]*scale-sx)*(W/sw),y=(cp[1]*scale-sy)*(H/sh);
         if(x>0&&y>0&&x<W&&y<H){ctx.beginPath();ctx.arc(x,y,24,0,Math.PI*2);ctx.fillStyle="#e53935";ctx.fill();ctx.lineWidth=4;ctx.strokeStyle="#ffffff";ctx.stroke();ctx.fillStyle="#ffffff";ctx.font="bold 24px Arial, sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(index+1),x,y+1);}
     }}catch(_error){}
     const url=buildClashLink(clash,{index,total:visibleResults.length,camera:camera||currentCamera()});
     return {image:out.toDataURL("image/jpeg",0.88),url};
 }
 // Distância da câmera conforme o tamanho da menor peça (tubo fino → mais perto; pilar → mais longe)
 function clashCameraDistance(ids){
     const sizes=ids.map(id=>{const a=viewer.scene.objects[id]?.aabb;return a?Math.hypot(a[3]-a[0],a[4]-a[1],a[5]-a[2]):null;}).filter(Number.isFinite);
     const smallest=sizes.length?Math.min(...sizes):2;
     return Math.min(8,Math.max(2.5,smallest*1.6));
 }
 const currentCamera=()=>({eye:Array.from(viewer.camera.eye),look:Array.from(viewer.camera.look),up:Array.from(viewer.camera.up)});
 async function copyClashLink(){
     const clash=visibleResults[activeIndex];if(!clash)return;
     const url=buildClashLink(clash,{index:activeIndex,total:visibleResults.length,camera:currentCamera()});
     const button=$("#copyClashLink"),label=button.textContent;
     try{await navigator.clipboard.writeText(url);button.textContent="Link copiado";}
     catch(_error){window.prompt("Copie o link da interferência:",url);}
     setTimeout(()=>{button.textContent=label;},1800);
 }
 async function downloadReport(){
     if(reportRunning||!visibleResults.length)return;
     reportRunning=true;const button=$("#downloadCollisionPdf"),label=button.textContent,previousSummary=summary.textContent;
     const previousIndex=activeIndex,previousMode=currentMode,clashes=visibleResults.slice();
     button.disabled=true;
     try{
         const first=clashes[0],mode=lastAnalysis?.mode||first.mode;
         const meta={
             project:(document.title||"Projeto").replace(/^Visualizador BIM\s*-\s*/i,"").trim()||"Projeto",
             groupA:lastAnalysis?.groupA||first.setA||first.objectA.modelLabel||first.objectA.modelId,
             groupB:lastAnalysis?.groupB||first.setB||first.objectB.modelLabel||first.objectB.modelId,
             mode,modeLabel:mode==="clearance"?"Proximidade / Folga":"Interferência física",
             tolerance:Number.isFinite(lastAnalysis?.tolerance)?lastAnalysis.tolerance:Number($("#collisionRadius").value)||0,
             generatedAt:new Date().toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}),
             author:"Eng. Msc. Rodrigo Damasceno Nascimento"
         };
         const rows=clashes.map(c=>({...c,statusLabel:STATUS_LABELS[c.status]||c.status}));
         const doc=await buildClashReport({jsPDF,clashes:rows,meta,capture:(c,i)=>captureClashImage(c,i),onProgress:(n,total)=>{button.textContent=`Gerando ${n}/${total}...`;summary.textContent=`Gerando relatório: capturando a interferência ${n} de ${total}...`;}});
         doc.save(`compatibilizacao-${slug(meta.groupA)}-x-${slug(meta.groupB)}.pdf`);
         summary.textContent=`Relatório gerado com ${clashes.length} interferência(s).`;
     }catch(error){console.error("[Relatório de compatibilização]",error);summary.textContent=`Não foi possível gerar o PDF: ${error.message}`;}
     finally{
         reportRunning=false;button.textContent=label;button.disabled=!results.length;
         if(previousIndex>=0&&visibleResults.length)await showClash(previousIndex,previousMode);else restore();
         if(summary.textContent.startsWith("Gerando"))summary.textContent=previousSummary;
     }
 }
 const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function render(){const list=$("#collisionResults");list.innerHTML="";/* A lista "IfcX × IfcY" por interferência foi retirada do painel: a navegação ← n / total → e o rodapé já percorrem as interferências. */if(!visibleResults.length)list.textContent=results.length?"Nenhum resultado corresponde aos filtros.":"✓ Nenhuma interferência encontrada";$("#clashNavigation").hidden=!visibleResults.length;$("#clashCounter").textContent=`${activeIndex+1} / ${visibleResults.length}`;$("#downloadCollisionPdf").disabled=$("#exportAllBcf").disabled=!results.length;$("#copyClashLink").disabled=!visibleResults.length;}
 // ---- Filtro por tipo IFC (ex.: só IfcDoor da arquitetura × só IfcFlowSegment da elétrica)
 function typesOfModel(modelId){const metas=viewer.metaScene?.metaObjects||{},count=new Map();
     for(const entity of Object.values(viewer.scene.objects)){if(entity.model?.id!==modelId&&!String(entity.id).startsWith(`${modelId}#`))continue;const type=metas[entity.id]?.type;if(type)count.set(type,(count.get(type)||0)+1);}
     return [...count].sort((a,b)=>a[0].localeCompare(b[0]));}
 function renderTypeFilter(container,modelId){
     const previous=container.dataset.model===modelId?selectedTypes(container):null;container.dataset.model=modelId||"";
     const types=modelId?typesOfModel(modelId):[];
     container.innerHTML=`<summary></summary><div class="clash-type-tools"><button type="button" data-all>Todos</button><button type="button" data-none>Nenhum</button></div><div class="clash-type-list"></div>`;
     const list=container.querySelector(".clash-type-list");
     if(!types.length)list.textContent=modelId?"Carregue o modelo para listar os tipos.":"";
     for(const [type,count] of types){const label=document.createElement("label");const input=document.createElement("input");input.type="checkbox";input.value=type;input.checked=!previous||previous.has(type);label.append(input,document.createTextNode(` ${type} (${count})`));list.append(label);}
     const refresh=()=>{const boxes=[...list.querySelectorAll("input")],checked=boxes.filter(b=>b.checked);container.querySelector("summary").textContent=!boxes.length?"Tipos IFC: —":checked.length===boxes.length?"Tipos IFC: todos":checked.length?`Tipos IFC: ${checked.length<=2?checked.map(b=>b.value).join(", "):`${checked.length} selecionados`}`:"Tipos IFC: nenhum";};
     list.onchange=refresh;
     container.querySelector("[data-all]").onclick=()=>{list.querySelectorAll("input").forEach(b=>b.checked=true);refresh();};
     container.querySelector("[data-none]").onclick=()=>{list.querySelectorAll("input").forEach(b=>b.checked=false);refresh();};
     refresh();}
 // null = todos os tipos (sem filtro); Set = só esses tipos
 function selectedTypes(container){const boxes=[...container.querySelectorAll(".clash-type-list input")];if(!boxes.length||boxes.every(b=>b.checked))return null;return new Set(boxes.filter(b=>b.checked).map(b=>b.value));}
 const sameTypes=(a,b)=>(!a&&!b)||(a&&b&&a.size===b.size&&[...a].every(t=>b.has(t)));
 // Posição/rotação ATUAIS do modelo na cena. O painel "Origem e Rotação" muda model.position
 // sem atualizar a configuração do projeto, então a configuração não serve como referência.
 function liveTransform(model){const live=viewer.scene.models?.[model.id];return live?{position:Array.from(live.position||[0,0,0]),rotation:Array.from(live.rotation||[0,0,0])}:(model.transform||{});}
 // Confere cada peça com a peça visível na tela e corrige qualquer deslocamento que tenha sobrado.
 function alignToLiveScene(objects,modelId){let shifted=0;return {objects:objects.map(o=>{
     const live=viewer.scene.objects[`${modelId}#${o.objectId}`];if(!live?.aabb)return o;
     const target=Array.from(live.aabb),current=positionsAABB(o.positions);
     const size=k=>[current[k+3]-current[k],target[k+3]-target[k]];
     const sameSize=[0,1,2].every(k=>{const [a,b]=size(k);return Math.abs(a-b)<=Math.max(.02,.02*Math.max(a,b));});
     const delta=[0,1,2].map(k=>(target[k]+target[k+3])/2-(current[k]+current[k+3])/2);
     if(!sameSize||Math.hypot(...delta)<.005)return {...o,aabb:target};
     const positions=new Float32Array(o.positions.length);
     for(let i=0;i<positions.length;i+=3){positions[i]=o.positions[i]+delta[0];positions[i+1]=o.positions[i+1]+delta[1];positions[i+2]=o.positions[i+2]+delta[2];}
     shifted++;return {...o,positions,aabb:target};
 }),shifted};}
 // De onde ler uma cópia do modelo para a análise: o arquivo do computador (upload/pasta)
 // ou o endereço no servidor. Só o nome do arquivo não basta (o servidor responde 404).
 function analysisSource(model){
     const file=model.file;
     if(typeof Blob!=="undefined"&&file instanceof Blob){
         return /\.xkt$/i.test(file.name||model.src||"")?{src:URL.createObjectURL(file),revoke:true}:null;
     }
     const src=String(model.src||"");
     return /^(blob:|https?:|data:)/i.test(src)||src.includes("/")?{src,revoke:false}:null;
 }
 async function prepare(model,types=null){summary.textContent="Preparando objetos...";
     const metas=viewer.metaScene?.metaObjects||{};const typeOk=entity=>!types||types.has(metas[entity.id]?.type);
     const transform=liveTransform(model);
     clearClashGeometryCache(model.id); // a geometria guardada pode ser de antes de mover o modelo
     const extract=entities=>entities.map(e=>extractEntityGeometry(e,{modelId:model.id,transform,metaObjects:viewer.metaScene?.metaObjects||{}})).filter(Boolean).map(o=>({...o,id:o.objectId}));
     const finish=objects=>{const {objects:aligned,shifted}=alignToLiveScene(objects,model.id);if(shifted&&location.search.includes("debugClash"))console.info(`[XKT Clash] ${model.id}: ${shifted} peça(s) reposicionada(s) pela posição na tela`);return aligned;};
     const loaded=Object.values(viewer.scene.objects).filter(e=>(e.model?.id===model.id||e.id.startsWith(`${model.id}#`))&&typeOk(e));if(types&&!loaded.length)return [];const available=extract(loaded);if(available.length)return finish(available);
     const source=analysisSource(model);
     if(!source)throw new Error(`não foi possível ler a geometria de “${model.label||model.id}”${model.file?" (a análise funciona com arquivos .xkt; converta o IFC/GLB para XKT)":" (arquivo local indisponível; carregue o modelo de novo)"}.`);
     const analysisId=`__clash_${model.id}_${Date.now()}`;let analysisModel=xktLoader.load({id:analysisId,src:source.src,globalizeObjectIds:true,readableGeometryEnabled:true,visible:false,edges:false,saoEnabled:false,dtxEnabled:false,...(types?{includeTypes:[...types]}:{})});
     try{await new Promise((resolve,reject)=>{analysisModel.on("loaded",resolve);analysisModel.on("error",error=>reject(error instanceof Error?error:new Error(String(error))));});}
     catch(error){analysisModel.destroy?.();if(source.revoke)URL.revokeObjectURL(source.src);throw error;}
     analysisModel.position=[...(transform.position||[0,0,0])];analysisModel.rotation=[...(transform.rotation||[0,0,0])];
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const data=extract(Object.values(viewer.scene.objects).filter(e=>(e.model?.id===analysisId||e.id.startsWith(`${analysisId}#`))&&typeOk(e)));
     analysisModel.destroy();
     if(source.revoke)URL.revokeObjectURL(source.src);
     clearClashGeometryCache(model.id); // não deixa no cache a geometria da cópia temporária
     return finish(data);}
 $("#runCollisionCheck").onclick=async()=>{const a=selected(setA),b=selected(setB);if(!a||!b)return;restore({keepSnapshot:false});controller=new AbortController();$("#runCollisionCheck").disabled=true;$("#cancelCollisionCheck").hidden=false;try{const typesA=selectedTypes($("#clashTypesA")),typesB=selectedTypes($("#clashTypesB"));
     if((typesA&&!typesA.size)||(typesB&&!typesB.size)){summary.textContent="Marque ao menos um tipo IFC em cada grupo.";return;}
     const sameModel=a.id===b.id&&sameTypes(typesA,typesB);
     const started=performance.now(),objectsA=await prepare(a,typesA),objectsB=sameModel?objectsA:await prepare(b,typesB);
     if(!objectsA.length||!objectsB.length){summary.textContent=`Nenhum objeto ${!objectsA.length?"no Grupo A":"no Grupo B"} com os tipos selecionados.`;return;}const value=Number($("#collisionRadius").value),mode=$("#clashMode").value;const output=await runXktClashAnalysis({objectsA,objectsB,mode,epsilon:mode==="intersection"?value:.001,clearance:mode==="clearance"?value:0,sameModel,signal:controller.signal,onProgress:p=>summary.textContent=p.phase==="broad"?`Broad phase... ${p.candidates} pares candidatos`:`Analisando geometrias... ${p.current} / ${p.total}`});summary.textContent="Consolidando resultados...";results=output.clashes.map((c,i)=>({id:`xkt-clash-${i+1}`,source:"xkt-geometry",mode,setA:a.label||a.id,setB:b.label||b.id,objectA:{...c.objectA,modelLabel:a.label},objectB:{...c.objectB,modelLabel:b.label},position:representativePoint(c.intersectionPoints,c.position),intersectionPoints:c.intersectionPoints,penetrationDepth:null,status:"new"}));lastAnalysis={mode,tolerance:value,groupA:a.label||a.id,groupB:b.label||b.id};activeIndex=results.length?0:-1;applyFilters();const describe=(t)=>t?[...t].join(", "):"todos os tipos";summary.textContent=`Análise concluída. ${results.length} interferências encontradas (${a.label||a.id}: ${describe(typesA)} × ${b.label||b.id}: ${describe(typesB)}).`;if(location.search.includes("debugClash"))console.info("[XKT Clash]",{grupoA:objectsA.length,grupoB:objectsB.length,paresBrutos:objectsA.length*objectsB.length,candidatos:output.candidates,clashes:results.length,tempoMs:Math.round(performance.now()-started)});}catch(error){summary.textContent=error.name==="AbortError"?"Análise cancelada.":`Não foi possível analisar a geometria XKT: ${error.message}`;if(error.name!=="AbortError")console.error("[XKT Clash]",error);}finally{$("#runCollisionCheck").disabled=false;$("#cancelCollisionCheck").hidden=true;controller=null;}};
 $("#cancelCollisionCheck").onclick=()=>controller?.abort();$("#clashMode").onchange=e=>{const clearance=e.target.value==="clearance";$("#clashDistanceLabel").firstChild.textContent=clearance?"Distância mínima (m)":"Precisão geométrica (m)";$("#collisionRadius").value=clearance?"0.050":"0.001";};$("#clashPreset").onchange=e=>{refreshModelOptions();const[a,b]=e.target.value.split("|");const optionA=a&&findPresetOption(setA,a),optionB=b&&findPresetOption(setB,b);if(optionA)setA.value=optionA;if(optionB)setB.value=optionB;if(e.target.value&&(!optionA||!optionB))summary.textContent="Algum modelo do preset não está carregado nesta página; confira os grupos.";renderTypeFilter($("#clashTypesA"),setA.value);renderTypeFilter($("#clashTypesB"),setB.value);};
 [setA,setB].forEach(select=>select.addEventListener("focus",refreshModelOptions));
 new MutationObserver(()=>{if(!panel.hidden)refreshModelOptions();}).observe(panel,{attributes:true,attributeFilter:["hidden"]});
 refreshModelOptions();
 setA.addEventListener("change",()=>renderTypeFilter($("#clashTypesA"),setA.value));setB.addEventListener("change",()=>renderTypeFilter($("#clashTypesB"),setB.value));
 renderTypeFilter($("#clashTypesA"),setA.value);renderTypeFilter($("#clashTypesB"),setB.value);$("#clashSearch").oninput=$("#clashStatus").onchange=applyFilters;panel.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>showClash(adjacentClashIndex(activeIndex,visibleResults.length,Number(b.dataset.nav))));$("#downloadCollisionPdf").onclick=()=>downloadReport();$("#copyClashLink").onclick=()=>copyClashLink();$("#exportAllBcf").onclick=async()=>{for(const c of results)await exportViewpoint(c);};$("#closeCollisionPanel").onclick=()=>{controller?.abort();panel.hidden=true;restore({keepSnapshot:false});};render();return{destroy(){destroyed=true;controller?.abort();restore({keepSnapshot:false});resultsView.destroy();},getResults:()=>results,isIsolated:()=>isolated};
}
