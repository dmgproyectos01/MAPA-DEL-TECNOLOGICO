import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// These tests intercept every Supabase operation. They exercise the browser UI
// and HTTP contract without publishing events or media to a real backend.
const runtimePlaywright='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
let playwright;
try {playwright=await import('playwright');} catch(error) {if(!existsSync(runtimePlaywright))throw error;playwright=await import(runtimePlaywright);}
const {chromium}=playwright.chromium?playwright:playwright.default;
const target=process.env.CAMPUS_QA_URL||'http://127.0.0.1:3000/';
const output=path.join(process.cwd(),'tests/screenshots');
await mkdir(output,{recursive:true});await mkdir('work',{recursive:true});
const report={target,backend:'Intercepted mock Supabase; no production writes',started:new Date().toISOString(),checks:[],failures:[]};
const executablePath=process.env.CAMPUS_CHROMIUM_PATH||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(runtimePlaywright)&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const host='https://example.supabase.co';
const ADMIN='10000000-0000-4000-8000-000000000001',VISITOR='10000000-0000-4000-8000-000000000002';
const PUBLIC='20000000-0000-4000-8000-000000000001',DRAFT='20000000-0000-4000-8000-000000000002';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=','base64');
const mp4=Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANgbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAKAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAot0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAACgAAAEAAABAAAAAAIDbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABrm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAW5zdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAJJ8AAAAAAAAABhzdHRzAAAAAAAAAAEAAAAEAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAACAAAAAACAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAABAAAAAEAAAAkc3RzegAAAAAAAAAAAAAABAAAAsoAAAAMAAAADAAAAAwAAAAUc3RjbwAAAAAAAAABAAADkAAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDMAAAAIZnJlZQAAAvZtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFGWIhAAz//7fMvgU04+pzrh6Vs+dAAAACEGaI2xCv/7AAAAACEGeQXiFf8SBAAAACAGeYmpCv8SA','base64');
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'apikey,authorization,content-type,prefer,x-upsert,x-client-info'};

function backendState(){
 const media=[{id:'30000000-0000-4000-8000-000000000001',event_id:PUBLIC,storage_path:`${PUBLIC}/30000000-0000-4000-8000-000000000001.png`,kind:'photo',mime_type:'image/png',original_name:'Fotografía del evento.png'},
 {id:'30000000-0000-4000-8000-000000000002',event_id:PUBLIC,storage_path:`${PUBLIC}/30000000-0000-4000-8000-000000000002.mp4`,kind:'video',mime_type:'video/mp4',original_name:'Video del evento.mp4'}];
 const events=[{id:PUBLIC,title:'Semana de Ingeniería',description:'Fotografías, video y transmisión del evento académico.',starts_at:'2026-11-17T17:00:00Z',location:'Aula Magna · H',live_state:'off',status:'published',created_at:'2026-11-17T10:00:00Z',created_by:ADMIN},
 {id:DRAFT,title:'Borrador privado del organizador',description:'Este borrador no se debe mostrar a los visitantes.',starts_at:null,live_state:'off',status:'draft',created_at:'2026-11-17T09:00:00Z',created_by:ADMIN}];
 return{events,media,uploads:[],writes:[],requests:[],unexpected:[],failPublish:0,publishAttempts:0};
}
async function mockBackend(page,state){
 await page.route('**/data/events-config.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:host,publishableKey:'sb_publishable_events_test_only',bucket:'campus-events',nativeLive:{enabled:false,functionName:'campus-live'}})}));
 await page.route(`${host}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),pathname=url.pathname;
  const auth=request.headers().authorization||'',admin=auth==='Bearer test-admin-token';
  const respond=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  state.requests.push({method,path:pathname,query:url.search});
  if(method==='OPTIONS')return route.fulfill({status:204,headers});
  let payload;try{payload=request.postDataJSON();}catch{payload=null;}
  if(pathname==='/auth/v1/token'&&method==='POST'){
   const visitor=payload?.email==='visitor@example.test',user={id:visitor?VISITOR:ADMIN,email:payload?.email||'admin@example.test'};
   return respond({access_token:visitor?'test-visitor-token':'test-admin-token',refresh_token:visitor?'visitor-refresh':'admin-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  }
  if(pathname==='/auth/v1/user')return respond({id:admin?ADMIN:VISITOR,email:admin?'admin@example.test':'visitor@example.test'});
  if(pathname==='/auth/v1/logout')return respond({});
  if(pathname==='/rest/v1/event_admins')return respond(admin?[{user_id:ADMIN}]:[]);
  if(pathname.startsWith('/storage/v1/object/sign/')&&method==='POST')return respond({signedURL:pathname.replace('/storage/v1','')+'?token=mock-signed-media'});
  if(pathname.startsWith('/storage/v1/object/sign/')&&method==='GET'){
   const bytes=pathname.endsWith('.mp4')?mp4:png,type=pathname.endsWith('.mp4')?'video/mp4':'image/png';
   const range=/bytes=(\d+)-(\d*)/.exec(request.headers().range||'');
   if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;return route.fulfill({status:206,headers:{...headers,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`},contentType:type,body:bytes.subarray(start,end+1)});}
   return route.fulfill({status:200,headers:{...headers,'Accept-Ranges':'bytes'},contentType:type,body:bytes});
  }
  if(pathname.startsWith('/storage/v1/object/campus-events/')&&method==='POST'){
   if(!admin)return respond({message:'Administrador requerido'},403);
   state.uploads.push({path:pathname,bytes:request.postDataBuffer()?.length||0,type:request.headers()['content-type']});
   return respond({Key:pathname.replace('/storage/v1/object/','')});
  }
  if(pathname==='/storage/v1/object/campus-events'&&method==='DELETE')return admin?respond({}):respond({message:'Administrador requerido'},403);
  const table=pathname.split('/').at(-1);
  if(pathname.startsWith('/rest/v1/')&&['campus_events','event_media'].includes(table)){
   const id=(url.searchParams.get('id')||'').replace(/^eq\./,''),eventId=(url.searchParams.get('event_id')||'').replace(/^eq\./,'');
   if(method==='GET'){
    if(table==='event_media')return respond(state.media.filter(row=>!eventId||row.event_id===eventId));
    return respond(state.events.filter(row=>(!id||row.id===id)&&(admin&&url.searchParams.get('status')!=='eq.published'||row.status==='published')).map(row=>({...row,event_media:state.media.filter(media=>media.event_id===row.id)})));
   }
   if(!admin)return respond({message:'Administrador requerido'},403);
   state.writes.push({table,method,payload});
   if(table==='campus_events'&&method==='POST'){
    const row={...payload,id:payload?.id||`20000000-0000-4000-8000-${String(state.events.length+1).padStart(12,'0')}`,created_by:ADMIN,created_at:new Date().toISOString()};state.events.push(row);return respond([row],201);
   }
   if(table==='campus_events'&&method==='PATCH'){
    if(payload?.status==='published'){
     state.publishAttempts++;if(state.failPublish>0){state.failPublish--;return respond({message:'Publicación rechazada durante la prueba.'},403);}
    }
    const row=state.events.find(row=>row.id===id);if(!row)return respond({message:'Evento no encontrado'},404);Object.assign(row,payload);return respond([row]);
   }
   if(table==='event_media'&&method==='POST'){
    const row={...payload,id:payload?.id||`30000000-0000-4000-8000-${String(state.media.length+1).padStart(12,'0')}`};state.media.push(row);return respond([row],201);
   }
   if(method==='DELETE'){if(table==='event_media')state.media=state.media.filter(row=>row.id!==id);else state.events=state.events.filter(row=>row.id!==id);return route.fulfill({status:204,headers});}
  }
  state.unexpected.push({method,path:pathname,query:url.search});return respond({message:'Endpoint no previsto en la prueba'},500);
 });
}
async function openEvents(page){
 await page.locator('#open-events').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('#open-events').disabled);
 await page.locator('#open-events').click();await page.locator('#events-dialog').waitFor({state:'visible'});
}
async function signIn(page,email='admin@example.test'){
 await page.locator('#events-manage').click();
 await page.locator('#events-email').fill(email);await page.locator('#events-password').fill('test-password-not-a-secret');
 await page.locator('#events-login-form').evaluate(form=>form.requestSubmit());
}
async function fits(page){
 const actual=await page.locator('#events-dialog').evaluate(dialog=>({page:document.documentElement.scrollWidth>innerWidth+1,dialog:dialog.scrollWidth>dialog.clientWidth+1,forms:[...dialog.querySelectorAll('form,input,select,textarea,video,img,iframe')].filter(el=>el.getClientRects().length).some(el=>{const r=el.getBoundingClientRect(),d=dialog.getBoundingClientRect();return r.left<d.left-1||r.right>d.right+1;})}));
 assert.deepEqual(actual,{page:false,dialog:false,forms:false},'Events must fit horizontally at this viewport');
}
async function scenario(viewport,title,callback){
 const [name,width,height]=viewport,state=backendState();
 const context=await browser.newContext({viewport:{width,height},isMobile:name!=='desktop',hasTouch:name!=='desktop',deviceScaleFactor:1,colorScheme:'light'});
 const page=await context.newPage(),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 try{
  await mockBackend(page,state);await page.goto(target,{waitUntil:'networkidle'});await openEvents(page);
  await callback(page,state,name);
  assert.deepEqual(state.unexpected,[]);assert.deepEqual(pageErrors,[]);
  report.checks.push({viewport:name,name:title,ok:true});
 }catch(error){
  report.checks.push({viewport:name,name:title,ok:false});report.failures.push({viewport:name,name:title,error:error.stack||String(error)});
  await page.screenshot({path:path.join(output,`events-${name}-failure-${report.failures.length}.png`),fullPage:true}).catch(()=>{});
 }finally{await context.close();}
}
for(const viewport of [['desktop',1366,768],['mobile',390,844],['small-mobile',320,740]]){
 await scenario(viewport,'Visitor photos and videos, no external player, dark mode and dialog focus',async(page,state,name)=>{
  const card=page.locator(`[data-event-id="${PUBLIC}"]`);
  await card.waitFor({state:'visible'});
  assert.equal(await page.locator(`[data-event-id="${DRAFT}"]`).count(),0,'Drafts must not be shown to visitors');
  assert.equal(await page.locator('#events-editor-form').count(),0);
  const photoFigure=card.locator('[data-media-id="30000000-0000-4000-8000-000000000001"]');
  await photoFigure.scrollIntoViewIfNeeded();
  const image=photoFigure.locator('img');
  await image.waitFor({state:'attached'});
  const videoFigure=card.locator('[data-media-id="30000000-0000-4000-8000-000000000002"]');
  await videoFigure.locator('[data-event-action="load-media"]').click();
  const video=videoFigure.locator('video');await video.waitFor({state:'attached'});
  await image.evaluate(async img=>{await img.decode();if(!img.naturalWidth)throw Error('Photo did not decode');});
  assert.equal(await video.getAttribute('controls')!==null,true);assert.equal(await video.getAttribute('playsinline')!==null,true);
  await video.evaluate(async el=>{el.load();await new Promise((resolve,reject)=>{if(el.readyState>=1)return resolve();el.addEventListener('loadedmetadata',resolve,{once:true});el.addEventListener('error',()=>reject(new Error('Video metadata failed')),{once:true});setTimeout(()=>reject(new Error('Video metadata timed out')),5000);});});
  assert.equal(await page.locator('#events-dialog iframe').count(),0,'Events must use native media instead of external players');
  assert.equal(await page.locator('#events-dialog a[href]').count(),0,'No external viewing links should be required');
  await fits(page);
  const lightBackground=await page.locator('#events-dialog').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.locator('#events-dialog .events-body').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(output,`events-${name}-public.png`),fullPage:true});
  await page.keyboard.press('Escape');await page.locator('#events-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#open-events').evaluate(el=>document.activeElement===el),true);
  await page.locator('#theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await openEvents(page);await fits(page);
  assert.notEqual(await page.locator('#events-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),lightBackground,'Event dialog must use the dark palette');
  await page.locator('#events-close').click();
  await page.locator('#search').fill('EH02');await page.locator('#suggestions [role="option"]').first().waitFor({state:'visible'});await page.locator('#search').press('Enter');
  assert.equal(await page.locator('.place.selected').getAttribute('data-id'),'H');
  assert.equal(state.writes.length,0);assert.equal(state.uploads.length,0);
 });
 await scenario(viewport,'Authenticated non-administrator cannot open the publisher',async(page,state)=>{
  await signIn(page,'visitor@example.test');await page.locator('#events-auth-error').waitFor({state:'visible'});
  assert.match(await page.locator('#events-auth-error').innerText(),/No pudimos iniciar sesión|administrador|autoriz|permis/i);
  assert.equal(await page.locator('#events-new-event').count(),0);assert.equal(await page.locator('#events-editor-form').count(),0);
  assert.equal(state.writes.length,0);assert.equal(state.uploads.length,0);await fits(page);
 });
 await scenario(viewport,'Administrator uploads real files and retries a failed publication without duplicate media',async(page,state,name)=>{
  await signIn(page);await page.locator('#events-new-event').waitFor({state:'visible'});
  await page.locator(`[data-event-id="${DRAFT}"] [data-event-action="edit-event"]`).click();
  await page.locator('#event-title').fill('Borrador actualizado del organizador');
  await page.locator('#event-date').fill('2026-11-17T09:00');
  await page.locator('[data-event-action="save-draft"]').click();
  await page.locator('#events-admin-feedback').waitFor({state:'visible'});
  assert.match(await page.locator('#events-admin-feedback').innerText(),/Borrador guardado/);
  assert.equal(state.events.find(event=>event.id===DRAFT)?.status,'draft');
  await page.locator('[data-event-action="back-gallery"]').click();
  await page.locator(`#events-gallery [data-event-id="${PUBLIC}"]`).waitFor({state:'visible'});
  assert.equal(await page.locator(`#events-gallery [data-event-id="${DRAFT}"]`).count(),0,'Saving a draft must not make it public');
  await page.locator('#events-manage').click();await page.locator('#events-new-event').click();
  await page.locator('#event-title').fill('Prueba de publicación con fotografías y video');
  await page.locator('#event-date').fill('2026-11-17T10:30');
  const location=page.locator('#event-location');if(await location.evaluate(el=>el.tagName)==='SELECT')await location.selectOption('H');else await location.fill('Aula Magna · H');
  await page.locator('#event-description').fill('Registro académico con nombres completos y contenido multimedia.');
  assert.equal(await page.locator('#event-youtube,#event-live-state').count(),0,'External streaming controls must be removed');
  await page.locator('#event-native-live-enabled').check();
  const chooser=page.waitForEvent('filechooser');await page.locator('#event-media').click();
  await(await chooser).setFiles([{name:'foto-prueba.png',mimeType:'image/png',buffer:png},{name:'video-prueba.mp4',mimeType:'video/mp4',buffer:mp4}]);
  state.failPublish=1;
  await page.locator('[data-event-action="publish"]').click();
  await page.locator('#events-editor-feedback[role="alert"]').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-event-action="retry-uploads"]')&&!document.querySelector('[data-event-action="retry-uploads"]').disabled);
  assert.equal(state.publishAttempts,1);assert.equal(state.uploads.length,2);assert.ok(state.uploads.every(file=>file.bytes>0));
  assert.equal(state.events.find(event=>event.title==='Prueba de publicación con fotografías y video')?.status,'draft','Failed publication must remain a draft');
  assert.equal(await page.locator('#events-admin-feedback').isVisible(),false,'Failed publish must not show a success message');
  await fits(page);await page.locator('[data-event-action="retry-uploads"]').click();
  await page.locator('#events-admin-list').waitFor({state:'visible'});
  assert.ok((await page.locator('#events-admin-feedback').innerText()).includes('Evento publicado.'));
  assert.equal(state.publishAttempts,2);assert.equal(state.uploads.length,2,'Retry must not duplicate already uploaded media');
  const published=state.events.find(event=>event.title==='Prueba de publicación con fotografías y video');assert.equal(published?.status,'published');assert.equal(published.native_live_enabled,true);assert.equal(published.starts_at,'2026-11-17T17:30:00.000Z','Date must use the Culiacán time zone');
  assert.equal(state.media.filter(media=>media.event_id===published.id).length,2);
  await fits(page);await page.screenshot({path:path.join(output,`events-${name}-admin.png`),fullPage:true});
  await page.locator(`[data-event-id="${published.id}"] [data-event-action="prepare-live"]`).click();
  await page.locator('#native-live-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('#native-live-panel').getAttribute('data-state'),'idle');
  assert.ok(await page.locator('#native-live-start').isDisabled(),'An unconfigured native backend must not pretend streaming is available');
  assert.match(await page.locator('#native-live-panel').innerText(),/todavía no está habilitado/);
  assert.equal(await page.locator('#events-dialog iframe,#event-youtube').count(),0);
  assert.ok(!state.requests.some(request=>request.path.startsWith('/functions/')),'Opening disabled native controls must not start a server session');
  await fits(page);
 });
}
await browser.close();report.finished=new Date().toISOString();await writeFile('work/qa-events-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failures.length)process.exitCode=1;
