const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const adjacencyCache=new WeakMap();
export function shortestPath(graph,start,end){
 if(!graph.nodes[start]||!graph.nodes[end])return null;
 let adj=adjacencyCache.get(graph);
 if(!adj){adj={};for(const[a,b]of graph.edges){const cost=distance(graph.nodes[a],graph.nodes[b]);(adj[a]??=[]).push([b,cost]);(adj[b]??=[]).push([a,cost]);}adjacencyCache.set(graph,adj);}
 const dist=new Map([[start,0]]),prev=new Map(),heap=[];
 const push=item=>{let i=heap.length;heap.push(item);while(i){const parent=(i-1)>>1;if(heap[parent][0]<=item[0])break;heap[i]=heap[parent];i=parent;}heap[i]=item;};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1][0]<heap[child][0])child++;if(heap[child][0]>=last[0])break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
 push([0,start]);
 while(heap.length){const[cost,u]=pop();if(cost!==dist.get(u))continue;if(u===end)break;for(const[v,w]of adj[u]||[]){const next=cost+w;if(next<(dist.get(v)??Infinity)){dist.set(v,next);prev.set(v,u);push([next,v]);}}}
 if(!dist.has(end))return null;
 const path=[end];while(path[0]!==start){const p=prev.get(path[0]);if(!p)return null;path.unshift(p);}
 const ids=new Set();for(let i=1;i<path.length;i++)for(const id of graph.edgeAnnotations?.[[path[i-1],path[i]].sort().join('|')]||[])ids.add(id);
 return{path,points:path.map(n=>graph.nodes[n]),meters:Math.round(dist.get(end)*graph.metersPerUnit),advisories:(graph.annotations||[]).filter(a=>ids.has(a.id)&&a.type.startsWith('provisional-')).map(a=>a.note)};
}
export async function initRoutes(locations,camera,notify){
 const g=await fetch('data/routes.json?v=raster-v2',{cache:'no-store'}).then(r=>r.json());
 document.querySelector('#access-layer').innerHTML=g.accesses.map(a=>`<g class="access access-hotspot" tabindex="0" role="button" data-access="${a.id}" aria-label="${a.name}"><title>${a.name}</title><circle cx="${a.x}" cy="${a.y}" r="13"/></g>`).join('');
 let destination=null,origin=g.accesses.find(a=>a.node)?.id;const panel=document.querySelector('#route-panel'),layer=document.querySelector('#route-layer'),clearButton=document.querySelector('#clear-active-route');
 function clearRoute(){
  if(!layer.hasChildNodes()&&panel.hidden)return;
  const restoreFocus=panel.contains(document.activeElement)||document.activeElement===clearButton;
  destination=null;layer.replaceChildren();panel.hidden=true;clearButton.hidden=true;camera.reset();notify('Ruta quitada.');
  if(restoreFocus)document.querySelector('#reset').focus({preventScroll:true});
 }
 clearButton.onclick=clearRoute;
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!e.defaultPrevented&&!e.target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"])'))clearRoute();
 });
 function show(l){if(!l.node){notify('Ruta no disponible para este destino.');return;}destination=l;document.querySelector('#detail').hidden=true;document.querySelector('.welcome').classList.add('dismissed');panel.hidden=false;panel.innerHTML=`<div class="route-controls"><div class="card-heading"><span class="eyebrow">PASO A PASO</span><button class="close" aria-label="Quitar ruta y cerrar indicaciones" title="Quitar ruta y cerrar indicaciones">×</button></div><button id="clear-route" class="primary">Quitar ruta</button></div><h2>Tu camino al campus.</h2><label for="route-origin">Desde un acceso</label><select id="route-origin">${g.accesses.map(a=>`<option value="${a.id}" ${a.node?'':'disabled'} ${a.id===origin?'selected':''}>${a.name}${a.node?'':' · sin ruta disponible'}</option>`).join('')}</select><label for="route-destination">Tu destino</label><select id="route-destination">${locations.map(p=>`<option value="${p.id}" ${p.id===l.id?'selected':''} ${p.node?'':'disabled'}>${p.name}${p.node?'':' · sin ruta disponible'}</option>`).join('')}</select><div id="route-summary"></div><small>Distancia aproximada sobre el plano de referencia. Sigue la señalización del campus.</small>`;panel.scrollTop=0;panel.querySelector('.close').onclick=clearRoute;panel.querySelector('#clear-route').onclick=clearRoute;panel.querySelector('#route-origin').onchange=e=>{origin=e.target.value;draw();};panel.querySelector('#route-destination').onchange=e=>{destination=locations.find(p=>p.id===e.target.value);draw();};draw();}
 function draw(){if(!destination?.node)return;const r=shortestPath(g,origin,destination.node),summary=panel.querySelector('#route-summary');if(!r){summary.textContent='No hay una ruta disponible.';layer.replaceChildren();clearButton.hidden=true;return;}const a=r.points[0],b=r.points.at(-1);layer.innerHTML=`<path class="route-halo" d="M${r.points.join('L')}"/><path class="route-line" d="M${r.points.join('L')}"/><circle class="route-start" cx="${a[0]}" cy="${a[1]}" r="8"/><circle class="route-end" cx="${b[0]}" cy="${b[1]}" r="9"/>`;clearButton.hidden=false;
 const segments=[];for(let i=1;i<r.points.length;i++){const p=r.points[i-1],q=r.points[i],dx=q[0]-p[0],dy=q[1]-p[1],dir=Math.abs(dx)>Math.abs(dy)?dx>0?'este':'oeste':dy>0?'sur':'norte',meters=distance(p,q)*g.metersPerUnit;if(segments.at(-1)?.dir===dir)segments.at(-1).meters+=meters;else segments.push({dir,meters});}
 summary.innerHTML=`<div class="route-stats"><b>≈ ${r.meters} m</b><span>${Math.max(1,Math.ceil(r.meters/75))} min a pie</span></div>${r.advisories.map(note=>`<p class="route-advisory">${note}</p>`).join('')}<p>Inicio: ${g.accesses.find(a=>a.id===origin).name}<br>Destino: ${destination.name}</p><ol class="route-steps">${segments.map(s=>`<li>Camina hacia el ${s.dir} unos ${Math.max(1,Math.round(s.meters))} m.</li>`).join('')}<li>Llega al acceso de ${destination.name}.</li></ol>`;camera.fit(r.points);notify('Ruta peatonal orientativa calculada.');}
 window.addEventListener('request-route',e=>show(e.detail));document.querySelectorAll('.access').forEach(el=>{const act=()=>{const a=g.accesses.find(a=>a.id===el.dataset.access);if(!a?.node){notify('Ruta no disponible desde este acceso.');return;}origin=a.id;show(destination||locations.find(l=>l.id==='I'));};el.onclick=act;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}};});
 return g;
}
