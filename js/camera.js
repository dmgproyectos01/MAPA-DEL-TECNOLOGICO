export function initCamera(svg){
 const world=svg.querySelector('#world');let view={x:0,y:0,k:1},animation,points=new Map(),last=null,moved=false;
 const base=()=>({x:0,y:0,k:1});
 function render(){world.setAttribute('transform',`translate(${view.x} ${view.y}) scale(${view.k})`);}
 function clamp(v){v.k=Math.max(.8,Math.min(7,v.k));v.x=Math.max(1180-1180*v.k-260,Math.min(260,v.x));v.y=Math.max(1030-1030*v.k-220,Math.min(220,v.y));return v;}
 function animate(target){cancelAnimationFrame(animation);target=clamp(target);const start={...view},time=performance.now(),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;function step(now){const t=reduce?1:Math.min(1,(now-time)/240),s=1-(1-t)**3;view={x:start.x+(target.x-start.x)*s,y:start.y+(target.y-start.y)*s,k:start.k+(target.k-start.k)*s};render();if(t<1)animation=requestAnimationFrame(step);}animation=requestAnimationFrame(step);}
 function point(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform(svg.getScreenCTM().inverse());}
 function zoom(f,p={x:590,y:515},smooth=true){const k=Math.max(.8,Math.min(7,view.k*f)),r=k/view.k;const next={k,x:p.x-(p.x-view.x)*r,y:p.y-(p.y-view.y)*r};if(smooth)animate(next);else{view=clamp(next);render();}}
 svg.addEventListener('wheel',e=>{e.preventDefault();cancelAnimationFrame(animation);zoom(Math.exp(-e.deltaY*.0025),point(e),false);},{passive:false});
 function center(){const a=[...points.values()];if(a.length===1)return{x:a[0].x,y:a[0].y,d:0};return{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};}
 svg.addEventListener('pointerdown',e=>{if(e.button>0)return;cancelAnimationFrame(animation);points.set(e.pointerId,point(e));last=center();moved=false;window.mapDragged=false;svg.style.cursor='grabbing';});
 svg.addEventListener('pointermove',e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,point(e));const c=center();const dx=c.x-last.x,dy=c.y-last.y;if(Math.abs(dx)+Math.abs(dy)>2||c.d){moved=true;window.mapDragged=true;svg.setPointerCapture(e.pointerId);}if(c.d&&last.d)zoom(c.d/last.d,{x:last.x,y:last.y},false);view=clamp({...view,x:view.x+dx,y:view.y+dy});render();last=c;});
 const end=e=>{points.delete(e.pointerId);last=points.size?center():null;svg.style.cursor='';if(moved)setTimeout(()=>window.mapDragged=false,80);};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 // Captured pointer clicks retarget to the SVG: recover the place under the release point.
 svg.addEventListener('pointerup',e=>{if(!moved){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.place');if(target){window.dispatchEvent(new CustomEvent('map-place-tap',{detail:target.dataset.id}));window.mapDragged=true;setTimeout(()=>window.mapDragged=false,80);}}});
 document.querySelector('#zoom-in').onclick=()=>zoom(1.4);document.querySelector('#zoom-out').onclick=()=>zoom(1/1.4);document.querySelector('#reset').onclick=()=>animate(base());document.querySelector('#north').onclick=()=>animate(base());
 window.addEventListener('campus-select',e=>{const l=e.detail;if(l.x){const mobile=innerWidth<700;const k=2.6;animate({k,x:(mobile?590:480)-l.x*k,y:(mobile?330:480)-l.y*k});}});
 return{reset:()=>animate(base()),focus:(x,y,k=1.4)=>animate({k,x:590-x*k,y:480-y*k})};
}
