import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createLiveHandler} from '../supabase/functions/_shared/campus-live.js';
const EVENT='11111111-1111-4111-8111-111111111111', OWNER='22222222-2222-4222-8222-222222222222', STREAM='33333333-3333-4333-8333-333333333333';
const ORIGIN='https://dmgproyectos01.github.io', USER_JWT='verified-user-jwt';
const env={LIVEKIT_URL:'wss://media.example.test',LIVEKIT_API_KEY:'test-api-key',LIVEKIT_API_SECRET:'test-only-provider-secret-with-enough-entropy',SUPABASE_URL:'https://project.example.test',SUPABASE_ANON_KEY:'public-anon',SUPABASE_SERVICE_ROLE_KEY:'test-only-private-service-role'};
const room=(stream=STREAM)=>`campus-${EVENT}-${stream}`;
const snapshot=()=>({event_id:EVENT,stream_id:STREAM,owner_id:OWNER,room_name:room(),state:'reserved',heartbeat_at:new Date().toISOString()});
const publisher=(sources=['CAMERA','MICROPHONE'],extra={})=>({identity:`publisher-${OWNER}-${STREAM}`,state:'ACTIVE',tracks:sources.map(source=>({source})),...extra});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function setup(overrides={}){
 const state={session:null,admin:true,verified:true,tracks:true,status:'published',native:true,liveState:'off',seen:null,deleted:false,calls:[],waits:[],...overrides};
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;state.calls.push({url:String(url),options,body});
  if(u.pathname==='/auth/v1/user'){
   assert.equal(options.headers.Authorization,`Bearer ${USER_JWT}`);
   return state.authFailure?json({message:'private auth details'},state.authFailure):json({id:OWNER,...(state.verified?{email_confirmed_at:'2026-01-01T00:00:00Z'}:{})});
  }
  if(u.pathname.endsWith('/is_event_admin')){assert.equal(options.headers.Authorization,`Bearer ${USER_JWT}`);assert.equal(options.headers.apikey,env.SUPABASE_ANON_KEY);return json(state.admin);}
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   assert.equal(options.headers.Authorization,`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);assert.equal(options.headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);
   switch(u.pathname.split('/').at(-1)){
    case'campus_live_reserve':
     if(state.reserveConflict)return json({message:'stream_active'},409);
     if(state.status!=='published'||!state.native)return json({message:'event_unavailable'},400);
     state.session=snapshot();state.liveState='scheduled';state.seen=null;return json({...state.session,stale_rooms:state.staleRooms||[]});
    case'campus_live_get_session':
     if(!state.session)return json({message:'stream_missing'},400);
     if(state.wrongOwner)return json({message:'stream_forbidden'},403);
     return json(state.session);
    case'campus_live_transition':
     if(body.p_action==='finish'){state.session.state='ended';state.liveState='ended';state.seen=null;return json(state.session);}
     state.session.state='live';state.session.heartbeat_at=new Date().toISOString();state.liveState='live';state.seen=state.session.heartbeat_at;return json(state.session);
    case'campus_live_get_view':
     if(!state.session)return json({message:'event_unavailable'},400);
     return json({...state.session,status:state.status,native_live_enabled:state.native,live_state:state.liveState,native_last_seen_at:state.seen});
   }
  }
  if(u.pathname.startsWith('/twirp/livekit.RoomService/')){
   const method=u.pathname.split('/').at(-1);
   if(method==='CreateRoom'){if(state.createFailure)return json({code:'internal',msg:'private provider details'},state.createFailure);state.deleted=false;return json({name:body.name});}
   if(method==='DeleteRoom'){if(state.deleteFailure)return json({code:'unavailable'},state.deleteFailure);if(state.deleted)return json({code:'not_found'},404);state.deleted=true;return json({});}
   if(method==='RemoveParticipant')return state.removeFailure?json({code:'unavailable'},503):json({});
   if(method==='ListParticipants'){
    if(state.listFailure)return json({code:'unavailable'},state.listFailure);
    if(state.listInvalid)return json({participants:null});
    const next=state.participantSnapshots?.shift();
    return json({participants:next??(state.deleted||!state.tracks?[]:[publisher()])});
   }
  }
  throw Error(`Unexpected mocked dependency ${url}`);
 };
 const handler=createLiveHandler({env:{...env,...state.env},fetchImpl,cryptoImpl:webcrypto,sleepImpl:async ms=>{state.waits.push(ms);await state.onWait?.(ms);}});
 const send=async(action='start',extra={},auth=true,headers={})=>{
  const response=await handler(new Request('https://edge.example.test/functions/v1/campus-live',{method:'POST',headers:{Origin:ORIGIN,'content-type':'application/json',...(auth?{Authorization:`Bearer ${USER_JWT}`} : {}),...headers},body:JSON.stringify({action,eventId:EVENT,...extra})}));
  return{response,data:await response.json()};
 };
 return{state,handler,send};
}
async function decodeAndVerify(token,secret=env.LIVEKIT_API_SECRET){
 const[h,p,s]=token.split('.');const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 assert.ok(await webcrypto.subtle.verify('HMAC',key,Buffer.from(s,'base64url'),new TextEncoder().encode(`${h}.${p}`)),'valid HS256 signature');
 assert.deepEqual(JSON.parse(Buffer.from(h,'base64url')),{alg:'HS256',typ:'JWT'});return JSON.parse(Buffer.from(p,'base64url'));
}
async function online(setupResult){const{send,state}=setupResult;await send();const result=await send('confirm',{streamId:STREAM});assert.equal(result.response.status,200);assert.equal(state.liveState,'live');}

test('Publisher requires a verified listed administrator, not just CORS or a public key',async()=>{
 for(const options of[{admin:false},{verified:false}]){const{send,state}=setup(options);const r=await send();assert.equal(r.response.status,403);assert.equal(state.session,null);assert.ok(!state.calls.some(c=>c.url.includes('/twirp/')));}
 const{send,state}=setup();assert.equal((await send('start',{},false)).response.status,401);assert.equal(state.calls.length,0);
});
test('Origin is strict and server secrets never appear in errors',async()=>{const{send,state}=setup();const r=await send('start',{},true,{Origin:'https://attacker.example'});assert.equal(r.response.status,403);assert.equal(r.response.headers.get('access-control-allow-origin'),null);assert.equal(state.calls.length,0);assert.ok(!JSON.stringify(r.data).includes(env.LIVEKIT_API_SECRET));});
test('UUIDs, unknown grants, room names and identities supplied by callers are rejected',async()=>{for(const extra of[{eventId:'../events'},{eventId:[EVENT]},{eventId:{value:EVENT}},{streamId:[STREAM]},{eventId:EVENT.toUpperCase().replace('1','Z')},{streamId:'invalid'},{roomName:'arbitrary'},{grant:{roomAdmin:true}},{identity:'publisher-other'}]){const{send,state}=setup();const r=await send('view',extra,false);assert.equal(r.response.status,400);assert.equal(state.calls.length,0);}});
test('Start creates a reserved room but never declares LIVE before media exists',async()=>{const{send,state}=setup();const r=await send();assert.equal(r.response.status,200);assert.equal(state.liveState,'scheduled');assert.equal(state.seen,null);assert.equal(r.data.roomName,room());assert.equal(r.data.streamId,STREAM);const p=await decodeAndVerify(r.data.token);assert.equal(p.iss,env.LIVEKIT_API_KEY);assert.equal(p.sub,`publisher-${OWNER}-${STREAM}`);assert.equal(p.exp-p.iat,120);assert.ok(p.exp>Math.floor(Date.now()/1000));assert.deepEqual(p.video,{roomJoin:true,room:room(),canPublish:true,canSubscribe:false,canPublishData:false,canPublishSources:['camera','microphone']});assert.equal(r.response.headers.get('cache-control'),'no-store');});
test('Confirm stops after six missing-media snapshots and never marks the session LIVE',async()=>{const s=setup({tracks:false});await s.send();const r=await s.send('confirm',{streamId:STREAM});assert.equal(r.response.status,409);assert.equal(r.data.error.code,'MEDIA_NOT_PUBLISHING');assert.equal(s.state.liveState,'scheduled');assert.equal(s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length,6);assert.deepEqual(s.state.waits,[300,300,300,300,300]);assert.ok(!s.state.calls.some(c=>c.body?.p_action==='confirm'));});
test('Confirm waits for eventual SFU publication and requires both tracks in one active owner snapshot',async()=>{
 const s=setup({participantSnapshots:[[],[publisher(['MICROPHONE'])],[publisher([1,2],{state:2})]]});
 s.state.onWait=()=>{assert.equal(s.state.liveState,'scheduled');assert.ok(!s.state.calls.some(c=>c.body?.p_action==='confirm'));};
 await s.send();const r=await s.send('confirm',{streamId:STREAM});assert.equal(r.response.status,200);assert.equal(r.data.live,true);assert.equal(s.state.liveState,'live');assert.deepEqual(s.state.waits,[300,300]);
 const media=s.state.calls.filter(c=>c.url.endsWith('/ListParticipants'));assert.equal(media.length,3);assert.ok(s.state.calls.indexOf(media.at(-1))<s.state.calls.findIndex(c=>c.body?.p_action==='confirm'));
});
test('Confirm never combines partial snapshots or accepts another publisher or an inactive participant',async()=>{
 const invalid=[[publisher(['CAMERA'])],[publisher(['MICROPHONE'])],[publisher(undefined,{identity:'publisher-other'})],[publisher(undefined,{state:'JOINING'})],[publisher(['SCREEN_SHARE','SCREEN_SHARE_AUDIO'])],[publisher(['MICROPHONE'])]];
 const s=setup({participantSnapshots:invalid});await s.send();const r=await s.send('confirm',{streamId:STREAM});assert.equal(r.response.status,409);assert.equal(s.state.liveState,'scheduled');assert.ok(!s.state.calls.some(c=>c.body?.p_action==='confirm'));assert.equal(s.state.waits.length,5);
});
test('Confirm does not retry provider failures or malformed participant snapshots',async()=>{
 for(const fault of[{listFailure:503},{listInvalid:true}]){const s=setup(fault);await s.send();const r=await s.send('confirm',{streamId:STREAM});assert.equal(r.response.status,502);assert.equal(s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length,1);assert.deepEqual(s.state.waits,[]);assert.equal(s.state.liveState,'scheduled');assert.ok(!s.state.calls.some(c=>c.body?.p_action==='confirm'));}
});
test('Confirmed media becomes LIVE and a heartbeat rechecks the media server',async()=>{const s=setup();await online(s);const before=s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length;const r=await s.send('heartbeat',{streamId:STREAM});assert.equal(r.response.status,200);assert.equal(r.data.live,true);assert.equal(s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length,before+1);s.state.tracks=false;assert.equal((await s.send('heartbeat',{streamId:STREAM})).response.status,409);});
test('Heartbeat and view keep a single strict media snapshot without confirmation retries',async()=>{
 for(const action of['heartbeat','view']){const s=setup();await online(s);const before=s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length;s.state.participantSnapshots=[[publisher(['MICROPHONE'])],[publisher()]];const r=await s.send(action,action==='heartbeat'?{streamId:STREAM}:{},action!=='view');assert.equal(r.response.status,409,action);assert.equal(s.state.calls.filter(c=>c.url.endsWith('/ListParticipants')).length,before+1);assert.deepEqual(s.state.waits,[]);assert.equal(s.state.participantSnapshots.length,1);}
});
test('Anonymous viewers receive subscribe-only tokens for an actual live room',async()=>{const s=setup();await online(s);const r=await s.send('view',{},false);assert.equal(r.response.status,200);const p=await decodeAndVerify(r.data.token);assert.match(p.sub,/^viewer-[0-9a-f-]{36}$/);assert.deepEqual(p.video,{roomJoin:true,room:room(),canSubscribe:true,canPublish:false,canPublishData:false});assert.equal(p.exp-p.iat,120);assert.ok(!JSON.stringify(r.data).includes(env.SUPABASE_SERVICE_ROLE_KEY));});
test('Draft, disabled, old, ended and media-absent sessions do not receive viewer credentials',async()=>{for(const bad of['draft','disabled','stale','ended','absent']){const s=setup();await online(s);if(bad==='draft')s.state.status='draft';if(bad==='disabled')s.state.native=false;if(bad==='stale')s.state.seen=new Date(Date.now()-76000).toISOString();if(bad==='ended')s.state.liveState='ended';if(bad==='absent')s.state.tracks=false;const r=await s.send('view',{},false);assert.equal(r.response.status,409,bad);assert.equal(r.data.token,undefined);}});
test('A parallel reserve conflict cannot mint a second publishing token',async()=>{const s=setup({reserveConflict:true});const r=await s.send();assert.equal(r.response.status,409);assert.equal(r.data.token,undefined);assert.ok(!s.state.calls.some(c=>c.url.endsWith('/CreateRoom')));});
test('Stale rooms are deleted before the fresh nonce room is created',async()=>{const stale=`campus-${EVENT}-44444444-4444-4444-8444-444444444444`;const s=setup({staleRooms:[stale]});assert.equal((await s.send()).response.status,200);const calls=s.state.calls.filter(c=>c.url.includes('/twirp/'));assert.ok(calls[0].url.endsWith('/DeleteRoom'));assert.equal(calls[0].body.room,stale);assert.ok(calls[1].url.endsWith('/CreateRoom'));});
test('Stopping deletes the actual SFU room and is idempotent',async()=>{const s=setup();await online(s);for(let i=0;i<2;i++){const r=await s.send('stop',{streamId:STREAM});assert.equal(r.response.status,200);assert.equal(r.data.ended,true);}assert.equal(s.state.liveState,'ended');const calls=s.state.calls;const deleteIndex=calls.findIndex(c=>c.url.endsWith('/DeleteRoom'));const finishIndex=calls.findIndex(c=>c.body?.p_action==='finish');assert.ok(deleteIndex<finishIndex);assert.equal((await s.send('view',{},false)).response.status,409);});
test('A failed provider stop does not falsely report ended or finish the database session',async()=>{const s=setup();await online(s);s.state.deleteFailure=503;const r=await s.send('stop',{streamId:STREAM});assert.equal(r.response.status,502);assert.equal(s.state.liveState,'live');assert.equal(r.data.ended,undefined);assert.ok(!s.state.calls.some(c=>c.body?.p_action==='finish'));});
test('An administrator cannot stop another owner session',async()=>{const s=setup();await online(s);s.state.wrongOwner=true;const r=await s.send('stop',{streamId:STREAM});assert.equal(r.response.status,403);assert.ok(!s.state.calls.some(c=>c.url.endsWith('/DeleteRoom')));});
test('CreateRoom failure compensates the reservation and never returns a client JWT',async()=>{const s=setup({createFailure:404});const r=await s.send();assert.equal(r.response.status,502);assert.equal(r.data.token,undefined);assert.equal(s.state.liveState,'ended');});
test('Server RPC tokens are short-lived and scoped to the required RoomService permission',async()=>{const s=setup();await online(s);for(const c of s.state.calls.filter(c=>c.url.includes('/twirp/'))){const p=await decodeAndVerify(c.options.headers.Authorization.slice(7));assert.equal(p.exp-p.iat,60);if(c.url.endsWith('/ListParticipants'))assert.deepEqual(p.video,{roomAdmin:true,room:room()});else assert.deepEqual(p.video,{roomCreate:true,room:room()});assert.equal(p.video.roomJoin,undefined);}});
test('Local plain WebSocket media is unavailable unless the explicit test flag is enabled',async()=>{const s=setup({env:{LIVEKIT_URL:'ws://127.0.0.1:17880'}});assert.equal((await s.send()).response.status,503);const local=setup({env:{LIVEKIT_URL:'ws://127.0.0.1:17880',SUPABASE_URL:'http://127.0.0.1:12345',LIVEKIT_ALLOW_LOCALHOST:'true',TEST_ORIGIN:'http://127.0.0.1:3000'}});const r=await local.send('start',{},true,{Origin:'http://127.0.0.1:3000'});assert.equal(r.response.status,200);assert.equal(r.data.url,'ws://127.0.0.1:17880');});
test('Preflight grants only the fixed production origin; unsupported HTTP methods are denied',async()=>{const s=setup();const pre=await s.handler(new Request('https://edge.example.test',{method:'OPTIONS',headers:{Origin:ORIGIN}}));assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),ORIGIN);const get=await s.handler(new Request('https://edge.example.test',{headers:{Origin:ORIGIN}}));assert.equal(get.status,405);assert.equal(s.state.calls.length,0);});
test('Oversized requests are rejected before Auth, database or provider calls',async()=>{const s=setup();const r=await s.handler(new Request('https://edge.example.test',{method:'POST',headers:{Origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({action:'start',eventId:EVENT,padding:'x'.repeat(5000)})}));assert.equal(r.status,413);assert.equal(s.state.calls.length,0);});

test('Cloud stop revokes publisher admission at an explicit cutoff before deleting the room',async()=>{const s=setup({env:{LIVEKIT_URL:'wss://campus.livekit.cloud'}});await online(s);const r=await s.send('stop',{streamId:STREAM});assert.equal(r.response.status,200);const remove=s.state.calls.find(c=>c.url.endsWith('/RemoveParticipant'));assert.ok(remove);assert.equal(remove.body.identity,`publisher-${OWNER}-${STREAM}`);assert.ok(Math.abs(remove.body.revoke_token_ts-Math.floor(Date.now()/1000))<5);const claims=await decodeAndVerify(remove.options.headers.Authorization.slice(7));assert.deepEqual(claims.video,{roomAdmin:true,room:room()});assert.ok(s.state.calls.indexOf(remove)<s.state.calls.findIndex(c=>c.url.endsWith('/DeleteRoom')));});
test('A Cloud revocation failure still closes actual media and remains a reported retryable failure',async()=>{const s=setup({env:{LIVEKIT_URL:'wss://campus.livekit.cloud'}});await online(s);s.state.removeFailure=true;const r=await s.send('stop',{streamId:STREAM});assert.equal(r.response.status,502);assert.equal(s.state.deleted,true);assert.ok(!s.state.calls.some(c=>c.body?.p_action==='finish'));});
