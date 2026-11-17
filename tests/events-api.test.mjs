import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeUrl, validateMediaFile, isEventsConfigured, createEventsClient} from '../js/events-api.js';

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const MEDIA = '33333333-3333-4333-8333-333333333333';
const OBJECT = '44444444-4444-4444-8444-444444444444';
const CONFIG = {url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example', bucket: 'campus-events'};
const ID = 'dQw4w9WgXcQ';
const row = {id: MEDIA, event_id: EVENT, kind: 'photo', storage_path: `${EVENT}/${OBJECT}.png`, mime_type: 'image/png', original_name: 'foto.png'};
const photo = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'foto.png', {type: 'image/png'});
const json = (value, status = 200) => new Response(value === null ? null : JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const authData = (access = 'admin-access', expires = 3600) => ({access_token: access, refresh_token: 'admin-refresh', expires_in: expires, user: {id: USER, email: 'admin@example.com'}});
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString('base64url')}.c2lnbmF0dXJl`;

async function withClient(handler, run, {admin = true, config = CONFIG} = {}) {
  const previousFetch = globalThis.fetch, previousStorage = globalThis.sessionStorage;
  const memory = new Map(), requests = [];
  globalThis.sessionStorage = {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key)};
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value), body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    const request = {url, options, body}; requests.push(request);
    const response = await handler?.(request);
    if (response) return response;
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return json(authData());
    if (url.pathname === '/rest/v1/event_admins') return json(admin ? [{user_id: USER}] : []);
    if (url.pathname === '/auth/v1/logout') return json(null, 204);
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url.pathname}`);
  };
  try {await run({client: createEventsClient(config), requests, memory});}
  finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage;
  }
}
const login = client => client.signIn('admin@example.com', 'a-real-password');

test('El directo sin configurar no solicita permisos ni contacta al servidor', async () => {
  await withClient(null, async ({client, requests}) => {
    assert.equal(client.nativeLiveConfigured, false);
    await assert.rejects(client.nativeLiveRequest('start', {eventId:EVENT}), /todavía no están habilitados/);
    assert.equal(requests.length, 0);
  });
});

test('Ver un directo es público; iniciarlo exige una sesión administradora', async () => {
  const config = {...CONFIG, nativeLive:{enabled:true, functionName:'campus-live'}};
  await withClient(({url, body, options}) => {
    if (url.pathname === '/functions/v1/campus-live') {
      assert.equal(body.eventId, EVENT);
      if (body.action === 'view') assert.equal(options.headers.Authorization, undefined);
      else assert.equal(options.headers.Authorization, 'Bearer admin-access');
      return json({url:'wss://example.livekit.cloud', token:'temporary-room-token', streamId:OBJECT, roomName:'event-room'});
    }
  }, async ({client, requests}) => {
    assert.equal(client.nativeLiveConfigured, true);
    await client.nativeLiveRequest('view', {eventId:EVENT});
    await assert.rejects(client.nativeLiveRequest('start', {eventId:EVENT}), /Inicia sesión/);
    await login(client);
    await client.nativeLiveRequest('start', {eventId:EVENT});
    const count = requests.length;
    await assert.rejects(client.nativeLiveRequest('arbitrary', {eventId:EVENT}), /acción/);
    await assert.rejects(client.nativeLiveRequest('stop', {eventId:EVENT, streamId:'wrong'}), /identificador/);
    assert.equal(requests.length, count);
  }, {config});
});

test('Eliminar un evento activo finaliza su directo antes de ocultarlo y limpiar archivos', async () => {
  const order = [], config = {...CONFIG,nativeLive:{enabled:true,functionName:'campus-live'}};
  await withClient(({url, options, body}) => {
    if (url.pathname === '/functions/v1/campus-live') {order.push('stop'); assert.equal(body.streamId, OBJECT); return json({ended:true});}
    if (url.pathname === '/rest/v1/campus_events' && !options.method) return json([{id:EVENT,native_stream_id:OBJECT,live_state:'live'}]);
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'GET') return json([{id:EVENT,native_stream_id:OBJECT,live_state:'live'}]);
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'PATCH') {order.push('hide'); assert.deepEqual(body,{status:'draft'}); return json([{id:EVENT,...body}]);}
    if (url.pathname === '/rest/v1/event_media') return json([]);
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'DELETE') {order.push('delete'); return json(null,204);}
  }, async ({client}) => {await login(client); await client.deleteEvent(EVENT); assert.deepEqual(order,['stop','hide','delete']);}, {config});
});

for (const url of [`https://youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&t=10`, `https://m.youtube.com/live/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://youtu.be/${ID}?si=abc`]) {
  test(`Extrae únicamente el ID de ${url}`, () => assert.equal(parseYouTubeUrl(url), ID));
}

test('Rechaza URLs peligrosas, hosts parecidos y páginas sin un video válido', () => {
  for (const value of ['javascript:alert(1)', `http://youtube.com/watch?v=${ID}`, `https://youtube.com.evil.example/watch?v=${ID}`, `https://evil.example/watch?v=${ID}`, `https://youtube.com@evil.example/watch?v=${ID}`, `https://youtube.com:444/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&v=abcdefghijk`, 'https://youtube.com/watch?v=abc', 'https://youtube.com/channel/abcdefghijk', ID]) assert.throws(() => parseYouTubeUrl(value), /YouTube|HTTPS/);
});

test('Valida MIME, extensión y límites reales de fotos y videos sin admitir SVG o HTML', () => {
  for (const [name, type] of [['foto.jpg', 'image/jpeg'], ['foto.JPEG', 'image/jpeg'], ['foto.png', 'image/png'], ['foto.webp', 'image/webp'], ['foto.gif', 'image/gif']]) assert.equal(validateMediaFile({name, type, size: 10 * 1024 * 1024}), 'photo');
  for (const [name, type] of [['video.mp4', 'video/mp4'], ['video.webm', 'video/webm'], ['video.MOV', 'video/quicktime']]) assert.equal(validateMediaFile({name, type, size: 45 * 1024 * 1024}), 'video');
  for (const file of [{name: 'icon.svg', type: 'image/svg+xml', size: 10}, {name: 'pagina.html', type: 'text/html', size: 10}, {name: 'falso.png', type: 'text/html', size: 10}, {name: 'falso.svg', type: 'image/png', size: 10}, {name: 'vacio.jpg', type: 'image/jpeg', size: 0}, {name: 'foto.jpg', type: '', size: 10}, {name: 'foto.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1}, {name: 'video.mp4', type: 'video/mp4', size: 45 * 1024 * 1024 + 1}]) assert.throws(() => validateMediaFile(file), /Formato|válido|límite/);
});

test('Solo acepta URL de Supabase y claves que pueden exponerse en el navegador', () => {
  assert.equal(isEventsConfigured(CONFIG), true);
  assert.equal(isEventsConfigured({...CONFIG, publishableKey: jwt('anon')}), true);
  for (const config of [{}, {...CONFIG, url: 'http://example.supabase.co'}, {...CONFIG, url: 'https://example.supabase.co.evil.test'}, {...CONFIG, url: 'https://user:password@example.supabase.co'}, {...CONFIG, publishableKey: 'sb_secret_private'}, {...CONFIG, publishableKey: jwt('service_role')}, {...CONFIG, bucket: '../other'}]) assert.equal(isEventsConfigured(config), false);
});

test('Sin configuración no simula eventos ni realiza escrituras locales o remotas', async () => {
  await withClient(null, async ({client, requests, memory}) => {
    assert.equal(client.configured, false);
    assert.equal(client.getSession(), null);
    await assert.rejects(client.listEvents(), /conectada a Supabase/);
    await assert.rejects(client.createEvent({title: 'Ceremonia'}), /conectada a Supabase/);
    await assert.rejects(login(client), /conectada a Supabase/);
    assert.equal(requests.length, 0);
    assert.equal(memory.size, 0);
  }, {config: {}});
});

test('El visitante lee solo publicados con su relación media y clave pública sin JWT falso', async () => {
  await withClient(({url, options}) => {
    if (url.pathname === '/rest/v1/campus_events') {
      assert.equal(url.searchParams.get('status'), 'eq.published');
      assert.equal(url.searchParams.get('select'), '*,event_media(*)');
      assert.equal(options.headers.apikey, CONFIG.publishableKey);
      assert.equal(options.headers.Authorization, undefined);
      return json([{id: EVENT, title: 'Conferencia', status: 'published', event_media: [row]}]);
    }
  }, async ({client, requests}) => {
    assert.equal(await client.isAdmin(), false);
    const [event] = await client.listEvents();
    assert.equal(event.media[0].storage_path, row.storage_path);
    assert.equal(Object.hasOwn(event, 'event_media'), false);
    await assert.rejects(client.listEvents({includeDrafts: true}), /Inicia sesión/);
    assert.equal(requests.length, 1);
  });
});

test('Las claves anon JWT antiguas se envían como apikey y bearer únicamente cuando corresponde', async () => {
  const key = jwt('anon');
  await withClient(({url, options}) => {
    if (url.pathname === '/rest/v1/campus_events') {assert.equal(options.headers.apikey, key); assert.equal(options.headers.Authorization, `Bearer ${key}`); return json([]);}
  }, async ({client}) => assert.deepEqual(await client.listEvents(), []), {config: {...CONFIG, publishableKey: key}});
});

test('Inicia sesión solo después de verificar event_admins y nunca guarda la contraseña', async () => {
  await withClient(null, async ({client, requests, memory}) => {
    const session = await login(client);
    assert.equal(session.user.id, USER);
    assert.equal(client.getSession().access_token, 'admin-access');
    const check = requests.find(request => request.url.pathname === '/rest/v1/event_admins');
    assert.equal(check.url.searchParams.get('user_id'), `eq.${USER}`);
    assert.equal(check.options.headers.Authorization, 'Bearer admin-access');
    assert.equal(memory.size, 1);
    assert.ok(![...memory.values()].join('').includes('a-real-password'));
    await client.signOut();
    assert.equal(client.getSession(), null);
    assert.equal(memory.size, 0);
  });
});

test('Una cuenta autenticada sin permiso administrador no conserva sesión ni puede escribir', async () => {
  await withClient(null, async ({client, requests, memory}) => {
    await assert.rejects(login(client), /no tiene permisos/);
    assert.equal(client.getSession(), null);
    assert.equal(memory.size, 0);
    await assert.rejects(client.createEvent({title: 'No autorizado'}), /Inicia sesión/);
    assert.ok(requests.some(request => request.url.pathname === '/auth/v1/logout'));
    assert.ok(!requests.some(request => request.url.pathname === '/rest/v1/campus_events'));
  }, {admin: false});
});

test('Actualiza una sesión caducada antes de usar REST y guarda los nuevos tokens', async () => {
  await withClient(({url, body}) => {
    if (url.searchParams.get('grant_type') === 'refresh_token') {assert.deepEqual(body, {refresh_token: 'admin-refresh'}); return json(authData('renewed-access'));}
  }, async ({client, memory, requests}) => {
    await login(client);
    const [key, serialized] = [...memory.entries()][0];
    memory.set(key, JSON.stringify({...JSON.parse(serialized), expires_at: 1}));
    assert.equal(await client.isAdmin(), true);
    assert.equal(client.getSession().access_token, 'renewed-access');
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer renewed-access');
  });
});

test('Un refresh rechazado borra la sesión y no intenta crear un evento', async () => {
  await withClient(({url}) => url.searchParams.get('grant_type') === 'refresh_token' ? json({message: 'Invalid refresh token'}, 401) : undefined, async ({client, memory, requests}) => {
    await login(client);
    const [key, serialized] = [...memory.entries()][0]; memory.set(key, JSON.stringify({...JSON.parse(serialized), expires_at: 1}));
    await assert.rejects(client.createEvent({title: 'Sesión caducada'}), /sesión/);
    assert.equal(client.getSession(), null);
    assert.ok(!requests.some(request => request.url.pathname === '/rest/v1/campus_events'));
  });
});

test('Crear siempre produce borrador y actualizar solo envía campos válidos', async () => {
  await withClient(({url, options, body}) => {
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'POST') {assert.equal(body.status, 'draft'); assert.equal(body.created_by, undefined); return json([{id: EVENT, ...body}]);}
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'PATCH') {assert.equal(body.status, 'published'); assert.equal(body.youtube_video_id, ID); return json([{id: EVENT, ...body}]);}
  }, async ({client, requests}) => {
    await login(client);
    const event = await client.createEvent({title: ' Conferencia ', status: 'published', created_by: 'forged-user'});
    assert.equal(event.title, 'Conferencia'); assert.equal(event.status, 'draft');
    await client.updateEvent(EVENT, {status: 'published', youtube_video_id: ID});
    const before = requests.length;
    await assert.rejects(client.updateEvent(EVENT, {title: 'x'.repeat(121)}), /120 caracteres/);
    await assert.rejects(client.updateEvent(EVENT, {starts_at: 'not-a-date'}), /fecha/);
    await assert.rejects(client.updateEvent(EVENT, {youtube_video_id: 'javascript:'}), /YouTube/);
    assert.equal(requests.length, before);
  });
});

test('Sube bytes reales a Storage y registra su metadata sin usar un archivo base64 local', async () => {
  const file = photo(); let uploaded;
  await withClient(({url, options, body}) => {
    if (url.pathname.startsWith('/storage/v1/object/') && options.method === 'POST') {uploaded = url.pathname.split('/campus-events/')[1]; assert.equal(body, file); assert.equal(options.headers['Content-Type'], 'image/png'); assert.equal(options.headers['x-upsert'], 'false'); return json({Key: 'campus-events/' + uploaded});}
    if (url.pathname === '/rest/v1/event_media' && options.method === 'POST') {assert.equal(body.storage_path, uploaded); assert.equal(body.kind, 'photo'); assert.equal(body.mime_type, 'image/png'); assert.equal(body.original_name, 'foto.png'); return json([{id: MEDIA, ...body}]);}
  }, async ({client}) => {
    await login(client);
    const media = await client.uploadMedia(EVENT, file);
    assert.equal(media.id, MEDIA);
    assert.ok(media.storage_path.startsWith(EVENT + '/'));
    assert.match(media.storage_path, /\.png$/);
  });
});

test('Si falla el registro de metadata, elimina el objeto que acaba de subir', async () => {
  let uploaded, removed;
  await withClient(({url, options, body}) => {
    if (url.pathname.startsWith('/storage/v1/object/') && options.method === 'POST') {uploaded = url.pathname.split('/campus-events/')[1]; return json({Key: uploaded});}
    if (url.pathname === '/rest/v1/event_media' && options.method === 'POST') return json({message: 'Permission denied'}, 403);
    if (url.pathname === '/storage/v1/object/campus-events' && options.method === 'DELETE') {removed = body.prefixes; return json([]);}
  }, async ({client}) => {
    await login(client);
    await assert.rejects(client.uploadMedia(EVENT, photo()), /permisos/);
    assert.deepEqual(removed, [uploaded]);
  });
});

test('Genera un enlace firmado de una hora para el bucket privado', async () => {
  await withClient(({url, options, body}) => {
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {assert.deepEqual(body, {expiresIn: 3600}); assert.equal(options.headers.Authorization, undefined); return json({signedURL: `/object/sign/campus-events/${row.storage_path}?token=temporary`});}
  }, async ({client}) => assert.equal(await client.mediaUrl(row), `${CONFIG.url}/storage/v1/object/sign/campus-events/${row.storage_path}?token=temporary`));
});

test('Borrar un evento primero lo oculta y después limpia Storage y la fila', async () => {
  const operations = [];
  await withClient(({url, options, body}) => {
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'PATCH') {operations.push('hide'); assert.deepEqual(body, {status: 'draft'}); return json([{id: EVENT, ...body}]);}
    if (url.pathname === '/rest/v1/event_media') {operations.push('list-media'); return json([row]);}
    if (url.pathname === '/storage/v1/object/campus-events') {operations.push('remove-objects'); assert.deepEqual(body.prefixes, [row.storage_path]); return json([]);}
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'DELETE') {operations.push('delete-event'); return json(null, 204);}
  }, async ({client}) => {await login(client); await client.deleteEvent(EVENT); assert.deepEqual(operations, ['hide', 'list-media', 'remove-objects', 'delete-event']);});
});

test('Si Storage no puede limpiarse, el evento permanece oculto y no se borra su fila', async () => {
  await withClient(({url, options}) => {
    if (url.pathname === '/rest/v1/campus_events' && options.method === 'PATCH') return json([{id: EVENT, status: 'draft'}]);
    if (url.pathname === '/rest/v1/event_media') return json([row]);
    if (url.pathname === '/storage/v1/object/campus-events') return json({message: 'Storage unavailable'}, 503);
  }, async ({client, requests}) => {
    await login(client);
    await assert.rejects(client.deleteEvent(EVENT), /quedó oculto/);
    assert.ok(!requests.some(request => request.url.pathname === '/rest/v1/campus_events' && request.options.method === 'DELETE'));
  });
});

test('Retirar un medio limpia su objeto antes de borrar metadata y rechaza rutas manipuladas', async () => {
  const operations = [];
  await withClient(({url}) => {
    if (url.pathname === '/storage/v1/object/campus-events') {operations.push('storage'); return json([]);}
    if (url.pathname === '/rest/v1/event_media') {operations.push('database'); return json(null, 204);}
  }, async ({client, requests}) => {
    await login(client); await client.removeMedia(row);
    assert.deepEqual(operations, ['storage', 'database']);
    const before = requests.length;
    await assert.rejects(client.removeMedia({...row, storage_path: `${EVENT}/../../private.png`}), /ruta/);
    assert.equal(requests.length, before);
  });
});
