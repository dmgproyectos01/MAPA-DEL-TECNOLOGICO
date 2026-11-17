import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ensureLocalSFU,createNativeTestBackend,EVENT} from '../tools/livekit-test-server.mjs';
const runtimePlaywright='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
let playwright;
try{playwright=await import('playwright');}catch(error){if(!existsSync(runtimePlaywright))throw error;playwright=await import(runtimePlaywright);}
const {chromium}=playwright.chromium?playwright:playwright.default;
// A public HTTPS page must never be pointed at a local insecure test SFU.
const target=process.env.CAMPUS_NATIVE_QA_URL||'http://127.0.0.1:3000/';
const origin=new URL(target).origin;
assert.ok(['localhost','127.0.0.1'].includes(new URL(target).hostname),'Native RTC tests require a local application server');
const output=path.resolve('tests/screenshots');await mkdir(output,{recursive:true});await mkdir('work',{recursive:true});
const report={target,transport:'Real pinned LiveKit SFU and production SDK/controller/Events UI',backend:'Production Edge handler with intercepted Supabase Auth/DB only; no cloud activation',capture:'Chromium fake hardware source; genuine getUserMedia, PeerConnection, RTP and SFU',started:new Date().toISOString(),checks:[],failures:[]};
const sfu=await ensureLocalSFU();report.server={version:sfu.version,image:sfu.image,release:sfu.release};
const executablePath=process.env.CAMPUS_CHROMIUM_PATH||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(runtimePlaywright)&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
let managedRTCPolicy=null;
if(executablePath==='/usr/bin/chromium'&&existsSync('/etc/chromium/policies/managed/misc.json')){
 try{managedRTCPolicy=JSON.parse(await readFile('/etc/chromium/policies/managed/misc.json','utf8')).WebRtcIPHandling||null;}catch{}
}
if(managedRTCPolicy==='disable_non_proxied_udp')report.environmentBlocked={source:'/etc/chromium/policies/managed/misc.json',policy:'WebRtcIPHandling',value:managedRTCPolicy,message:'The managed local browser prohibits direct RTC transport. No policy was changed. Real transport assertions require the normal fresh CI browser.'};
const browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--allow-loopback-in-peer-connection']});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(callback,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await callback())return;await pause(100);}throw Error(message);}
async function contextFor(backend,{width=1366,height=768,capture=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700,permissions:capture?['camera','microphone']:[]});
 await context.addInitScript(()=>{
  window.__captureCalls=0;window.__captureTracks=[];
  const original=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if(original)navigator.mediaDevices.getUserMedia=async constraints=>{
   window.__captureCalls++;const stream=await original(constraints);window.__captureTracks.push(...stream.getTracks());return stream;
  };
 });
 const page=await context.newPage();page.nativePageErrors=[];page.on('pageerror',error=>page.nativePageErrors.push(error.message));await backend.install(page);await page.goto(target,{waitUntil:'networkidle'});
 return{context,page};
}
async function openEvents(page){await page.waitForFunction(()=>!document.querySelector('#open-events')?.disabled);await page.locator('#open-events').click();await page.locator('#events-dialog').waitFor({state:'visible'});}
async function hostPanel(page){
 await openEvents(page);await page.locator('#events-manage').click();
 await page.locator('#events-email').fill('admin@example.test');await page.locator('#events-password').fill('local-test-password');
 await page.locator('#events-login-form').evaluate(form=>form.requestSubmit());
 await page.locator(`[data-event-id="${EVENT}"] [data-event-action="prepare-live"]`).click();
 await page.locator('#native-live-panel').waitFor({state:'visible'});
 await page.locator('#native-live-prepare').click();
}
async function stateIs(page,state){await page.waitForFunction(expected=>document.querySelector('#native-live-panel')?.dataset.state===expected,state,{timeout:20000});}
async function noOverflow(page){
 const layout=await page.locator('#events-dialog').evaluate(dialog=>({page:document.documentElement.scrollWidth>innerWidth+1,dialog:dialog.scrollWidth>dialog.clientWidth+1,controls:[...dialog.querySelectorAll('#native-live-panel button,video')].filter(el=>el.getClientRects().length).some(el=>{const r=el.getBoundingClientRect(),d=dialog.getBoundingClientRect();return r.left<d.left-1||r.right>d.right+1;})}));
 assert.deepEqual(layout,{page:false,dialog:false,controls:false},'Native live controls and player must fit the viewport');
 assert.equal(await page.locator('#events-dialog iframe,#event-youtube').count(),0);
 assert.equal(await page.locator('#events-dialog a[href]').count(),0,'Camera streaming must stay inside the app');
}
async function check(name,callback){
 try{const detail=await callback();report.checks.push({name,ok:true,...(detail?{detail}:{})});}
 catch(error){report.checks.push({name,ok:false});report.failures.push({name,error:error.stack||String(error)});}
}
try{
 await check('Browser permission denial does not reserve a room or claim LIVE',async()=>{
  const backend=await createNativeTestBackend(origin),{context,page}=await contextFor(backend,{width:390,height:844});
  try{
   const cdp=await context.newCDPSession(page);
   for(const name of ['camera','microphone'])await cdp.send('Browser.setPermission',{permission:{name},setting:'denied',origin});
   await hostPanel(page);await stateIs(page,'error');
   assert.ok(await page.evaluate(()=>window.__captureCalls>0),'The browser must actually attempt capture');
   assert.equal(backend.state.sessions.size,0,'Permission denial must not create a stream reservation');
   assert.equal(backend.state.event.live_state,'off');
   assert.ok(await page.locator('#native-live-start').isDisabled());
   assert.equal(await page.locator('#native-live-preview').evaluate(video=>video.srcObject),null);
   await noOverflow(page);assert.deepEqual(page.nativePageErrors,[]);
   await page.screenshot({path:path.join(output,'native-live-permission-denied.png'),fullPage:true});
  }finally{await context.close();}
 });
 if(report.environmentBlocked){
  await check('Real SFU transport is permitted by the test browser',async()=>{throw Error(report.environmentBlocked.message);});
 }
 for(const [name,width,height,viewerWidth,viewerHeight]of(report.environmentBlocked?[]:[['desktop',1366,768,390,844],['mobile',390,844,320,740]])){
  await check(`Real SFU ${name}: Events UI publishes camera+microphone, viewer receives RTP, host stops`,async()=>{
   const backend=await createNativeTestBackend(origin),contexts=[];
   let hostPage,viewerPage;
   try{
    const host=await contextFor(backend,{width,height,capture:true});contexts.push(host.context);hostPage=host.page;
    await hostPanel(hostPage);await stateIs(hostPage,'preview');
    assert.equal(backend.state.event.live_state,'off','A local preview must not mark the event LIVE');
    assert.equal(backend.state.sessions.size,0,'Preview must not create a server room');
    assert.ok(await hostPage.evaluate(()=>window.__captureTracks.some(track=>track.kind==='audio'&&track.readyState==='live')&&window.__captureTracks.some(track=>track.kind==='video'&&track.readyState==='live')));
    await noOverflow(hostPage);
    backend.state.holdConfirm=true;
    await hostPage.locator('#native-live-start').click();
    await until(()=>typeof backend.state.releaseConfirm==='function','The production handler never verified the published tracks');
    assert.equal(await hostPage.locator('#native-live-panel').getAttribute('data-state'),'connecting','LIVE must wait for server confirmation');
    assert.equal(backend.state.event.live_state,'scheduled');
    backend.state.releaseConfirm();backend.state.holdConfirm=false;
    await stateIs(hostPage,'live');assert.equal(backend.state.event.live_state,'live');
    const viewer=await contextFor(backend,{width:viewerWidth,height:viewerHeight});contexts.push(viewer.context);viewerPage=viewer.page;
    await openEvents(viewerPage);await viewerPage.locator(`[data-event-id="${EVENT}"] [data-event-action="watch-native"]`).click();
    const remoteVideo=viewerPage.locator('#native-live-remote video');
    await remoteVideo.waitFor({state:'attached'});await remoteVideo.scrollIntoViewIfNeeded();
    await stateIs(viewerPage,'playing');await remoteVideo.waitFor({state:'visible'});
    await viewerPage.waitForFunction(()=>{const video=document.querySelector('#native-live-remote video');return video?.videoWidth>0&&video.readyState>=2;});
    const before=await remoteVideo.evaluate(video=>({frames:video.getVideoPlaybackQuality().totalVideoFrames,width:video.videoWidth,height:video.videoHeight}));
    await viewerPage.waitForTimeout(1600);
    const after=await remoteVideo.evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames);
    assert.ok(after>before.frames+2,`No advancing decoded video frames: ${before.frames} -> ${after}`);
    await viewerPage.waitForFunction(()=>document.querySelector('#native-live-remote audio')?.srcObject?.getAudioTracks().some(track=>track.readyState==='live'));
    assert.equal(await viewerPage.evaluate(()=>window.__captureCalls),0,'Watching must never request camera or microphone');
    await noOverflow(viewerPage);await noOverflow(hostPage);
    await hostPage.screenshot({path:path.join(output,`native-live-${name}-host.png`),fullPage:true});
    await viewerPage.screenshot({path:path.join(output,`native-live-${name}-viewer.png`),fullPage:true});
    for(const [selector,kind]of[['#native-live-mic','audio'],['#native-live-camera','video']]){
     await hostPage.locator(selector).click();
     await hostPage.waitForFunction(expected=>!window.__captureTracks.some(track=>track.kind===expected&&track.readyState==='live'&&track.enabled),kind);
     await hostPage.locator(selector).click();
     await hostPage.waitForFunction(expected=>window.__captureTracks.some(track=>track.kind===expected&&track.readyState==='live'&&track.enabled),kind);
    }
    await hostPage.locator('#native-live-flip').click();
    await hostPage.waitForFunction(()=>document.querySelector('#native-live-status')?.textContent.includes('Se cambió la cámara'));
    await stateIs(hostPage,'live');
    if(name==='desktop'){
     const response=await backend.invoke('view',{eventId:EVENT},null);assert.equal(response.status,200);const credentials=await response.json();
     const claims=JSON.parse(Buffer.from(credentials.token.split('.')[1],'base64url').toString());
     assert.equal(claims.video.canPublish,false,'Viewer credentials must deny publishing');assert.equal(claims.video.canSubscribe,true);assert.equal(claims.video.canPublishData,false);
     const attacker=await contextFor(backend,{capture:true});contexts.push(attacker.context);
     const denial=await attacker.page.evaluate(async credentials=>{
      const sdk=await import('/vendor/livekit-client.esm.js'),room=new sdk.Room();let track;
      try{
       await room.connect(credentials.url,credentials.token);track=await sdk.createLocalVideoTrack();
       try{await room.localParticipant.publishTrack(track);return{denied:false,canPublish:room.localParticipant.permissions?.canPublish};}
       catch(error){return{denied:true,message:error.message,canPublish:room.localParticipant.permissions?.canPublish};}
      }finally{track?.stop();await room.disconnect();}
     },credentials);
     assert.equal(denial.denied,true,'A real SFU viewer session must not publish');assert.equal(denial.canPublish,false);
    }
    await hostPage.locator('#native-live-stop').click();await stateIs(hostPage,'ended');
    await hostPage.waitForFunction(()=>window.__captureTracks.every(track=>track.readyState==='ended'));
    await stateIs(viewerPage,'ended');
    await until(()=>backend.state.event.live_state==='ended','Host stop did not finish the production backend session');
    assert.ok([...backend.state.sessions.values()].every(session=>session.state==='ended'));
    assert.equal(await viewerPage.evaluate(()=>window.__captureCalls),0);
    const stopped=await backend.invoke('view',{eventId:EVENT},null);assert.ok(stopped.status>=400,'A stopped stream must not issue new viewer credentials');
    assert.deepEqual(backend.state.unexpected,[]);assert.deepEqual(hostPage.nativePageErrors,[]);assert.deepEqual(viewerPage.nativePageErrors,[]);
    return{decodedFramesBefore:before.frames,decodedFramesAfter:after,videoWidth:before.width,videoHeight:before.height,audioTrackReceived:true,viewerCaptureRequests:0};
   }catch(error){
    if(backend.state.releaseConfirm)backend.state.releaseConfirm();
    const debug={hostState:hostPage?await hostPage.locator('#native-live-panel').getAttribute('data-state').catch(()=>null):null,hostStatus:hostPage?await hostPage.locator('#native-live-status').innerText().catch(()=>null):null,actions:backend.state.actions.map(item=>({action:item.action,transition:item.payload.p_action})),unexpected:backend.state.unexpected};
    error.message+='\nDiagnostic: '+JSON.stringify(debug);
    for(const [role,page]of[['host',hostPage],['viewer',viewerPage]])if(page)await page.screenshot({path:path.join(output,`native-live-${name}-${role}-failure.png`),fullPage:true}).catch(()=>{});
    throw error;
   }finally{for(const context of contexts.reverse())await context.close();}
  });
 }
}finally{
 await browser.close();try{report.serverLog=sfu.logs();}catch{}sfu.close();
 report.finished=new Date().toISOString();await writeFile('work/qa-native-live-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.failures.length)process.exitCode=1;
