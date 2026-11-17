// The SFU SDK is loaded only after a camera preview or viewer action.
let sdkPromise;
function loadSDK() {
  sdkPromise ||= import('../vendor/livekit-client.esm.js').then(sdk => {sdk.setLogLevel('error'); return sdk;}).catch(error => {sdkPromise = null; throw error;});
  return sdkPromise;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
function eventIdentifier(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('El identificador de la transmisión no es válido.');
  return value;
}
function serverCredentials(value) {
  let url;
  try {url = new URL(value?.url);} catch {throw new Error('El servidor no devolvió una conexión de video válida.');}
  const localTest = url.protocol === 'ws:' && LOOPBACK.has(url.hostname) && LOOPBACK.has(globalThis.location?.hostname);
  if ((url.protocol !== 'wss:' && !localTest) || url.username || url.password || url.hash || url.search || typeof value?.token !== 'string' || !value.token || !UUID.test(value?.streamId || '') || typeof value?.roomName !== 'string' || !value.roomName) throw new Error('La conexión de video debe ser segura y estar autorizada por el servidor.');
  return {...value, url: url.href};
}
function messageFor(error, fallback) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Permite el acceso a la cámara y al micrófono para preparar la transmisión.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No se encontró una cámara o un micrófono disponible.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'La cámara o el micrófono están ocupados. Cierra la otra aplicación e inténtalo de nuevo.';
  if (error?.name === 'SecurityError') return 'La cámara necesita una página HTTPS y permiso del navegador.';
  return fallback;
}
function stopTracks(tracks) {
  for (const track of tracks) {
    try {track.mediaStreamTrack?.stop();} catch {}
    try {track.stop();} catch {}
    try {track.detach();} catch {}
  }
}

export function createNativeLive({request, onState = () => {}} = {}) {
  if (typeof request !== 'function') throw new Error('Falta la conexión al servicio de transmisiones.');
  let version = 0, disposed = false, room = null, localTracks = [], preview = null, host = null;
  let role = null, state = 'idle', microphoneEnabled = false, cameraEnabled = false, audioBlocked = false;
  let facingMode = 'environment', pendingCameraFacing = false, pendingStop = null, heartbeat = null, heartbeatBusy = false, failures = 0, confirmed = false;
  let viewerWait = null, lostVideo = null, publisherIdentity = null, destroyPromise = null;
  const remote = new Map(), stopping = new Map();
  const snapshot = () => ({state, role, microphoneEnabled, cameraEnabled, audioBlocked, streamId: host?.streamId || null});
  const emit = (next, message, extra = {}) => {
    state = next;
    const value = {...snapshot(), message, ...extra};
    try {onState(value);} catch {}
    return value;
  };
  const active = (operation, ownedRoom) => !disposed && operation === version && (!ownedRoom || room === ownedRoom);
  const assertOpen = () => {if (disposed) throw new Error('Este reproductor ya está cerrado. Vuelve a abrir la transmisión.');};
  function removeRemote(track) {
    const element = remote.get(track);
    try {track.detach();} catch {}
    if (element) {try {element.pause(); element.srcObject = null; element.remove();} catch {}}
    remote.delete(track);
  }
  function cleanup() {
    clearInterval(heartbeat); heartbeat = null; heartbeatBusy = false; failures = 0;
    clearTimeout(viewerWait); clearTimeout(lostVideo); viewerWait = lostVideo = null;
    // Privacy cleanup is synchronous and does not wait for any API request.
    const tracks = localTracks; localTracks = [];
    stopTracks(tracks);
    if (preview) {try {preview.pause(); preview.srcObject = null;} catch {} preview = null;}
    for (const track of [...remote.keys()]) removeRemote(track);
    const previousRoom = room; room = null;
    if (previousRoom) {
      try {previousRoom.removeAllListeners();} catch {}
      try {Promise.resolve(previousRoom.disconnect(true)).catch(() => {});} catch {}
    }
    microphoneEnabled = cameraEnabled = audioBlocked = false;
    confirmed = false; publisherIdentity = null;
  }
  function stopReservation(context) {
    if (!context?.streamId) return Promise.resolve();
    const key = `${context.eventId}:${context.streamId}`;
    pendingStop = context;
    if (!stopping.has(key)) {
      const pending = Promise.resolve().then(() => request('stop', {eventId: context.eventId, streamId: context.streamId}));
      stopping.set(key, pending);
      pending.catch(() => stopping.delete(key));
    }
    return stopping.get(key).then(result => {if (pendingStop?.eventId === context.eventId && pendingStop?.streamId === context.streamId) pendingStop = null; return result;});
  }
  function fail(error, fallback, operation) {
    if (!active(operation)) return null;
    const context = host || pendingStop; host = null; version++;
    cleanup();
    stopReservation(context).catch(() => {});
    const message = messageFor(error, fallback);
    emit('error', message);
    return new Error(message, {cause: error});
  }
  function endViewer(operation, message = 'La transmisión ha terminado.') {
    if (!active(operation) || role !== 'viewer') return;
    version++; cleanup(); host = null;
    emit('ended', message);
  }
  function watchLocalTrack(track, operation, sdk) {
    track.on(sdk.TrackEvent.Ended, () => {
      const error = fail(null, 'La cámara o el micrófono se desconectaron. La transmisión se detuvo y los dispositivos se apagaron.', operation);
      if (error) return;
    });
  }
  function heartbeatFor(operation, context) {
    heartbeat = setInterval(async () => {
      if (!active(operation) || host !== context || heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        const result = await request('heartbeat', {eventId: context.eventId, streamId: context.streamId});
        if (result?.live !== true) throw new Error('No se confirmó la transmisión.');
        if (active(operation)) failures = 0;
      } catch (error) {
        if (!active(operation)) return;
        failures++;
        if (failures >= 3) fail(error, 'Se detuvo la transmisión y se apagaron los dispositivos porque el servidor dejó de confirmar la conexión.', operation);
        else emit(state, 'La señal continúa, pero se está verificando la conexión con el servidor.');
      } finally {if (active(operation)) heartbeatBusy = false;}
    }, 20000);
  }
  function bindRoom(ownedRoom, sdk, operation) {
    const valid = () => active(operation, ownedRoom);
    ownedRoom.on(sdk.RoomEvent.Reconnecting, () => {if (valid()) emit('reconnecting', 'Reconectando la señal de audio y video…');});
    ownedRoom.on(sdk.RoomEvent.SignalReconnecting, () => {if (valid()) emit('reconnecting', 'Restableciendo la conexión de la transmisión…');});
    ownedRoom.on(sdk.RoomEvent.Reconnected, () => {
      if (!valid()) return;
      if (role === 'host') emit(confirmed ? 'live' : 'connecting', confirmed ? 'Transmisión en vivo. Conexión restablecida.' : 'Confirmando la transmisión…');
      else {
        const hasVideo = [...remote.keys()].some(track => track.kind === sdk.Track.Kind.Video);
        emit(hasVideo ? 'playing' : 'connecting', 'Conexión restablecida.');
        if (!hasVideo) {clearTimeout(viewerWait); viewerWait = setTimeout(() => {if (valid()) endViewer(operation, 'La transmisión no recuperó la señal de video.');}, 15000);}
      }
    });
    ownedRoom.on(sdk.RoomEvent.Disconnected, () => {
      if (!valid()) return;
      if (role === 'viewer') endViewer(operation);
      else fail(null, 'La conexión de la transmisión terminó y los dispositivos se apagaron.', operation);
    });
    ownedRoom.on(sdk.RoomEvent.MediaDevicesError, error => {if (valid() && role === 'host') fail(error, 'Se perdió el acceso a la cámara o al micrófono. La transmisión se detuvo.', operation);});
    ownedRoom.on(sdk.RoomEvent.LocalTrackUnpublished, publication => {
      if (valid() && role === 'host' && confirmed && state !== 'reconnecting' && [sdk.Track.Kind.Video, sdk.Track.Kind.Audio].includes(publication.kind)) fail(null, 'La cámara o el micrófono dejaron de publicarse. La transmisión se detuvo.', operation);
    });
  }
  async function closePrevious(operation) {
    const context = host || pendingStop; host = null; cleanup();
    if (context?.streamId) {
      try {await stopReservation(context);} catch (error) {
        if (active(operation)) {emit('error', 'Los dispositivos están apagados, pero no se pudo cerrar la transmisión anterior en el servidor.'); throw error;}
      }
    }
  }
  async function prepare(videoElement, {facingMode: requestedFacing = 'environment'} = {}) {
    assertOpen();
    if (videoElement?.tagName?.toLowerCase() !== 'video') throw new Error('Falta el elemento de vista previa de la cámara.');
    if (!['environment', 'user'].includes(requestedFacing)) throw new Error('La orientación de la cámara no es válida.');
    const operation = ++version;
    await closePrevious(operation);
    if (!active(operation)) return null;
    role = 'host'; facingMode = requestedFacing; pendingCameraFacing = false;
    emit('connecting', 'Solicitando acceso a la cámara y al micrófono…');
    let tracks = [];
    try {
      const sdk = await loadSDK();
      if (!active(operation)) return null;
      tracks = await sdk.createLocalTracks({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: {facingMode, resolution: sdk.VideoPresets.h720.resolution}});
      if (!active(operation)) {stopTracks(tracks); return null;}
      const video = tracks.find(track => track.kind === sdk.Track.Kind.Video), audio = tracks.find(track => track.kind === sdk.Track.Kind.Audio);
      if (!video || !audio) throw new Error('Se necesitan una cámara y un micrófono.');
      audio.stopOnMute = true;
      localTracks = tracks; preview = videoElement;
      microphoneEnabled = cameraEnabled = true;
      for (const track of tracks) watchLocalTrack(track, operation, sdk);
      preview.autoplay = true; preview.muted = true; preview.playsInline = true; preview.setAttribute('playsinline', '');
      video.attach(preview);
      Promise.resolve(preview.play()).catch(() => {});
      return emit('preview', 'Vista previa local. Todavía no estás transmitiendo.');
    } catch (error) {
      stopTracks(tracks);
      const failure = fail(error, 'No se pudo preparar la cámara y el micrófono.', operation);
      if (failure) throw failure;
      return null;
    }
  }
  async function start(eventId) {
    assertOpen(); eventIdentifier(eventId);
    if (state !== 'preview' || !localTracks.length || !cameraEnabled) throw new Error('Prepara y activa la cámara antes de iniciar la transmisión.');
    const operation = ++version, context = {eventId, streamId: null}, captureTracks = [...localTracks];
    host = context; role = 'host'; confirmed = false;
    emit('connecting', 'Conectando la cámara y el micrófono al servidor…');
    let credentials, ownedRoom;
    try {
      const sdk = await loadSDK();
      if (!active(operation)) return null;
      for (const track of captureTracks) watchLocalTrack(track, operation, sdk);
      const response = await request('start', {eventId});
      // Even a canceled start may have reserved a server room; clean it up.
      if (!active(operation)) {if (response?.streamId) stopReservation({eventId, streamId: response.streamId}).catch(() => {}); return null;}
      if (UUID.test(response?.streamId || '')) context.streamId = response.streamId;
      credentials = serverCredentials(response); context.streamId = credentials.streamId;
      ownedRoom = new sdk.Room({adaptiveStream: true, dynacast: true, disconnectOnPageLeave: false});
      room = ownedRoom; bindRoom(ownedRoom, sdk, operation);
      await ownedRoom.connect(credentials.url, credentials.token, {autoSubscribe: false});
      if (!active(operation, ownedRoom)) {stopTracks(captureTracks); Promise.resolve(ownedRoom.disconnect(true)).catch(() => {}); stopReservation(context).catch(() => {}); return null;}
      for (const track of captureTracks) {
        if (!active(operation, ownedRoom)) {stopTracks(captureTracks); Promise.resolve(ownedRoom.disconnect(true)).catch(() => {}); return null;}
        await ownedRoom.localParticipant.publishTrack(track, {source: track.kind === sdk.Track.Kind.Video ? sdk.Track.Source.Camera : sdk.Track.Source.Microphone, videoCodec: 'vp8', simulcast: true});
      }
      if (!active(operation, ownedRoom)) {stopTracks(captureTracks); Promise.resolve(ownedRoom.disconnect(true)).catch(() => {}); return null;}
      const result = await request('confirm', {eventId, streamId: context.streamId});
      if (!active(operation, ownedRoom)) {stopTracks(captureTracks); return null;}
      if (result?.live !== true) throw new Error('El servidor no confirmó la transmisión.');
      confirmed = true;
      heartbeatFor(operation, context);
      return emit('live', 'Transmisión en vivo. La cámara y el micrófono están publicados.');
    } catch (error) {
      const failure = fail(error, 'No se pudo iniciar la transmisión. Se apagaron la cámara y el micrófono.', operation);
      if (failure) throw failure;
      stopTracks(captureTracks);
      if (ownedRoom && ownedRoom !== room) {try {await ownedRoom.disconnect(true);} catch {}}
      if (context.streamId) stopReservation(context).catch(() => {});
      return null;
    }
  }
  async function stop() {
    const operation = ++version, context = host || pendingStop; host = null;
    cleanup();
    emit('ended', role === 'host' ? 'Transmisión detenida. Cámara y micrófono apagados.' : 'Reproducción detenida.');
    try {await stopReservation(context);}
    catch (error) {
      if (active(operation)) emit('error', 'Cámara y micrófono apagados. No se pudo confirmar el cierre en el servidor; vuelve a intentarlo.');
      throw error;
    }
  }
  async function watch(eventId, container) {
    assertOpen(); eventIdentifier(eventId);
    if (typeof container?.appendChild !== 'function') throw new Error('Falta el contenedor del reproductor.');
    const operation = ++version;
    await closePrevious(operation);
    if (!active(operation)) return null;
    role = 'viewer'; emit('connecting', 'Conectando con la transmisión…');
    let ownedRoom;
    try {
      const [sdk, response] = await Promise.all([loadSDK(), request('view', {eventId})]);
      if (!active(operation)) return null;
      const credentials = serverCredentials(response);
      ownedRoom = new sdk.Room({adaptiveStream: true, disconnectOnPageLeave: false});
      room = ownedRoom; bindRoom(ownedRoom, sdk, operation);
      const valid = () => active(operation, ownedRoom);
      const noVideo = () => ![...remote.keys()].some(track => track.kind === sdk.Track.Kind.Video);
      const scheduleMissingVideo = () => {
        clearTimeout(lostVideo);
        lostVideo = setTimeout(() => {if (valid() && noVideo() && state !== 'reconnecting') endViewer(operation, 'La transmisión dejó de enviar video.');}, 2000);
      };
      ownedRoom.on(sdk.RoomEvent.TrackPublished, (publication, participant) => {if (valid() && [sdk.Track.Source.Camera, sdk.Track.Source.Microphone].includes(publication.source)) publisherIdentity ||= participant.identity;});
      ownedRoom.on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (!valid() || ![sdk.Track.Kind.Video, sdk.Track.Kind.Audio].includes(track.kind)) return;
        publisherIdentity ||= participant.identity;
        if (participant.identity !== publisherIdentity || remote.has(track)) return;
        const element = track.attach();
        remote.set(track, element);
        element.autoplay = true;
        element.className = track.kind === sdk.Track.Kind.Video ? 'native-live-video' : 'native-live-audio';
        if (track.kind === sdk.Track.Kind.Video) {
          clearTimeout(lostVideo); clearTimeout(viewerWait);
          element.playsInline = true; element.setAttribute('playsinline', ''); element.muted = true;
          const playing = () => {if (valid()) emit('playing', 'Transmisión en vivo recibida en este reproductor.');};
          element.addEventListener('playing', playing);
          container.appendChild(element);
          Promise.resolve(element.play()).then(playing).catch(() => {if (valid()) {audioBlocked = true; emit(state, 'Pulsa Activar audio para iniciar la reproducción.');}});
        } else {
          element.muted = false; container.appendChild(element);
          Promise.resolve(element.play()).catch(() => {if (valid()) {audioBlocked = true; emit(state, 'Pulsa Activar audio para escuchar la transmisión.');}});
        }
      });
      ownedRoom.on(sdk.RoomEvent.TrackUnsubscribed, track => {if (valid()) {removeRemote(track); if (track.kind === sdk.Track.Kind.Video) scheduleMissingVideo();}});
      ownedRoom.on(sdk.RoomEvent.TrackUnpublished, (publication, participant) => {if (valid() && participant.identity === publisherIdentity && publication.kind === sdk.Track.Kind.Video) endViewer(operation);});
      ownedRoom.on(sdk.RoomEvent.ParticipantDisconnected, participant => {if (valid() && participant.identity === publisherIdentity) endViewer(operation);});
      ownedRoom.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => {
        if (valid()) {audioBlocked = !ownedRoom.canPlaybackAudio; emit(state, audioBlocked ? 'Pulsa Activar audio para escuchar la transmisión.' : 'Audio de la transmisión activado.');}
      });
      await ownedRoom.connect(credentials.url, credentials.token, {autoSubscribe: true});
      if (!valid()) {Promise.resolve(ownedRoom.disconnect(true)).catch(() => {}); return null;}
      for (const participant of ownedRoom.remoteParticipants.values()) {
        if ([...participant.trackPublications.values()].some(publication => [sdk.Track.Source.Camera, sdk.Track.Source.Microphone].includes(publication.source))) publisherIdentity ||= participant.identity;
      }
      if (noVideo()) viewerWait = setTimeout(() => {if (valid() && noVideo()) endViewer(operation, 'La transmisión no está enviando video en este momento.');}, 15000);
      return snapshot();
    } catch (error) {
      const failure = fail(error, 'No se pudo conectar con esta transmisión.', operation);
      if (failure) throw failure;
      if (ownedRoom && ownedRoom !== room) {try {await ownedRoom.disconnect(true);} catch {}}
      return null;
    }
  }
  async function enableAudio() {
    assertOpen();
    const ownedRoom = room, operation = version;
    if (!ownedRoom || role !== 'viewer') throw new Error('Abre una transmisión para activar su audio.');
    await ownedRoom.startAudio();
    if (!active(operation, ownedRoom)) return;
    for (const [track, element] of remote) if (track.kind === 'audio' || track.kind === 'video') await element.play();
    if (active(operation, ownedRoom)) {audioBlocked = !ownedRoom.canPlaybackAudio; emit(state, audioBlocked ? 'El navegador aún necesita permiso para reproducir audio.' : 'Audio de la transmisión activado.');}
  }
  async function setTrackEnabled(kind, enabled) {
    assertOpen();
    if (typeof enabled !== 'boolean') throw new Error('El estado del dispositivo no es válido.');
    const track = localTracks.find(track => track.kind === kind), operation = version;
    if (!track || role !== 'host') throw new Error('Prepara primero la cámara y el micrófono.');
    try {
      if (!enabled && track.mediaStreamTrack) track.mediaStreamTrack.enabled = false;
      await (enabled ? track.unmute() : track.mute());
      if (!active(operation)) {stopTracks([track]); return false;}
      if (kind === 'video' && enabled && pendingCameraFacing) {await track.restartTrack({facingMode}); pendingCameraFacing = false;}
      if (!active(operation)) {stopTracks([track]); return false;}
      if (track.mediaStreamTrack && enabled) track.mediaStreamTrack.enabled = true;
      if (kind === 'video') cameraEnabled = enabled; else microphoneEnabled = enabled;
      emit(state, kind === 'video' ? enabled ? 'Cámara activada.' : 'Cámara apagada.' : enabled ? 'Micrófono activado.' : 'Micrófono apagado.');
      return enabled;
    } catch (error) {
      const failure = fail(error, 'No se pudo cambiar el dispositivo. La transmisión se detuvo para apagar la captura.', operation);
      if (failure) throw failure;
      return false;
    }
  }
  async function flipCamera() {
    assertOpen();
    const track = localTracks.find(track => track.kind === 'video'), operation = version;
    if (!track || role !== 'host') throw new Error('Prepara primero la cámara.');
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    if (!cameraEnabled) {facingMode = nextFacing; pendingCameraFacing = true; emit(state, 'Se cambió la orientación para la próxima activación de la cámara.'); return facingMode;}
    try {
      await track.restartTrack({facingMode: nextFacing});
      if (!active(operation)) {stopTracks([track]); return null;}
      facingMode = nextFacing;
      if (preview) {track.attach(preview); Promise.resolve(preview.play()).catch(() => {});}
      emit(state, 'Se cambió la cámara de la transmisión.');
      return facingMode;
    } catch (error) {
      const failure = fail(error, 'No se pudo cambiar de cámara. Se apagó la captura; vuelve a preparar la vista previa.', operation);
      if (failure) throw failure;
      return null;
    }
  }
  const pagehide = () => {stop().catch(() => {});};
  globalThis.addEventListener?.('pagehide', pagehide);
  function destroy() {
    if (destroyPromise) return destroyPromise;
    globalThis.removeEventListener?.('pagehide', pagehide);
    destroyPromise = stop(); disposed = true;
    return destroyPromise;
  }
  emit('idle', 'La cámara y el micrófono están apagados.');
  return {prepare, start, stop, watch, enableAudio, setMicrophone: enabled => setTrackEnabled('audio', enabled), setCamera: enabled => setTrackEnabled('video', enabled), flipCamera, destroy, getState: snapshot};
}
