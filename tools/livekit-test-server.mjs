import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';

export const SFU_VERSION='1.13.11';
export const SFU_IMAGE='livekit/livekit-server@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20';
export const SFU_RELEASE='https://github.com/livekit/livekit/releases/tag/v1.13.11';
export const SFU_URL='ws://127.0.0.1:17880';
export const SFU_KEY='campus-test-key';
// Local disposable test credentials. They are never used by the published site.
export const SFU_SECRET='campus-local-test-secret-32-characters';
export const ADMIN='10000000-0000-4000-8000-000000000001';
export const VISITOR='10000000-0000-4000-8000-000000000002';
export const EVENT='20000000-0000-4000-8000-000000000001';
const MOCK_BASE='http://127.0.0.1:18991';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

export async function ensureLocalSFU(){
 let created=false,container='campus-native-live-qa';
 try{
  const response=await fetch('http://127.0.0.1:17880/');
  if(!response.ok||await response.text()!=='OK')throw Error('Unexpected local service');
  const image=execFileSync('docker',['inspect','--format','{{.Config.Image}}',container],{encoding:'utf8'}).trim();
  if(image!==SFU_IMAGE)throw Error('The existing local SFU is not the pinned test image');
 }catch{
  container=`campus-native-live-${process.pid}`;
  execFileSync('docker',['pull',SFU_IMAGE],{stdio:'pipe'});
  execFileSync('docker',['run','-d','--rm','--name',container,'--network','host','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only',SFU_IMAGE,'--dev','--bind','127.0.0.1','--node-ip','127.0.0.1','--keys',`${SFU_KEY}: ${SFU_SECRET}`,'--config-body','port: 17880\nrtc:\n  tcp_port: 17881\n  port_range_start: 17900\n  port_range_end: 17910\n  use_external_ip: false\n  enable_loopback_candidate: true\n  use_mdns: true\n'],{stdio:'pipe'});
  created=true;
  let ready=false;
  for(let i=0;i<60;i++){
   try{const response=await fetch('http://127.0.0.1:17880/');if(response.ok&&await response.text()==='OK'){ready=true;break;}}catch{}
   await pause(250);
  }
  if(!ready){execFileSync('docker',['stop',container],{stdio:'pipe'});throw Error('The pinned LiveKit SFU did not start');}
 }
 const version=execFileSync('docker',['exec',container,'/livekit-server','--version'],{encoding:'utf8'}).trim();
 if(!version.includes(SFU_VERSION))throw Error(`Unexpected SFU version: ${version}`);
 return{container,image:SFU_IMAGE,version,release:SFU_RELEASE,url:SFU_URL,close(){if(created)execFileSync('docker',['stop',container],{stdio:'pipe'});},logs(){
   const run=spawnSync('docker',['logs','--tail','500',container],{encoding:'utf8'});
   return (String(run.stdout||'')+String(run.stderr||'')).split('\n').flatMap(line=>{
    const parts=line.split('\t');if(parts.length<6||!/peer connection state|track published|participant active|participant closing|starting LiveKit|API RoomService/.test(parts[4]))return[];
    let data={};try{data=JSON.parse(parts[5]);}catch{}
    return[{time:parts[0],level:parts[1],message:parts[4],...Object.fromEntries(['state','transport','source','kind','trackID'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]))}];
   });
  }};
}

export async function createNativeTestBackend(origin){
 const {createLiveHandler}=await import('../supabase/functions/_shared/campus-live.js');
 const state={event:{id:EVENT,title:'Transmisión RTC local',description:'Prueba de cámara y micrófono mediante el SFU real.',location:'Aula Magna · H',starts_at:'2026-11-17T17:00:00Z',status:'published',live_state:'off',native_live_enabled:true,created_at:'2026-11-17T10:00:00Z',media:[]},sessions:new Map(),requests:[],unexpected:[],actions:[],providerSnapshots:[],nativeResponses:[],holdConfirm:false,releaseConfirm:null};
 let currentStream=null;
 const snapshot=()=>currentStream?state.sessions.get(currentStream):null;
 async function supabaseFetch(input,init={}){
  const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url),pathname=url.pathname,method=request.method,auth=request.headers.get('authorization')||'';
  if(!request.url.startsWith(MOCK_BASE)){
   const response=await fetch(request);
   if(url.origin===SFU_URL.replace(/^ws/,'http')&&pathname.startsWith('/twirp/livekit.RoomService/')){
    let body={};try{body=await response.clone().json();}catch{}
    const current=snapshot();
    // Record only provider state needed to diagnose confirmation races. Never
    // retain Authorization, access tokens, TURN credentials or full SDP.
    state.providerSnapshots.push({time:new Date().toISOString(),method:pathname.split('/').at(-1),status:response.status,errorCode:body.code||null,participants:Array.isArray(body.participants)?body.participants.map(participant=>({expectedPublisher:participant.identity===`publisher-${current?.owner_id}-${current?.stream_id}`,state:participant.state,tracks:(participant.tracks||[]).map(track=>({kind:track.type??null,source:track.source??null,muted:track.muted??false}))})):null});
   }
   return response;
  }
  state.requests.push({path:pathname,method});
  let payload;try{payload=await request.json();}catch{payload={};}
  if(pathname==='/auth/v1/user'){
   if(!['Bearer test-admin-token','Bearer test-visitor-token'].includes(auth))return json({message:'Unauthorized'},401);
   return json({id:auth==='Bearer test-admin-token'?ADMIN:VISITOR,email_confirmed_at:'2026-11-17T00:00:00Z'});
  }
  if(pathname==='/rest/v1/rpc/is_event_admin')return json(auth==='Bearer test-admin-token');
  if(pathname.startsWith('/rest/v1/rpc/campus_live_')){
   if(auth!=='Bearer mockservice')return json({message:'Service role required'},403);
   const action=pathname.split('/').at(-1);state.actions.push({action,payload});
   if(payload.p_event_id!==EVENT)return json({message:'Event not found'},404);
   if(action==='campus_live_reserve'){
    const streamId=randomUUID(),row={event_id:EVENT,stream_id:streamId,owner_id:payload.p_owner_id,room_name:`campus-${EVENT}-${streamId}`,state:'reserved',heartbeat_at:new Date().toISOString(),stale_rooms:[]};
    currentStream=streamId;state.sessions.set(streamId,row);state.event.live_state='scheduled';state.event.native_stream_id=streamId;state.event.native_last_seen_at=null;return json(row);
   }
   if(action==='campus_live_get_session'){
    const row=payload.p_stream_id?state.sessions.get(payload.p_stream_id):snapshot();
    return row&&row.owner_id===payload.p_owner_id?json(row):json({message:'Session not found'},404);
   }
   if(action==='campus_live_transition'){
    const row=state.sessions.get(payload.p_stream_id);
    if(!row||row.owner_id!==payload.p_owner_id)return json({message:'Session not found'},404);
    if(payload.p_action==='confirm'&&state.holdConfirm)await new Promise(resolve=>{state.releaseConfirm=resolve;});
    if(payload.p_action==='finish'){row.state='ended';state.event.live_state='ended';state.event.native_last_seen_at=null;}
    else {row.state='live';state.event.live_state='live';state.event.native_stream_id=row.stream_id;state.event.native_last_seen_at=new Date().toISOString();}
    row.heartbeat_at=new Date().toISOString();return json(row);
   }
   if(action==='campus_live_get_view'){
    const row=snapshot();
    if(!row||row.state!=='live')return json({message:'event_unavailable'},400);
    return json({...row,status:state.event.status,native_live_enabled:true,live_state:state.event.live_state,native_last_seen_at:row.heartbeat_at});
   }
  }
  state.unexpected.push({method,path:pathname});return json({message:'Unexpected mocked Supabase request'},500);
 }
 const env={SUPABASE_URL:MOCK_BASE,SUPABASE_ANON_KEY:'mockanon',SUPABASE_SERVICE_ROLE_KEY:'mockservice',LIVEKIT_URL:SFU_URL,LIVEKIT_API_KEY:SFU_KEY,LIVEKIT_API_SECRET:SFU_SECRET,LIVEKIT_ALLOW_LOCALHOST:'true',TEST_ORIGIN:origin};
 const handler=createLiveHandler({env,fetchImpl:supabaseFetch,cryptoImpl:webcrypto});
 async function observeNativeResponse(action,response){
  let body={};try{body=await response.clone().json();}catch{}
  state.nativeResponses.push({time:new Date().toISOString(),action,status:response.status,errorCode:body.error?.code||null,errorMessage:body.error?.message||null,live:body.live===true,ended:body.ended===true});
  return response;
 }
 async function invoke(action,payload={},token='test-admin-token'){
  const response=await handler(new Request(origin+'/functions/v1/campus-live',{method:'POST',headers:{'content-type':'application/json',origin,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...payload})}));
  return observeNativeResponse(action,response);
 }
 async function install(page){
  await page.route('**/data/events-config.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'https://example.supabase.co',publishableKey:'sb_publishable_native_test_only',bucket:'campus-events',nativeLive:{enabled:true,functionName:'campus-live'}})}));
  await page.route('https://example.supabase.co/**',async route=>{
   const request=route.request(),url=new URL(request.url()),method=request.method(),auth=request.headers().authorization||'';
   const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
   if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'apikey,authorization,content-type,prefer','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'}});
   if(url.pathname==='/auth/v1/token')return respond({access_token:'test-admin-token',refresh_token:'test-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:ADMIN,email:'admin@example.test'}});
   if(url.pathname==='/auth/v1/logout')return respond({});
   if(url.pathname==='/rest/v1/event_admins')return respond(auth==='Bearer test-admin-token'?[{user_id:ADMIN}]:[]);
   if(url.pathname==='/rest/v1/campus_events'&&method==='GET')return respond([{...state.event,event_media:[]}]);
   if(url.pathname==='/functions/v1/campus-live'){
    const response=await handler(new Request(origin+url.pathname,{method,headers:{...request.headers(),origin},body:method==='GET'?undefined:request.postData()}));
    let action;try{action=request.postDataJSON().action;}catch{}
    await observeNativeResponse(action,response);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   state.unexpected.push({method,path:url.pathname});return respond({message:'Unexpected browser backend request'},500);
  });
 }
 return{state,install,invoke,handler,supabaseFetch};
}
