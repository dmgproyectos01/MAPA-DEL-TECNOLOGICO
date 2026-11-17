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
const previewOnly=process.env.CAMPUS_NATIVE_PREVIEW_ONLY==='1';
const sfu=previewOnly?null:await ensureLocalSFU();
if(sfu)report.server={version:sfu.version,image:sfu.image,release:sfu.release};
report.previewOnly=previewOnly;
if(previewOnly){report.transport='Preview-only diagnostics; no RTC/SFU connections attempted';report.capture='Chromium fake hardware source; genuine getUserMedia only; no PeerConnection/RTP/SFU';}
const executablePath=process.env.CAMPUS_CHROMIUM_PATH||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(runtimePlaywright)&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
let managedRTCPolicy=null;
if(executablePath==='/usr/bin/chromium'&&existsSync('/etc/chromium/policies/managed/misc.json')){
 try{managedRTCPolicy=JSON.parse(await readFile('/etc/chromium/policies/managed/misc.json','utf8')).WebRtcIPHandling||null;}catch{}
}
if(managedRTCPolicy==='disable_non_proxied_udp')report.environmentBlocked={source:'/etc/chromium/policies/managed/misc.json',policy:'WebRtcIPHandling',value:managedRTCPolicy,message:'The managed local browser prohibits direct RTC transport. No policy was changed. Real transport assertions require the normal fresh CI browser.'};
// Use the full Chromium browser's new headless mode for native media coverage.
// The default headless shell is a separate binary with different capabilities.
// https://playwright.dev/docs/browsers#chromium-new-headless-mode
const browser=await chromium.launch({...(executablePath?{executablePath}:{channel:'chromium'}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--allow-loopback-in-peer-connection']});
report.browser={version:browser.version(),selection:executablePath?'explicit executable':'full Chromium new headless',channel:executablePath?null:'chromium'};
try{
 const cdp=await browser.newBrowserCDPSession();const command=await cdp.send('Browser.getBrowserCommandLine');
 report.browser.binary=path.basename(command.arguments[0]);
 report.browser.fakeDeviceCapture=command.arguments.includes('--use-fake-device-for-media-stream');
 await cdp.detach();
}catch{report.browser.commandLineAvailable=false;}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(callback,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await callback())return;await pause(100);}throw Error(message);}
async function contextFor(backend,{width=1366,height=768,capture=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700,permissions:capture?['camera','microphone']:[]});
 await context.addInitScript(()=>{
  window.__captureCalls=0;window.__captureTracks=[];window.__captureErrors=[];
  window.__nativeRTCPeers=new Set();
  // Passive observation only: the constructor, SDP, transport, media and method
  // return values remain native. This gives getStats() access to real SFU RTP.
  const setRemoteDescription=RTCPeerConnection.prototype.setRemoteDescription;
  RTCPeerConnection.prototype.setRemoteDescription=function(...args){
   window.__nativeRTCPeers.add(this);return Reflect.apply(setRemoteDescription,this,args);
  };
  const original=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if(original)navigator.mediaDevices.getUserMedia=async constraints=>{
   window.__captureCalls++;
   try{const stream=await original(constraints);window.__captureTracks.push(...stream.getTracks());return stream;}
   catch(error){window.__captureErrors.push({name:error.name,message:error.message});throw error;}
  };
 });
 const page=await context.newPage();page.nativePageErrors=[];page.nativeConsole=[];
 page.on('pageerror',error=>page.nativePageErrors.push(safeText(error.message)));
 page.on('console',message=>{if(['warning','error'].includes(message.type()))page.nativeConsole.push({type:message.type(),text:safeText(message.text())});});
 await backend.install(page);await page.goto(target,{waitUntil:'networkidle'});
 return{context,page};
}
function safeText(value){return String(value).replace(/((?:https?|wss?):\/\/[^\s?\"'#)]+)[?#][^\s\"')]+/g,'$1?[redacted query]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted token]');}
async function inboundAudioRTP(page){
 return page.evaluate(async()=>{
  const rows=[];let index=0;
  for(const pc of window.__nativeRTCPeers||[]){
   const peer=index++;
   try{
    const stats=await pc.getStats();
    for(const value of stats.values())if(value.type==='inbound-rtp'&&(value.kind==='audio'||value.mediaType==='audio'))rows.push({id:`${peer}:${value.id}`,bytesReceived:Number(value.bytesReceived||0),packetsReceived:Number(value.packetsReceived||0),totalSamplesReceived:value.totalSamplesReceived??null,totalAudioEnergy:value.totalAudioEnergy??null});
   }catch{}
  }
  return rows;
 });
}
async function diagnostics(page,{captureCause=false}={}){
 if(!page)return null;
 const detail=await page.evaluate(async()=>({state:document.querySelector('#native-live-panel')?.dataset.state,status:document.querySelector('#native-live-status')?.textContent,captureCalls:window.__captureCalls,captureErrors:window.__captureErrors,rtcPeerConnections:window.__nativeRTCPeers?.size,tracks:window.__captureTracks?.map(track=>({kind:track.kind,state:track.readyState,enabled:track.enabled})),permissions:await Promise.all(['camera','microphone'].map(async name=>({name,state:(await navigator.permissions.query({name})).state})))})).catch(error=>({readError:error.message}));
 if(captureCause)detail.directPrepare=await page.evaluate(async()=>{
  const {createNativeLive}=await import('/js/native-live.js');const video=document.createElement('video');document.body.append(video);
  const live=createNativeLive({request:async()=>{throw Error('Unexpected backend request from preview diagnostic');}});
  try{await live.prepare(video);return{state:live.getState().state};}
  catch(error){return{name:error.name,message:error.message,cause:error.cause?{name:error.cause.name,message:error.cause.message,stack:error.cause.stack}:null};}
  finally{await live.destroy().catch(()=>{});video.remove();}
 }).catch(error=>({diagnosticError:error.message}));
 detail.console=page.nativeConsole;detail.pageErrors=page.nativePageErrors;detail.inboundAudioRTP=await inboundAudioRTP(page).catch(()=>[]);
 return JSON.parse(JSON.stringify(detail,(key,value)=>typeof value==='string'?safeText(value):value));
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
async function stateIs(page,state){
 await page.waitForFunction(expected=>{const actual=document.querySelector('#native-live-panel')?.dataset.state;return actual===expected||actual==='error'||actual==='ended'&&expected!=='preview';},state,{timeout:20000});
 const actual=await page.locator('#native-live-panel').getAttribute('data-state');
 if(actual!==state)throw Error(`Expected native state ${state}; received ${actual}: ${await page.locator('#native-live-status').innerText()}`);
}
async function noOverflow(page){
 const layout=await page.locator('#events-dialog').evaluate(dialog=>({page:document.documentElement.scrollWidth>innerWidth+1,dialog:dialog.scrollWidth>dialog.clientWidth+1,controls:[...dialog.querySelectorAll('#native-live-panel button,video')].filter(el=>el.getClientRects().length).some(el=>{const r=el.getBoundingClientRect(),d=dialog.getBoundingClientRect();return r.left<d.left-1||r.right>d.right+1;})}));
 assert.deepEqual(layout,{page:false,dialog:false,controls:false},'Native live controls and player must fit the viewport');
 assert.equal(await page.locator('#events-dialog iframe,#event-youtube').count(),0);
 assert.equal(await page.locator('#events-dialog a[href]').count(),0,'Camera streaming must stay inside the app');
}
async function check(name,callback){
 try{const detail=await callback();report.checks.push({name,ok:true,...(detail?{detail}:{})});}
 catch(error){report.checks.push({name,ok:false});report.failures.push({name,error:error.stack||String(error),...(error.nativeDiagnostics?{diagnostics:error.nativeDiagnostics}:{})});}
}
try{
 await check('Browser permission denial does not reserve a room or claim LIVE',async()=>{
  const backend=await createNativeTestBackend(origin),{context,page}=await contextFor(backend,{width:390,height:844});
  try{
   const cdp=await context.newCDPSession(page);
   const {targetInfo}=await cdp.send('Target.getTargetInfo');
   assert.ok(targetInfo.browserContextId,'Permission denial must target only its disposable test context');
   for(const name of ['camera','microphone'])await cdp.send('Browser.setPermission',{permission:{name},setting:'denied',origin,browserContextId:targetInfo.browserContextId});
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
 if(previewOnly){
  for(const[name,width,height]of[['desktop',1366,768],['mobile',390,844]])await check(`Fresh ${name} Events UI camera preview after scoped permission denial`,async()=>{
   const backend=await createNativeTestBackend(origin),{context,page}=await contextFor(backend,{width,height,capture:true});
   try{
    await hostPanel(page);await page.waitForFunction(()=>['preview','error'].includes(document.querySelector('#native-live-panel')?.dataset.state));
    const detail=await diagnostics(page);
    if(detail.state!=='preview'){const error=Error('Camera preview failed');error.nativeDiagnostics=await diagnostics(page,{captureCause:true});throw error;}
    assert.equal(backend.state.sessions.size,0,'Preview-only diagnostics must not request any SFU session');
    assert.ok(detail.tracks.some(track=>track.kind==='audio'&&track.state==='live')&&detail.tracks.some(track=>track.kind==='video'&&track.state==='live'));
    await page.locator('#native-live-stop').click();await stateIs(page,'ended');
    await page.waitForFunction(()=>window.__captureTracks.every(track=>track.readyState==='ended'));
    return detail;
   }finally{await context.close();}
  });
 }else if(report.environmentBlocked){
  await check('Real SFU transport is permitted by the test browser',async()=>{throw Error(report.environmentBlocked.message);});
 }
 for(const [name,width,height,viewerWidth,viewerHeight]of(previewOnly||report.environmentBlocked?[]:[['desktop',1366,768,390,844],['mobile',390,844,320,740]])){
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
    await until(()=>typeof backend.state.releaseConfirm==='function'||backend.state.nativeResponses.some(response=>response.action==='confirm'&&response.status>=400),'The production handler never verified the published tracks');
    if(typeof backend.state.releaseConfirm!=='function')throw Error(`Server confirmation failed: ${backend.state.nativeResponses.find(response=>response.action==='confirm'&&response.status>=400)?.errorCode||'unknown error'}`);
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
    await viewerPage.waitForFunction(()=>document.querySelector('#native-live-remote audio')?.srcObject?.getAudioTracks().some(track=>track.readyState==='live'));
    await until(async()=>(await inboundAudioRTP(viewerPage)).some(row=>row.bytesReceived>0&&row.packetsReceived>0),'The viewer did not receive real inbound audio RTP');
    const audioBefore=await inboundAudioRTP(viewerPage);
    const before=await remoteVideo.evaluate(video=>({frames:video.getVideoPlaybackQuality().totalVideoFrames,width:video.videoWidth,height:video.videoHeight}));
    await viewerPage.waitForTimeout(1600);
    const after=await remoteVideo.evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames),audioAfter=await inboundAudioRTP(viewerPage);
    assert.ok(after>before.frames+2,`No advancing decoded video frames: ${before.frames} -> ${after}`);
    assert.ok(audioAfter.some(row=>{const previous=audioBefore.find(before=>before.id===row.id);return previous&&row.bytesReceived>previous.bytesReceived&&row.packetsReceived>previous.packetsReceived;}),`Inbound audio RTP did not advance: ${JSON.stringify({before:audioBefore,after:audioAfter})}`);
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
    return{decodedFramesBefore:before.frames,decodedFramesAfter:after,videoWidth:before.width,videoHeight:before.height,audioTrackReceived:true,audioRTP:{before:audioBefore,after:audioAfter},viewerCaptureRequests:0,providerSnapshots:backend.state.providerSnapshots,nativeResponses:backend.state.nativeResponses};
   }catch(error){
    if(backend.state.releaseConfirm)backend.state.releaseConfirm();
    const debug={host:await diagnostics(hostPage,{captureCause:backend.state.sessions.size===0}),viewer:await diagnostics(viewerPage),actions:backend.state.actions.map(item=>({action:item.action,transition:item.payload.p_action})),unexpected:backend.state.unexpected,providerSnapshots:backend.state.providerSnapshots,nativeResponses:backend.state.nativeResponses};
    error.nativeDiagnostics=debug;
    error.message+='\nDiagnostic: '+JSON.stringify(debug);
    for(const [role,page]of[['host',hostPage],['viewer',viewerPage]])if(page)await page.screenshot({path:path.join(output,`native-live-${name}-${role}-failure.png`),fullPage:true}).catch(()=>{});
    throw error;
   }finally{for(const context of contexts.reverse())await context.close();}
  });
 }
}finally{
 await browser.close();if(sfu){try{report.serverLog=sfu.logs();}catch{}sfu.close();}
 report.finished=new Date().toISOString();await writeFile('work/qa-native-live-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(report.failures.length)process.exitCode=1;
