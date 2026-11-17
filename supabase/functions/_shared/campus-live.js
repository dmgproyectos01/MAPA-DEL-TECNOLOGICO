// Server-only token authority. No provider secret may be sent to a browser.
// Protocol references are recorded in backend/NATIVE-LIVE.md.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROD_ORIGIN = 'https://dmgproyectos01.github.io';
const TTL_SECONDS = 120;
const LEASE_MS = 75_000;
const ACTIONS = new Set(['start', 'confirm', 'heartbeat', 'stop', 'view']);
class LiveError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new LiveError(status, code, message); };
const isLocal = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
const roomFor = (eventId, streamId) => `campus-${eventId}-${streamId}`;
const publisherFor = s => `publisher-${s.owner_id}-${s.stream_id}`;
const seconds = () => Math.floor(Date.now() / 1000);

export function createLiveHandler({ env, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  const read = key => typeof env?.get === 'function' ? env.get(key) : env?.[key];
  const localFlag = read('LIVEKIT_ALLOW_LOCALHOST') === 'true';
  let configuration;
  function config() {
    if (configuration) return configuration;
    try {
      const url = new URL(read('LIVEKIT_URL'));
      const local = localFlag && isLocal(url.hostname);
      if ((!local && url.protocol !== 'wss:') || (local && !['ws:', 'wss:'].includes(url.protocol)) ||
          (!local && isLocal(url.hostname)) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error();
      const supabase = new URL(read('SUPABASE_URL'));
      if ((supabase.protocol !== 'https:' && !(local && isLocal(supabase.hostname) && supabase.protocol === 'http:')) ||
          supabase.username || supabase.password || supabase.search || supabase.hash || !['', '/'].includes(supabase.pathname)) throw Error();
      let origin = PROD_ORIGIN;
      if (local && read('TEST_ORIGIN')) {
        const testOrigin = new URL(read('TEST_ORIGIN'));
        if (!isLocal(testOrigin.hostname) || !['http:', 'https:'].includes(testOrigin.protocol) || testOrigin.origin !== read('TEST_ORIGIN')) throw Error();
        origin = testOrigin.origin;
      }
      const apiKey = read('LIVEKIT_API_KEY'), secret = read('LIVEKIT_API_SECRET'), anon = read('SUPABASE_ANON_KEY'), service = read('SUPABASE_SERVICE_ROLE_KEY');
      if (![apiKey, secret, anon, service].every(v => typeof v === 'string' && v.length > 0) || !cryptoImpl?.subtle || !cryptoImpl.randomUUID) throw Error();
      configuration = { cloudRevocation: !local && (url.hostname.endsWith('.livekit.cloud') || read('LIVEKIT_CLOUD_REVOCATION') === 'true'), url: url.origin.replace(/^http/, 'ws'), http: url.origin.replace(/^ws/, 'http'), supabase: supabase.origin, origin, apiKey, secret, anon, service };
      return configuration;
    } catch { fail(503, 'NATIVE_LIVE_NOT_CONFIGURED', 'La transmisión todavía no tiene un servidor configurado.'); }
  }
  function cors(origin) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Max-Age': '300', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  }
  function response(status, value, headers = {}) {
    return new Response(value === null ? null : JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
  }
  async function request(url, options) {
    try { return await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { fail(502, 'LIVE_DEPENDENCY_UNAVAILABLE', 'No se pudo contactar al servidor de transmisión. Intenta de nuevo.'); }
  }
  async function json(res) { try { return await res.json(); } catch { return null; } }
  async function rpc(name, params) {
    const c = config();
    const res = await request(`${c.supabase}/rest/v1/rpc/${name}`, { method: 'POST',
      headers: { apikey: c.service, Authorization: `Bearer ${c.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
    const data = await json(res);
    if (!res.ok) {
      const code = data?.message;
      if (code === 'stream_active') fail(409, 'STREAM_ACTIVE', 'Ya hay una transmisión iniciada para este evento.');
      if (code === 'stream_forbidden') fail(403, 'STREAM_FORBIDDEN', 'Esta transmisión pertenece a otro administrador.');
      if (code === 'stream_stale' || code === 'invalid_transition') fail(409, 'STREAM_STALE', 'La sesión venció o ya terminó. Inicia una nueva transmisión.');
      if (code === 'event_unavailable' || code === 'stream_missing') fail(404, 'STREAM_UNAVAILABLE', 'No hay una transmisión disponible para este evento.');
      fail(502, 'LIVE_DATABASE_UNAVAILABLE', 'No se pudo actualizar el estado de la transmisión.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(502, 'LIVE_DATABASE_INVALID', 'El servidor devolvió una sesión inválida.');
    return data;
  }
  async function administrator(req) {
    const c = config(), header = req.headers.get('Authorization') || '';
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match || match[1] === c.anon || match[1] === c.service) fail(401, 'AUTH_REQUIRED', 'Inicia sesión como administrador para transmitir.');
    const token = match[1];
    const res = await request(`${c.supabase}/auth/v1/user`, { method: 'GET', headers: { apikey: c.anon, Authorization: `Bearer ${token}` } });
    if (!res.ok) fail(res.status >= 500 ? 502 : 401, 'AUTH_REQUIRED', 'La sesión de administrador no es válida.');
    const user = await json(res);
    if (!UUID.test(user?.id || '') || user.is_anonymous || !(user.email_confirmed_at || user.phone_confirmed_at || user.confirmed_at)) fail(403, 'ADMIN_REQUIRED', 'La cuenta debe estar verificada y autorizada para transmitir.');
    const check = await request(`${c.supabase}/rest/v1/rpc/is_event_admin`, { method: 'POST',
      headers: { apikey: c.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
    if (!check.ok) fail(502, 'AUTH_UNAVAILABLE', 'No se pudieron comprobar los permisos de transmisión.');
    if (await json(check) !== true) fail(403, 'ADMIN_REQUIRED', 'Tu cuenta no tiene permisos para transmitir.');
    return user.id;
  }
  const encode = data => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    let string = ''; for (const byte of bytes) string += String.fromCharCode(byte);
    return btoa(string).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  async function jwt(subject, grant, ttl) {
    const c = config(), now = seconds();
    const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = encode(JSON.stringify({ iss: c.apiKey, sub: subject, iat: now, nbf: now - 5, exp: now + ttl, video: grant }));
    const key = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(c.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await cryptoImpl.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${encode(signature)}`;
  }
  async function roomService(method, room, create = false, extra = {}) {
    const c = config();
    const grant = create ? { roomCreate: true, room } : { roomAdmin: true, room };
    const token = await jwt('campus-live-service', grant, 60);
    const body = method === 'CreateRoom' ? { name: room, empty_timeout: 75, departure_timeout: 20 } : { room, ...extra };
    const res = await request(`${c.http}/twirp/livekit.RoomService/${method}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await json(res);
    if (!res.ok) {
      if (res.status === 404 || data?.code === 'not_found') {
        if (method === 'DeleteRoom' || method === 'RemoveParticipant') return {};
        if (method === 'ListParticipants') return { participants: [] };
      }
      fail(502, 'MEDIA_SERVER_UNAVAILABLE', 'El servidor no pudo atender la transmisión.');
    }
    if (method === 'CreateRoom' && data?.name !== room) fail(502, 'MEDIA_SERVER_INVALID', 'El servidor no confirmó la sala de transmisión.');
    if (method === 'ListParticipants' && !Array.isArray(data?.participants)) fail(502, 'MEDIA_SERVER_INVALID', 'El servidor devolvió un estado de emisión inválido.');
    return data || {};
  }
  function session(data, eventId, ownerId) {
    if (data.event_id !== eventId || typeof data.stream_id !== 'string' || typeof data.owner_id !== 'string' || !UUID.test(data.stream_id) || !UUID.test(data.owner_id) ||
        (ownerId && data.owner_id !== ownerId) || data.room_name !== roomFor(eventId, data.stream_id) || !['reserved', 'live', 'ended'].includes(data.state)) {
      fail(502, 'LIVE_SESSION_INVALID', 'El servidor devolvió una sesión inválida.');
    }
    return data;
  }
  function recent(value) { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && timestamp > Date.now() - LEASE_MS && timestamp <= Date.now() + 5000; }
  async function publisherPresent(s) {
    const data = await roomService('ListParticipants', s.room_name);
    const publisher = Array.isArray(data.participants) && data.participants.find(p => p.identity === publisherFor(s) && (p.state === 2 || p.state === 'ACTIVE'));
    const tracks = Array.isArray(publisher?.tracks) ? publisher.tracks : [];
    return tracks.some(t => t.source === 1 || String(t.source).toUpperCase() === 'CAMERA') &&
      tracks.some(t => t.source === 2 || String(t.source).toUpperCase() === 'MICROPHONE');
  }
  async function closeRoom(room, publisherIdentity) {
    let revokeError;
    if (config().cloudRevocation) {
      try {
        const data = await roomService('ListParticipants', room);
        const identities = new Set(data.participants.map(p => p.identity).filter(i => typeof i === 'string' && i.length));
        if (publisherIdentity) identities.add(publisherIdentity);
        // An explicit cutoff revokes even a recently refreshed Cloud token.
        for (const identity of identities) await roomService('RemoveParticipant', room, false, { identity, revoke_token_ts: seconds() });
      } catch (error) { revokeError = error; }
    }
    // Close media even if Cloud revocation failed; report failure so cleanup is
    // retryable instead of pretending that all cached credentials were revoked.
    await roomService('DeleteRoom', room, true);
    if (revokeError) throw revokeError;
  }
  const params = (eventId, streamId, ownerId) => ({ p_event_id: eventId, p_stream_id: streamId, p_owner_id: ownerId });
  async function finish(s) { return rpc('campus_live_transition', { ...params(s.event_id, s.stream_id, s.owner_id), p_action: 'finish' }); }

  return async req => {
    let headers = {};
    try {
      const c = config();
      if (req.headers.get('Origin') !== c.origin) return response(403, { error: { code: 'ORIGIN_DENIED', message: 'Origen no permitido.' } }, { 'Vary': 'Origin', 'Cache-Control': 'no-store' });
      headers = cors(c.origin);
      if (req.method === 'OPTIONS') return response(204, null, headers);
      if (req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'Usa POST para esta operación.');
      if (!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) fail(415, 'JSON_REQUIRED', 'La solicitud debe ser JSON.');
      if (Number(req.headers.get('Content-Length') || 0) > 4096) fail(413, 'BODY_TOO_LARGE', 'Solicitud demasiado grande.');
      const reader = req.body?.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
      if (reader) { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 4096) { await reader.cancel().catch(() => {}); fail(413, 'BODY_TOO_LARGE', 'Solicitud demasiado grande.'); }
        text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      let body; try { body = JSON.parse(text); } catch { fail(400, 'INVALID_BODY', 'Solicitud inválida.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', 'eventId', 'streamId'].includes(key)) ||
          !ACTIONS.has(body.action) || typeof body.eventId !== 'string' || !UUID.test(body.eventId) || (body.streamId != null && (typeof body.streamId !== 'string' || !UUID.test(body.streamId)))) fail(400, 'INVALID_BODY', 'Identificador u operación inválidos.');
      const { action, eventId } = body;
      if (action === 'view') {
        const s = session(await rpc('campus_live_get_view', { p_event_id: eventId }), eventId);
        if (s.status !== 'published' || s.native_live_enabled !== true || s.live_state !== 'live' || s.state !== 'live' ||
            !recent(s.native_last_seen_at) || !recent(s.heartbeat_at) || !await publisherPresent(s)) fail(409, 'STREAM_OFFLINE', 'La transmisión no está emitiendo en este momento.');
        const token = await jwt(`viewer-${cryptoImpl.randomUUID()}`, { roomJoin: true, room: s.room_name, canSubscribe: true, canPublish: false, canPublishData: false }, TTL_SECONDS);
        return response(200, { url: c.url, token, streamId: s.stream_id, roomName: s.room_name }, headers);
      }
      const ownerId = await administrator(req);
      if (action === 'start') {
        if (body.streamId != null) fail(400, 'INVALID_BODY', 'Una transmisión nueva no admite una sesión anterior.');
        const s = session(await rpc('campus_live_reserve', { p_event_id: eventId, p_owner_id: ownerId }), eventId, ownerId);
        if (s.state !== 'reserved') fail(502, 'LIVE_SESSION_INVALID', 'El servidor devolvió una sesión inválida.');
        try {
          for (const room of s.stale_rooms || []) {
            if (typeof room !== 'string' || !room.startsWith(`campus-${eventId}-`) || !UUID.test(room.slice(`campus-${eventId}-`.length))) fail(502, 'LIVE_SESSION_INVALID', 'El servidor devolvió una sesión inválida.');
            const previous = Array.isArray(s.stale_sessions) && s.stale_sessions.find(item => item?.room_name === room);
            if (config().cloudRevocation && !previous) fail(502, 'LIVE_SESSION_INVALID', 'Faltan los datos de cierre de una sesión anterior.');
            const previousSession = previous ? session(previous, eventId) : null;
            await closeRoom(room, previousSession ? publisherFor(previousSession) : undefined);
          }
          await roomService('CreateRoom', s.room_name, true);
        } catch (error) { try { await roomService('DeleteRoom', s.room_name, true); await finish(s); } catch {} throw error; }
        const token = await jwt(publisherFor(s), { roomJoin: true, room: s.room_name, canPublish: true,
          canSubscribe: false, canPublishData: false, canPublishSources: ['camera', 'microphone'] }, TTL_SECONDS);
        return response(200, { url: c.url, token, streamId: s.stream_id, roomName: s.room_name }, headers);
      }
      if ((action === 'confirm' || action === 'heartbeat') && !body.streamId) fail(400, 'STREAM_ID_REQUIRED', 'Falta la sesión de transmisión.');
      const s = session(await rpc('campus_live_get_session', params(eventId, body.streamId || null, ownerId)), eventId, ownerId);
      if (action === 'stop') {
        // DeleteRoom must actually succeed before reporting an ended broadcast.
        // A 404 is idempotent; other provider errors keep the session retryable.
        await closeRoom(s.room_name, publisherFor(s));
        await finish(s);
        return response(200, { ended: true, streamId: s.stream_id }, headers);
      }
      if (s.state === 'ended' || !recent(s.heartbeat_at)) fail(409, 'STREAM_STALE', 'La sesión venció o ya terminó.');
      if (!await publisherPresent(s)) fail(409, 'MEDIA_NOT_PUBLISHING', 'La cámara y el micrófono todavía no están publicando en el servidor.');
      const result = session(await rpc('campus_live_transition', { ...params(eventId, s.stream_id, ownerId), p_action: action }), eventId, ownerId);
      if (result.state !== 'live') fail(502, 'LIVE_SESSION_INVALID', 'El servidor no confirmó la emisión.');
      return response(200, { live: true, streamId: s.stream_id }, headers);
    } catch (error) {
      if (!headers['Access-Control-Allow-Origin'] && req.headers.get('Origin') === PROD_ORIGIN) headers = cors(PROD_ORIGIN);
      const known = error instanceof LiveError;
      return response(known ? error.status : 500, { error: { code: known ? error.code : 'LIVE_INTERNAL_ERROR',
        message: known ? error.message : 'No se pudo completar la transmisión.' } }, headers);
    }
  };
}
