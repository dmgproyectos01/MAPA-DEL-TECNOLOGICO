import {campus} from './map.js?v=levels-v1';
const [locations,layout]=await Promise.all(['data/locations.json','data/map-layout.json'].map(path=>fetch(path+'?v=levels-v1',{cache:'no-store'}).then(r=>r.json())));
for(const location of locations){if(location.buildingId){const building=locations.find(place=>place.id===location.buildingId);if(building)for(const key of ['x','y','node'])location[key]=building[key];}}
const app=document.querySelector('#app');
app.innerHTML=`<main class="map-app"><div id="map-host">${campus(locations,layout)}</div><header class="topbar"><a class="brand" href="./" aria-label="Inicio"><span class="brand-mark" aria-hidden="true">ITC</span><span>MAPA INTERACTIVO<span>DEL TECNOLÓGICO DE CULIACÁN</span></span></a><div class="search-wrap"><label class="sr-only" for="search">Buscar en el campus</label><span class="search-icon">⌕</span><input id="search" placeholder="Busca un edificio, salón o servicio…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="suggestions"><kbd>/</kbd><div id="suggestions" role="listbox" hidden></div></div><button id="open-events" class="events-launcher" type="button" aria-label="Ver eventos, fotos y videos" disabled>Eventos</button><button class="icon-button" id="theme" aria-label="Cambiar modo de color">◐</button></header><section hidden class="welcome" aria-labelledby="campus-title"><div class="eyebrow">TEC DE CULIACÁN <span aria-hidden="true">/</span> MAPA INTERACTIVO</div><h1 id="campus-title">Mapa Interactivo del Tecnológico de Culiacán</h1><p>Busca tu salón o selecciona un edificio en el mapa.</p><button class="primary" id="explore">Comenzar a explorar <svg class="button-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></section><nav class="filters" aria-label="Filtros del mapa"></nav><aside id="detail" class="floating-card" hidden></aside><section id="route-panel" class="floating-card route-panel" hidden></section><section id="collection" class="floating-card collection" hidden></section><div class="map-tools"><button id="north" class="north" aria-label="Norte arriba; ver todo el campus">↑<span>N</span></button><div class="zoom-group"><button id="zoom-in" aria-label="Acercar">+</button><button id="zoom-out" aria-label="Alejar">−</button><button id="reset" aria-label="Ver todo el campus" title="Ver todo el campus">⌖</button></div></div><button id="clear-active-route" class="active-route-clear" title="Quitar ruta (Esc)" hidden><span aria-hidden="true">×</span> Quitar ruta</button><footer class="bottom-bar"><span class="campus-signature"><span class="live-dot" aria-hidden="true"></span><span>Mapa Interactivo del Tecnológico de Culiacán</span></span><div><button id="open-student-services" type="button" disabled aria-haspopup="dialog">Servicios</button><button id="favorites">♡ Favoritos</button><button id="history">◷ Recientes</button><button id="legend">☷ Leyenda</button></div></footer><div id="legend-box" class="legend-box" hidden><b>Explora por color</b><span><i class="swatch academic"></i> Aulas y edificios</span><span><i class="swatch lab"></i> Laboratorios y biblioteca</span><span><i class="swatch sport"></i> Deportes</span><span><i class="swatch water"></i> Canal de aguas pluviales</span><span><i class="swatch path"></i> Camino peatonal</span><small>Plano orientativo · ubicaciones y distancias aproximadas.</small></div><div class="map-note">PLANO DEL CAMPUS</div><dialog id="student-services-dialog" aria-labelledby="student-services-title"></dialog><dialog id="events-dialog" aria-label="Eventos del Tecnológico de Culiacán"></dialog><div id="status" class="toast" role="status" aria-live="polite"></div></main>`;
const svg=document.querySelector('#campus');
let selected=null;
export function notify(message){const el=document.querySelector('#status');el.textContent=message;el.classList.add('show');clearTimeout(el.timer);el.timer=setTimeout(()=>el.classList.remove('show'),4000);}
export function selectLocation(id,room,options={}){const l=locations.find(l=>l.id===id);if(!l)return;selected=l;document.querySelectorAll('.place').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));document.querySelector('.welcome').classList.add('dismissed');showDetail(l,room,options);window.dispatchEvent(new CustomEvent('campus-select',{detail:l}));}
function showDetail(l,room,options){
 const hasValue=value=>value!=null&&String(value).trim();
 const rooms=(l.rooms||[]).filter(hasValue),services=(l.services||[]).filter(hasValue);
 const facts=[['Pisos',l.floors],['Horarios',l.hours]].filter(([,value])=>hasValue(value));
 const card=document.querySelector('#detail');card.hidden=false;card.scrollTop=0;
 const levels=l.levels||[];card.classList.toggle('has-levels',levels.length>0);
 if(levels.length){
  card.innerHTML=`<div class="card-heading floor-heading"><div><span class="eyebrow">EDIFICIO ${l.code||l.id}</span><h2>${l.name}</h2></div><button class="close" aria-label="Cerrar información">×</button></div>
  <div class="floor-tabs" role="tablist" aria-label="Pisos de ${l.name}" style="--floor-count:${levels.length}">${levels.map(level=>`<button type="button" role="tab" id="floor-tab-${level.id}" data-level="${level.id}" aria-controls="floor-panel" aria-selected="false" tabindex="-1">${level.name}</button>`).join('')}</div>
  <section id="floor-panel" class="floor-panel" role="tabpanel" tabindex="0"></section>
  <div class="card-actions"><button class="primary" id="get-route" ${l.node?'':'disabled'}>Cómo llegar</button><button id="save-place" class="secondary">♡ Guardar</button></div>
  `;
  const initial=levels.find(level=>level.id===options.level)||levels.find(level=>level.items.some(item=>item.name===options.item||(room&&item.room===room)))||levels[0];
  const tabs=[...card.querySelectorAll('[role="tab"]')],panel=card.querySelector('.floor-panel');
  function activate(id){
   const level=levels.find(level=>level.id===id);if(!level)return;
   for(const tab of tabs){const active=tab.dataset.level===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
   panel.setAttribute('aria-labelledby',`floor-tab-${id}`);panel.dataset.level=id;
   panel.innerHTML=`<h3 class="floor-title">${level.name}</h3><ul class="floor-items">${level.items.map(item=>`<li class="floor-item${level.id===initial.id&&(item.name===options.item||(room&&item.room===room))?' is-match':''}"><span class="floor-item-name">${item.name}</span>${item.description?`<p>${item.description}</p>`:''}</li>`).join('')}</ul>`;
   panel.scrollTop=0;const match=panel.querySelector('.is-match');if(match)panel.scrollTop=Math.max(0,match.offsetTop-8);
  }
  tabs.forEach((tab,index)=>{
   tab.onclick=()=>activate(tab.dataset.level);
   tab.onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();activate(tabs[next].dataset.level);tabs[next].focus({preventScroll:true});};
  });
  activate(initial.id);
 }else{
 card.innerHTML=`<div class="card-heading"><span class="eyebrow">EXPLORA EL CAMPUS</span><button class="close" aria-label="Cerrar información">×</button></div>
 <div class="place-badge">${l.id}</div><h2>${l.name}</h2>
 ${room&&rooms.includes(room)?`<div class="room-highlight">Salón ${room}<p>Salón confirmado en este edificio.</p></div>`:''}
 ${l.description?`<p>${l.description}</p>`:''}
 ${rooms.length?`<div class="detail-section"><h3>Salones</h3><div class="room-list">${rooms.map(r=>`<span>${r}</span>`).join('')}</div></div>`:''}
 ${services.length?`<div class="detail-section"><h3>Servicios</h3><p>${services.join(' · ')}</p></div>`:''}
 ${facts.length?`<div class="details-grid">${facts.map(([label,value])=>`<div><h3>${label}</h3><p>${value}</p></div>`).join('')}</div>`:''}
 <div class="card-actions"><button class="primary" id="get-route" ${l.node?'':'disabled'}>Cómo llegar</button><button id="save-place" class="secondary">♡ Guardar</button></div>
 `;
 }
 if(l.appointmentUrl){const link=document.createElement('a');link.href=l.appointmentUrl;link.target='_blank';link.rel='noopener noreferrer';link.className='secondary appointment-link';link.textContent=l.appointmentLabel||'Agendar cita con el psicólogo';card.querySelector('.card-actions').before(link);}
 if(l.studentServiceId){const button=document.createElement('button');button.type='button';button.className='secondary appointment-link';button.textContent='Ver información del servicio';button.onclick=()=>window.dispatchEvent(new CustomEvent('open-student-service',{detail:l.studentServiceId}));card.querySelector('.card-actions').before(button);}
 card.setAttribute('role','region');card.setAttribute('aria-label','Información del lugar');
 card.querySelector('.close').onclick=closeDetail;
 card.querySelector('#get-route').onclick=()=>window.dispatchEvent(new CustomEvent('request-route',{detail:l}));
 card.querySelector('#save-place').onclick=()=>window.dispatchEvent(new CustomEvent('save-place',{detail:l}));
}
export function closeDetail(){document.querySelector('#detail').hidden=true;document.querySelectorAll('.selected').forEach(el=>el.classList.remove('selected'));selected=null;}
svg.addEventListener('click',e=>{const place=e.target.closest('.place');if(place&&!window.mapDragged)selectLocation(place.dataset.id);});
svg.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.place')){e.preventDefault();selectLocation(e.target.dataset.id);}});
document.querySelector('#explore').onclick=()=>{document.querySelector('.welcome').classList.add('dismissed');notify('Selecciona un edificio o busca tu salón.');};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDetail();document.querySelector('#suggestions').hidden=true;document.querySelector('#search').setAttribute('aria-expanded','false');}if(e.key==='/'&&!['INPUT','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.querySelector('#search').focus();}});
const {initSearch,storage}=await import('./search.js?v=levels-v1');
initSearch(locations,selectLocation,storage);
const {initCamera}=await import('./camera.js?v=raster-v2');
const camera=initCamera(svg);
window.addEventListener('map-place-tap',e=>selectLocation(e.detail));
const {initRoutes}=await import('./routes.js?v=route-clear-v1');
await initRoutes(locations,camera,notify);
const {initPreferences}=await import('./preferences.js?v=levels-v1');
initPreferences(locations,storage,selectLocation,notify);

const {initStudentServices}=await import('./student-services.js?v=student-services-v2');
await initStudentServices({button:document.querySelector('#open-student-services'),dialog:document.querySelector('#student-services-dialog'),selectLocation,notify});

const eventsButton=document.querySelector('#open-events');
try{
 const [{createEventsClient},{initEvents},eventsConfig]=await Promise.all([
  import('./events-api.js?v=native-v1'),
  import('./events.js?v=native-v1'),
  fetch('data/events-config.json?v=native-v1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Events configuration unavailable');return r.json();})
 ]);
 await initEvents({button:eventsButton,dialog:document.querySelector('#events-dialog'),client:createEventsClient(eventsConfig),notify,locations});
 eventsButton.disabled=false;
}catch{
 eventsButton.disabled=false;
 eventsButton.onclick=()=>notify('No se pudo abrir Eventos. Actualiza la página e inténtalo de nuevo.');
}
