import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchLocations} from '../js/search.js';
import {shortestPath} from '../js/routes.js';
const locations=JSON.parse(readFileSync(new URL('../data/locations.json',import.meta.url))),graph=JSON.parse(readFileSync(new URL('../data/routes.json',import.meta.url)));
for(const room of ['EE01','EV01','ED01','EW04','EJ10','EH02'])test('Busca '+room,()=>{const[r]=searchLocations(room,locations);assert.equal(r.location.id,room[1]);assert.equal(r.room,room);});
test('E ofrece los siete ejemplos solicitados',()=>assert.deepEqual(searchLocations('E',locations).map(r=>r.label),['EA01','ED01','EE01','EV01','EW01','EJ01','EH01']));
test('Ignora acentos y mayúsculas',()=>assert.equal(searchLocations('PSICOLOGIA',locations)[0].location.id,'PSI'));
test('Pendientes sin letra ni punto inventado',()=>{for(const id of ['PSI','DEN','MIC','QUI','BIO']){const l=locations.find(l=>l.id===id);assert.equal(l.x,undefined);assert.equal(l.node,undefined);}});
test('Datos confirmados de Industrial y talleres',()=>{assert.equal(locations.find(l=>l.id==='J').rooms.length,10);assert.equal(locations.find(l=>l.id==='W').rooms.length,4);for(const id of ['R','Q'])assert.equal(locations.find(l=>l.id===id).rooms.length,0);});
test('Todas las ubicaciones tienen ruta desde los cuatro accesos',()=>{for(const a of graph.accesses)for(const l of locations.filter(l=>l.x)){const r=shortestPath(graph,a.id,l.node);assert.ok(r,`${a.id} → ${l.id}`);assert.ok(r.meters>0);assert.equal(r.path.at(-1),l.node);}});
function rectHit(a,b,l){const xmin=l.x-l.w/2,xmax=l.x+l.w/2,ymin=l.y-l.h/2,ymax=l.y+l.h/2,dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;for(const[p,q]of[[-dx,a[0]-xmin],[dx,xmax-a[0]],[-dy,a[1]-ymin],[dy,ymax-a[1]]]){if(p===0){if(q<0)return false;}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}return lo<=hi;}
test('Ningún camino atraviesa edificios, canchas o estacionamientos',()=>{for(const[a,b]of graph.edges)for(const l of locations.filter(l=>l.x))assert.ok(!rectHit(graph.nodes[a],graph.nodes[b],l),`${a} → ${b} atraviesa ${l.id}`);});
test('El canal solo se cruza en pasos señalados por confirmar',()=>{const canal=[[220,100],[300,250],[320,430],[365,475],[420,490],[480,575],[550,720],[620,770],[760,805],[900,795],[1020,650],[1110,620]];const ori=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(const[a,b]of graph.edges){const p=graph.nodes[a],q=graph.nodes[b];const crosses=canal.slice(1).some((d,i)=>{const c=canal[i];return ori(p,q,c)*ori(p,q,d)<0&&ori(c,d,p)*ori(c,d,q)<0;});if(crosses)assert.ok(graph.bridges.some(([s,t])=>JSON.stringify([s,t])===JSON.stringify([p,q])||JSON.stringify([s,t])===JSON.stringify([q,p])),`Cruce sin puente: ${a} ${b}`);}});
test('Sin ruta para destinos inexistentes',()=>assert.equal(shortestPath(graph,graph.accesses[0].id,'unknown'),null));
test('Los nodos de la red permanecen dentro del contorno aproximado del campus',()=>{for(const[id,[x,y]]of Object.entries(graph.nodes))assert.ok(x>=60&&x<=850+(y-100)*.36&&y>=85&&y<=990,`Nodo exterior: ${id}`);});
