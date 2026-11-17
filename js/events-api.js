const MIB = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MEDIA_TYPES = {
  'image/jpeg': {kind: 'photo', extensions: ['jpg', 'jpeg'], max: 10 * MIB},
  'image/png': {kind: 'photo', extensions: ['png'], max: 10 * MIB},
  'image/webp': {kind: 'photo', extensions: ['webp'], max: 10 * MIB},
  'image/gif': {kind: 'photo', extensions: ['gif'], max: 10 * MIB},
  'video/mp4': {kind: 'video', extensions: ['mp4'], max: 45 * MIB},
  'video/webm': {kind: 'video', extensions: ['webm'], max: 45 * MIB},
  'video/quicktime': {kind: 'video', extensions: ['mov'], max: 45 * MIB}
};
const CONFIG_ERROR = 'La sección de eventos aún no está conectada a Supabase. Falta una URL y una clave pública válidas.';

export function parseYouTubeUrl(value) {
  let url;
  try {url = new URL(typeof value === 'string' ? value.trim() : '');} catch {throw new Error('Introduce una URL HTTPS válida de YouTube.');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Usa un enlace HTTPS de YouTube sin credenciales ni puertos especiales.');
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  let id;
  if (['youtu.be', 'www.youtu.be'].includes(host) && parts.length === 1) id = parts[0];
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (parts.length === 1 && parts[0] === 'watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
    if (parts.length === 2 && ['live', 'embed'].includes(parts[0])) id = parts[1];
  }
  if (!id || !VIDEO_ID.test(id)) throw new Error('Usa un enlace de video o transmisión de YouTube: watch, live, embed o youtu.be.');
  return id;
}

function mediaInfo(file) {
  const mime = typeof file?.type === 'string' ? file.type.toLowerCase().trim() : '';
  const rule = MEDIA_TYPES[mime], extension = typeof file?.name === 'string' ? file.name.split('.').at(-1).toLowerCase() : '';
  if (!rule || !rule.extensions.includes(extension)) throw new Error('Formato no admitido. Usa fotos JPEG, PNG, WebP o GIF; videos MP4, WebM o MOV con su extensión correcta.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('Selecciona un archivo válido que no esté vacío.');
  if (file.size > rule.max) throw new Error(rule.kind === 'photo' ? 'La foto supera el límite de 10 MiB.' : 'El video supera el límite de 45 MiB.');
  return {...rule, mime, extension};
}
export function validateMediaFile(file) {return mediaInfo(file).kind;}

function publicKey(value) {
  if (typeof value !== 'string' || !value || /\s/.test(value) || value.startsWith('sb_secret_')) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return payload.role === 'anon';
  } catch {return false;}
}
export function isEventsConfigured(config) {
  try {
    const url = new URL(config?.url || '');
    return url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) && !url.username && !url.password && !url.port && ['/', ''].includes(url.pathname) && !url.search && !url.hash && publicKey(config?.publishableKey) && /^[A-Za-z0-9_-]{1,63}$/.test(config?.bucket || 'campus-events');
  } catch {return false;}
}
function idValue(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('El identificador del evento o archivo no es válido.');
  return id;
}
function eventFields(fields, creating = false) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Los datos del evento no son válidos.');
  const result = {};
  for (const [key, max] of [['title', 120], ['description', 4000], ['location', 160]]) {
    if (!Object.hasOwn(fields, key) && !(creating && key === 'title')) continue;
    if (typeof fields[key] !== 'string' || fields[key].length > max) throw new Error(`${({title: 'El título', description: 'La descripción', location: 'La ubicación'})[key]} debe tener como máximo ${max} caracteres.`);
    result[key] = fields[key].trim();
    if (key === 'title' && !result.title) throw new Error('Escribe el título del evento.');
  }
  if (Object.hasOwn(fields, 'starts_at')) {
    if (fields.starts_at === null || fields.starts_at === '') result.starts_at = null;
    else {
      if (typeof fields.starts_at !== 'string' || !Number.isFinite(Date.parse(fields.starts_at))) throw new Error('La fecha del evento no es válida.');
      result.starts_at = new Date(fields.starts_at).toISOString();
    }
  }
  for (const [key, allowed] of [['status', ['draft', 'published']], ['live_state', ['off', 'scheduled', 'live', 'ended']]]) {
    if (Object.hasOwn(fields, key)) {
      if (!allowed.includes(fields[key])) throw new Error('El estado del evento no es válido.');
      result[key] = fields[key];
    }
  }
  if (Object.hasOwn(fields, 'youtube_video_id')) {
    if (fields.youtube_video_id === null || fields.youtube_video_id === '') result.youtube_video_id = null;
    else if (typeof fields.youtube_video_id === 'string' && VIDEO_ID.test(fields.youtube_video_id)) result.youtube_video_id = fields.youtube_video_id;
    else throw new Error('El identificador de YouTube no es válido.');
  }
  if (creating) return {description: '', location: '', starts_at: null, live_state: 'off', youtube_video_id: null, ...result, status: 'draft'};
  if (!Object.keys(result).length) throw new Error('No hay cambios válidos para guardar.');
  return result;
}
function storagePath(row) {
  const eventId = idValue(row?.event_id), path = row?.storage_path;
  if (typeof path !== 'string' || !path.startsWith(eventId + '/') || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/i.test(path)) throw new Error('La ruta del archivo almacenado no es válida.');
  idValue(path.split('/')[1].split('.')[0]);
  return path;
}
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');

export function createEventsClient(config = {}) {
  const configured = isEventsConfigured(config), base = configured ? new URL(config.url).origin : '', bucket = config.bucket || 'campus-events';
  const key = config.publishableKey, sessionKey = `campus-events-session:${base}`;
  let refreshing = null;
  const assertConfigured = () => {if (!configured) throw new Error(CONFIG_ERROR);};
  function getSession() {
    if (!configured) return null;
    try {
      const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      if (!session || typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string' || !UUID.test(session.user?.id || '') || !Number.isFinite(session.expires_at)) return null;
      return session;
    } catch {return null;}
  }
  function saveSession(session) {
    try {
      if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
      else sessionStorage.removeItem(sessionKey);
    } catch {
      if (session) throw new Error('El navegador no permite guardar la sesión. Habilita el almacenamiento de sesión para administrar eventos.');
    }
  }
  function normalizeSession(data, previous = {}) {
    const user = data?.user || previous.user, expiresAt = Number(data?.expires_at) || Math.floor(Date.now() / 1000) + Number(data?.expires_in || 3600);
    if (typeof data?.access_token !== 'string' || typeof (data.refresh_token || previous.refresh_token) !== 'string' || !UUID.test(user?.id || '') || !Number.isFinite(expiresAt)) throw new Error('Supabase no devolvió una sesión válida.');
    return {access_token: data.access_token, refresh_token: data.refresh_token || previous.refresh_token, expires_at: expiresAt, token_type: 'bearer', user: {id: user.id, email: user.email || ''}};
  }
  async function request(path, {method = 'GET', token = null, body, file, headers: extraHeaders} = {}) {
    assertConfigured();
    const headers = {apikey: key, ...extraHeaders};
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (!key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {response = await fetch(base + path, {method, headers, credentials: 'omit', body: file !== undefined ? file : body === undefined ? undefined : JSON.stringify(body)});}
    catch {throw new Error('No se pudo conectar con el servicio de eventos. Revisa la conexión e inténtalo de nuevo.');}
    const text = await response.text();
    let data = null;
    try {data = text ? JSON.parse(text) : null;} catch {if (response.ok) throw new Error('El servicio de eventos devolvió una respuesta no válida.');}
    if (!response.ok) {
      const detail = data?.message || data?.error_description || data?.msg || (typeof data?.error === 'string' ? data.error : '');
      const message = response.status === 401 ? 'La sesión no es válida o ha caducado. Vuelve a iniciar sesión.' : response.status === 403 ? 'No tienes permisos para realizar esta acción.' : response.status === 413 ? 'El archivo supera el tamaño permitido por el almacenamiento.' : `No se pudo completar la operación${detail ? ': ' + String(detail).slice(0, 300) : '.'}`;
      const error = new Error(message); error.status = response.status; throw error;
    }
    return data;
  }
  async function session(required = false) {
    assertConfigured();
    const current = getSession();
    if (!current) {if (required) throw new Error('Inicia sesión con una cuenta administradora para continuar.'); return null;}
    if (current.expires_at > Date.now() / 1000 + 30) return current;
    if (!refreshing) refreshing = (async () => {
      try {
        const data = await request('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: current.refresh_token}});
        const next = normalizeSession(data, current); saveSession(next); return next;
      } catch (error) {saveSession(null); throw error;}
      finally {refreshing = null;}
    })();
    try {return await refreshing;} catch (error) {if (required) throw error; return null;}
  }
  async function adminWithSession(current) {
    if (!current) return false;
    const params = new URLSearchParams({select: 'user_id', user_id: `eq.${current.user.id}`, limit: '1'});
    const rows = await request('/rest/v1/event_admins?' + params, {token: current.access_token});
    return Array.isArray(rows) && rows.some(row => row.user_id === current.user.id);
  }
  async function isAdmin() {return adminWithSession(await session());}
  async function requireAdmin() {
    const current = await session(true);
    if (!await adminWithSession(current)) throw new Error('Esta cuenta no tiene permisos para administrar eventos.');
    return current;
  }
  async function signIn(email, password) {
    assertConfigured();
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || !password) throw new Error('Escribe un correo y una contraseña válidos.');
    const data = await request('/auth/v1/token?grant_type=password', {method: 'POST', body: {email: email.trim(), password}});
    const current = normalizeSession(data);
    try {
      if (!await adminWithSession(current)) throw new Error('Esta cuenta no tiene permisos para administrar eventos.');
      saveSession(current);
      return current;
    } catch (error) {
      saveSession(null);
      try {await request('/auth/v1/logout', {method: 'POST', token: current.access_token});} catch {}
      throw error;
    }
  }
  async function signOut() {
    assertConfigured();
    const current = getSession();
    try {if (current) await request('/auth/v1/logout', {method: 'POST', token: current.access_token});}
    catch (error) {if (![401, 403].includes(error.status)) throw error;}
    finally {saveSession(null);}
  }
  const eventRow = data => {if (!Array.isArray(data) || !data[0]?.id) throw new Error('El evento no se encontró o no se pudo guardar.'); return data[0];};
  async function listEvents({includeDrafts = false} = {}) {
    const current = includeDrafts ? await requireAdmin() : await session();
    const params = new URLSearchParams({select: '*,event_media(*)', order: 'starts_at.desc.nullslast,created_at.desc', limit: '100'});
    if (!includeDrafts) params.set('status', 'eq.published');
    const rows = await request('/rest/v1/campus_events?' + params, {token: current?.access_token});
    if (!Array.isArray(rows)) throw new Error('El servicio no devolvió una lista de eventos válida.');
    return rows.map(({event_media, ...event}) => ({...event, media: Array.isArray(event_media) ? event_media : []}));
  }
  async function createEvent(fields) {
    const body = eventFields(fields, true), current = await requireAdmin();
    return eventRow(await request('/rest/v1/campus_events', {method: 'POST', token: current.access_token, body, headers: {Prefer: 'return=representation'}}));
  }
  async function updateEvent(id, fields) {
    idValue(id);
    const body = eventFields(fields), current = await requireAdmin();
    return eventRow(await request('/rest/v1/campus_events?id=eq.' + id, {method: 'PATCH', token: current.access_token, body, headers: {Prefer: 'return=representation'}}));
  }
  async function deleteObjects(paths, current) {
    if (paths.length) await request('/storage/v1/object/' + encodeURIComponent(bucket), {method: 'DELETE', token: current.access_token, body: {prefixes: paths}});
  }
  async function deleteEvent(id) {
    idValue(id);
    const current = await requireAdmin();
    // Hide the event first: a partial cleanup must never leave public broken media.
    eventRow(await request('/rest/v1/campus_events?id=eq.' + id, {method: 'PATCH', token: current.access_token, body: {status: 'draft', live_state: 'off'}, headers: {Prefer: 'return=representation'}}));
    try {
      const params = new URLSearchParams({select: '*', event_id: 'eq.' + id});
      const rows = await request('/rest/v1/event_media?' + params, {token: current.access_token});
      if (!Array.isArray(rows)) throw new Error('No se pudo consultar el contenido del evento.');
      await deleteObjects(rows.map(row => {if (row.event_id !== id) throw new Error('Un archivo no corresponde al evento.'); return storagePath(row);}), current);
      await request('/rest/v1/campus_events?id=eq.' + id, {method: 'DELETE', token: current.access_token});
    } catch (error) {throw new Error('El evento quedó oculto, pero no se completó su eliminación. Puedes volver a intentarlo. ' + error.message);}
  }
  async function uploadMedia(eventId, file) {
    idValue(eventId);
    const info = mediaInfo(file), current = await requireAdmin();
    const path = `${eventId}/${crypto.randomUUID()}.${info.extension}`;
    await request(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {method: 'POST', token: current.access_token, file, headers: {'Content-Type': info.mime, 'x-upsert': 'false'}});
    try {
      const data = await request('/rest/v1/event_media', {method: 'POST', token: current.access_token, body: {event_id: eventId, kind: info.kind, storage_path: path, mime_type: info.mime, original_name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255)}, headers: {Prefer: 'return=representation'}});
      if (!Array.isArray(data) || !data[0]?.id) throw new Error('No se pudo guardar la información del archivo.');
      return data[0];
    } catch (error) {
      try {await deleteObjects([path], current);} catch {throw new Error('No se pudo guardar el archivo ni completar la limpieza de su carga. Revisa el almacenamiento antes de intentarlo de nuevo.');}
      throw error;
    }
  }
  async function removeMedia(row) {
    const path = storagePath(row); idValue(row.id);
    const current = await requireAdmin();
    await deleteObjects([path], current);
    await request('/rest/v1/event_media?id=eq.' + row.id, {method: 'DELETE', token: current.access_token});
  }
  async function mediaUrl(row) {
    const path = storagePath(row), current = await session();
    const result = await request(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(path)}`, {method: 'POST', token: current?.access_token, body: {expiresIn: 3600}});
    const signed = result?.signedURL || result?.signedUrl;
    if (typeof signed !== 'string') throw new Error('No se pudo generar un enlace temporal para el archivo.');
    const url = new URL(signed.startsWith('/object/') ? '/storage/v1' + signed : signed, base);
    if (url.protocol !== 'https:' || url.origin !== base || !url.pathname.startsWith('/storage/v1/object/sign/')) throw new Error('El servicio devolvió un enlace de archivo no válido.');
    return url.href;
  }
  return {configured, getSession, signIn, isAdmin, signOut, listEvents, createEvent, updateEvent, deleteEvent, uploadMedia, removeMedia, mediaUrl};
}
