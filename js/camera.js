export function initCamera(svg) {
  const world=svg.querySelector('#world'),width=svg.viewBox.baseVal.width,height=svg.viewBox.baseVal.height;
  let view={x:0,y:0,k:1},animation,points=new Map(),last=null,moved=false;
  const fromScreen=(x,y)=>new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
  function render(){world.setAttribute('transform',`translate(${view.x} ${view.y}) scale(${view.k})`);}
  function clamp(v){
    v.k=Math.max(.4,Math.min(7,v.k));
    const r=svg.getBoundingClientRect(),a=fromScreen(r.left,r.top),b=fromScreen(r.right,r.bottom);
    const mx=Math.min(width*v.k*.2,(b.x-a.x)*.12),my=Math.min(height*v.k*.2,(b.y-a.y)*.12);
    v.x=Math.max(a.x+mx-width*v.k,Math.min(b.x-mx,v.x));
    v.y=Math.max(a.y+my-height*v.k,Math.min(b.y-my,v.y));
    return v;
  }
  function animate(target){
    cancelAnimationFrame(animation);target=clamp(target);
    const start={...view},time=performance.now(),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    function step(now){const t=reduce?1:Math.min(1,(now-time)/240),s=1-(1-t)**3;view={x:start.x+(target.x-start.x)*s,y:start.y+(target.y-start.y)*s,k:start.k+(target.k-start.k)*s};render();if(t<1)animation=requestAnimationFrame(step);}
    animation=requestAnimationFrame(step);
  }
  function availableArea(panelSelector){
    const r=svg.getBoundingClientRect(),panel=document.querySelector(panelSelector);
    let left=r.left+16,right=r.right-16,top=r.top+16,bottom=r.bottom-16;
    if(panel&&!panel.hidden){const p=panel.getBoundingClientRect();if(innerWidth<700)bottom=Math.min(bottom,p.top-12);else right=Math.min(right,p.left-12);}
    if(right-left<40){left=r.left+8;right=r.right-8;}
    if(bottom-top<40){top=r.top+8;bottom=top+40;}
    const a=fromScreen(left,top),b=fromScreen(right,bottom);
    return{left:a.x,right:b.x,top:a.y,bottom:b.y,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};
  }
  function zoom(f,p={x:width/2,y:height/2},smooth=true){const k=Math.max(.4,Math.min(7,view.k*f)),r=k/view.k,next={k,x:p.x-(p.x-view.x)*r,y:p.y-(p.y-view.y)*r};if(smooth)animate(next);else{view=clamp(next);render();}}
  svg.addEventListener('wheel',e=>{e.preventDefault();cancelAnimationFrame(animation);zoom(Math.exp(-e.deltaY*.0025),fromScreen(e.clientX,e.clientY),false);},{passive:false});
  function center(){const a=[...points.values()];return a.length===1?{x:a[0].x,y:a[0].y,d:0}:{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};}
  svg.addEventListener('pointerdown',e=>{if(e.button>0)return;cancelAnimationFrame(animation);points.set(e.pointerId,fromScreen(e.clientX,e.clientY));last=center();moved=false;window.mapDragged=false;svg.style.cursor='grabbing';});
  svg.addEventListener('pointermove',e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,fromScreen(e.clientX,e.clientY));const c=center(),dx=c.x-last.x,dy=c.y-last.y;if(Math.abs(dx)+Math.abs(dy)>2||c.d){moved=true;window.mapDragged=true;svg.setPointerCapture(e.pointerId);}if(c.d&&last.d)zoom(c.d/last.d,{x:last.x,y:last.y},false);view=clamp({...view,x:view.x+dx,y:view.y+dy});render();last=c;});
  const end=e=>{points.delete(e.pointerId);last=points.size?center():null;svg.style.cursor='';if(moved)setTimeout(()=>window.mapDragged=false,80);};
  svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
  svg.addEventListener('pointerup',e=>{if(!moved){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.place');if(target){window.dispatchEvent(new CustomEvent('map-place-tap',{detail:target.dataset.id}));window.mapDragged=true;setTimeout(()=>window.mapDragged=false,80);}}});
  const reset=()=>animate({x:0,y:0,k:1});
  document.querySelector('#zoom-in').onclick=()=>zoom(1.4);document.querySelector('#zoom-out').onclick=()=>zoom(1/1.4);document.querySelector('#reset').onclick=reset;document.querySelector('#north').onclick=reset;
  window.addEventListener('campus-select',e=>{const l=e.detail;if(l.x){const a=availableArea('#detail'),k=2.6;animate({k,x:a.cx-l.x*k,y:a.cy-l.y*k});}});
  return{reset,fit(points){const a=availableArea('#route-panel'),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),k=Math.max(.4,Math.min(2.6,(a.right-a.left)/Math.max(20,right-left)*.85,(a.bottom-a.top)/Math.max(20,bottom-top)*.85));animate({k,x:a.cx-(left+right)/2*k,y:a.cy-(top+bottom)/2*k});}};
}
