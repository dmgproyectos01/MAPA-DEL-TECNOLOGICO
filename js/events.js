import { parseYouTubeUrl, validateMediaFile } from './events-api.js?v=events-v1';

const TZ = 'America/Mazatlan';
const LIVE_LABELS = { off: 'Sin transmisión', scheduled: 'Programada', live: 'En vivo', ended: 'Finalizada' };
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const action = (text, handler, name, className = 'events-button') => {
  const button = node('button', className, text);
  button.type = 'button';
  if (name) button.dataset.eventAction = name;
  if (handler) button.addEventListener('click', handler);
  return button;
};
function dateParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function localDateValue(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  const p = dateParts(new Date(value));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function eventDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Fecha por confirmar';
  return new Intl.DateTimeFormat('es-MX', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function utcFromCampusDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Elige una fecha y hora válidas.');
  const guess = new Date(`${value}:00Z`);
  if (!Number.isFinite(guess.getTime())) throw new Error('Elige una fecha y hora válidas.');
  const p = dateParts(guess);
  const campusAtGuess = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess.getTime() + guess.getTime() - campusAtGuess).toISOString();
}
function videoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}
function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Archivo no disponible.');
  const url = new URL(value, location.href);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Archivo no disponible.');
  return url.href;
}

/** Events remain server-backed: this module never pretends a local file is published. */
export function initEvents({ button, dialog, client, notify = () => {}, locations = [] }) {
  if (!button || !dialog || !client) throw new Error('Faltan los elementos de eventos.');
  let filter = 'all', events = [], currentView = 'gallery', generation = 0;
  let admin = false, session = null, observer = null, busy = false;
  let editingEvent = null, uploadQueue = [], fileError = '', desiredPublish = false;
  let editorForm = null, editorFeedback = null, queueList = null, retryButton = null;
  let mediaList = null, editorActions = null;
  const mediaLoads = new WeakSet();
  dialog.classList.add('events-dialog');
  dialog.setAttribute('aria-labelledby', 'events-dialog-title');
  button.classList.add('events-launcher');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', dialog.id);

  const header = node('header', 'events-header');
  const heading = node('div', 'events-heading');
  const title = node('h2', '', 'Vida en el campus');
  title.id = 'events-dialog-title';
  heading.append(title, node('p', '', 'Eventos, fotos y transmisiones del Tec de Culiacán.'));
  const headerActions = node('div', 'events-header-actions');
  const manageButton = action('Administrar', openManagement, 'manage');
  manageButton.id = 'events-manage';
  const close = action('×', () => { if (!busy) dialog.close(); }, 'close', 'events-close');
  close.id = 'events-close';
  close.setAttribute('aria-label', 'Cerrar eventos');
  headerActions.append(manageButton, close);
  header.append(heading, headerActions);
  const body = node('div', 'events-body');
  dialog.replaceChildren(header, body);

  function stopMedia() {
    observer?.disconnect();
    observer = null;
    dialog.querySelectorAll('video').forEach(video => video.pause());
    dialog.querySelectorAll('iframe').forEach(frame => frame.remove());
  }
  function beginView(view) {
    stopMedia();
    currentView = view;
    generation++;
    body.replaceChildren();
    body.scrollTop = 0;
    return generation;
  }
  function feedback(target, text, error = false) {
    target.textContent = text;
    target.classList.toggle('events-error', error);
    target.setAttribute('role', error ? 'alert' : 'status');
  }
  function loading(target, text = 'Cargando eventos…') {
    target.replaceChildren(node('p', 'events-loading', text));
    target.setAttribute('aria-busy', 'true');
  }
  function emptyState(target, text, detail = '') {
    target.setAttribute('aria-busy', 'false');
    const box = node('div', 'events-empty');
    box.append(node('h3', '', text));
    if (detail) box.append(node('p', '', detail));
    target.replaceChildren(box);
  }
  function badge(event) {
    const label = event.status === 'draft' ? 'Borrador' : event.live_state === 'off' ? 'Publicado' : LIVE_LABELS[event.live_state] || 'Publicado';
    const element = node('span', `event-badge${event.status === 'published' && event.live_state === 'live' ? ' is-live' : ''}`, label);
    return element;
  }

  async function open() {
    if (!dialog.open) dialog.showModal();
    await showGallery();
  }
  button.addEventListener('click', open);
  dialog.addEventListener('keydown', event => {
    // Modal keystrokes remain in this flow; map shortcuts must not clear a route
    // or steal focus while someone types a slash in the event description.
    event.stopPropagation();
  });
  dialog.addEventListener('cancel', event => {
    event.stopPropagation();
    if (busy) { event.preventDefault(); if (editorFeedback?.isConnected) feedback(editorFeedback, 'Espera a que termine la operación para cerrar.'); }
  });
  dialog.addEventListener('close', () => {
    stopMedia();
    generation++;
    button.focus({ preventScroll: true });
  });

  async function showGallery() {
    const token = beginView('gallery');
    const toolbar = node('div', 'events-toolbar');
    const filters = node('nav', 'events-filters');
    filters.setAttribute('aria-label', 'Filtrar eventos');
    for (const [value, label] of [['all', 'Todos'], ['live', 'En vivo'], ['photos', 'Fotos'], ['videos', 'Videos']]) {
      const control = action(label, () => {
        filter = value;
        filters.querySelectorAll('button').forEach(item => {
          const selected = item.dataset.eventFilter === value;
          item.classList.toggle('active', selected);
          item.setAttribute('aria-pressed', String(selected));
        });
        renderGallery(grid);
      });
      control.dataset.eventFilter = value;
      control.classList.toggle('active', filter === value);
      control.setAttribute('aria-pressed', String(filter === value));
      filters.append(control);
    }
    toolbar.append(filters, action('Actualizar', showGallery, 'refresh-gallery'), node('span', 'events-timezone', 'Hora de Culiacán'));
    const galleryFeedback = node('p', 'events-feedback');
    galleryFeedback.id = 'events-gallery-feedback';
    galleryFeedback.setAttribute('role', 'status');
    const grid = node('div', 'events-grid');
    grid.id = 'events-gallery';
    body.append(toolbar, galleryFeedback, grid);
    if (!client.configured) {
      events = [];
      emptyState(grid, 'No hay eventos publicados.', 'Los nuevos eventos del campus aparecerán aquí.');
      return;
    }
    loading(grid);
    try {
      const rows = await client.listEvents({ includeDrafts: false });
      if (generation !== token || !dialog.open) return;
      events = (Array.isArray(rows) ? rows : []).filter(event => event.status === 'published');
      renderGallery(grid);
    } catch {
      if (generation !== token || !dialog.open) return;
      emptyState(grid, 'No pudimos cargar los eventos.', 'Revisa tu conexión e inténtalo de nuevo.');
      grid.querySelector('.events-empty').append(action('Reintentar', showGallery, 'retry-gallery'));
    }
  }
  function renderGallery(grid) {
    stopMedia();
    grid.replaceChildren();
    grid.setAttribute('aria-busy', 'false');
    const visible = events.filter(event => filter === 'all'
      || filter === 'live' && event.live_state === 'live'
      || filter === 'photos' && event.media?.some(media => media.kind === 'photo')
      || filter === 'videos' && event.media?.some(media => media.kind === 'video'));
    if (!visible.length) {
      emptyState(grid, ({ all: 'No hay eventos publicados.', live: 'No hay transmisiones en vivo.', photos: 'Todavía no hay fotos publicadas.', videos: 'Todavía no hay videos publicados.' })[filter]);
      return;
    }
    for (const event of visible) {
      const card = node('article', 'event-card');
      card.dataset.eventId = event.id;
      card.append(badge(event), node('h3', '', event.title || 'Evento del campus'));
      const date = node('time', 'event-date', eventDate(event.starts_at));
      if (event.starts_at) date.dateTime = event.starts_at;
      card.append(date);
      if (event.location) card.append(node('p', 'event-location', event.location));
      if (event.description) card.append(node('p', 'event-description', event.description));
      const id = videoId(event.youtube_video_id);
      if (id && event.live_state !== 'off') {
        const live = node('div', 'event-stream');
        const play = action(event.live_state === 'ended' ? 'Ver grabación' : 'Ver transmisión', () => {
          const frame = node('iframe', 'event-stream-frame');
          frame.title = `Transmisión: ${event.title || 'Evento del campus'}`;
          frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
          frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          frame.allowFullscreen = true;
          live.replaceChildren(frame, link);
        }, 'watch-live', 'events-button events-button-primary');
        const link = node('a', 'events-text-link', 'Abrir en YouTube');
        link.href = `https://www.youtube.com/watch?v=${id}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        live.append(play, link);
        card.append(live);
      }
      const media = (Array.isArray(event.media) ? event.media : []).filter(row => filter !== 'photos' && filter !== 'videos' || row.kind === (filter === 'photos' ? 'photo' : 'video'));
      if (media.length) {
        const gallery = node('div', 'event-media-grid');
        for (const row of media) gallery.append(mediaFigure(row, event));
        card.append(gallery);
      }
      grid.append(card);
    }
    activateLazyPhotos();
  }
  function mediaFigure(row, event) {
    const figure = node('figure', 'event-media');
    figure.dataset.mediaId = row.id;
    const caption = node('figcaption', '', row.original_name || (row.kind === 'video' ? 'Video del evento' : 'Foto del evento'));
    const load = action(row.kind === 'video' ? 'Cargar video' : 'Ver foto', () => loadMedia(figure, row, event), 'load-media', 'events-button event-media-load');
    figure.append(load, caption);
    if (row.kind === 'photo') {
      figure.dataset.lazyPhoto = 'true';
      figure._eventMedia = { row, event };
    }
    return figure;
  }
  function activateLazyPhotos() {
    if (!('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        const { row, event } = entry.target._eventMedia;
        loadMedia(entry.target, row, event);
      });
    }, { root: body, rootMargin: '120px' });
    body.querySelectorAll('[data-lazy-photo]').forEach(figure => observer.observe(figure));
  }
  async function loadMedia(figure, row, event) {
    if (mediaLoads.has(figure) || !dialog.open) return;
    mediaLoads.add(figure);
    const control = figure.querySelector('button');
    if (control) { control.disabled = true; control.textContent = 'Cargando archivo…'; }
    try {
      const url = safeMediaUrl(await client.mediaUrl(row));
      if (!figure.isConnected || !dialog.open) return;
      const element = node(row.kind === 'video' ? 'video' : 'img', 'event-media-content');
      if (row.kind === 'video') {
        element.controls = true;
        element.playsInline = true;
        element.preload = 'none';
      } else {
        element.loading = 'lazy';
        element.decoding = 'async';
        element.alt = `${event.title || 'Evento del campus'}: ${row.original_name || 'Fotografía'}`;
      }
      element.addEventListener('error', () => {
        element.remove();
        mediaLoads.delete(figure);
        if (control) { control.hidden = false; control.disabled = false; control.textContent = 'Reintentar archivo'; }
      }, { once: true });
      element.src = url;
      if (control) control.hidden = true;
      figure.prepend(element);
    } catch {
      mediaLoads.delete(figure);
      if (control) { control.disabled = false; control.textContent = 'Reintentar archivo'; }
    }
  }

  async function openManagement() {
    if (!client.configured) {
      if (currentView !== 'gallery') await showGallery();
      const target = body.querySelector('#events-gallery-feedback');
      feedback(target, 'La publicación de eventos todavía no está habilitada.', true);
      return;
    }
    manageButton.disabled = true;
    try {
      session = await client.getSession();
      admin = Boolean(session) && await client.isAdmin();
      if (admin) await showAdmin();
      else showLogin(session ? 'Esta cuenta no tiene permiso para administrar eventos.' : '');
    } catch {
      showLogin('No pudimos verificar tu sesión. Inténtalo nuevamente.');
    } finally { manageButton.disabled = false; }
  }
  function showLogin(message = '') {
    beginView('login');
    const wrapper = node('section', 'events-login');
    wrapper.append(node('h3', '', 'Acceso de administración'), node('p', '', 'Solo las cuentas autorizadas pueden publicar o editar eventos.'));
    const form = node('form', 'events-form');
    form.id = 'events-login-form';
    const email = inputField(form, 'Correo electrónico', 'events-email', 'email');
    email.required = true; email.autocomplete = 'username';
    const password = inputField(form, 'Contraseña', 'events-password', 'password');
    password.required = true; password.autocomplete = 'current-password';
    const error = node('p', 'events-feedback');
    error.id = 'events-auth-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    const submit = node('button', 'events-button events-button-primary', 'Entrar');
    submit.type = 'submit';
    form.append(error, submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true; error.textContent = '';
      const loginGeneration = generation;
      try {
        await client.signIn(email.value.trim(), password.value);
        password.value = '';
        session = await client.getSession();
        admin = await client.isAdmin();
        if (generation !== loginGeneration || !dialog.open) return;
        if (!admin) {
          feedback(error, 'Esta cuenta no tiene permiso para administrar eventos.', true);
          if (!wrapper.querySelector('#events-sign-out')) wrapper.append(signOutButton());
          return;
        }
        await showAdmin();
      } catch { feedback(error, 'No pudimos iniciar sesión. Revisa tu correo y contraseña.', true); }
      finally { submit.disabled = false; }
    });
    wrapper.append(form, action('Volver a los eventos', showGallery, 'back-gallery'));
    if (session) wrapper.append(signOutButton());
    body.append(wrapper);
    email.focus({ preventScroll: true });
  }
  function signOutButton() {
    const control = action('Cerrar sesión', async () => {
      control.disabled = true;
      try { await client.signOut(); session = null; admin = false; await showGallery(); }
      catch { notify('No pudimos cerrar la sesión. Inténtalo de nuevo.'); control.disabled = false; }
    }, 'sign-out');
    control.id = 'events-sign-out'; control.disabled = busy;
    return control;
  }
  async function showAdmin(message = '') {
    if (!admin) return showLogin('Se necesita una cuenta autorizada.');
    const token = beginView('admin');
    const toolbar = node('div', 'events-admin-toolbar');
    toolbar.append(node('h3', '', 'Administrar eventos'));
    const create = action('Nuevo evento', () => showEditor(), 'new-event', 'events-button events-button-primary');
    create.id = 'events-new-event'; create.disabled = busy;
    const backToGallery = action('Ver galería', showGallery, 'back-gallery'); backToGallery.disabled = busy;
    toolbar.append(create, signOutButton(), backToGallery);
    const status = node('p', 'events-feedback', message); status.id = 'events-admin-feedback'; status.setAttribute('role', 'status');
    const list = node('div', 'events-admin-list'); list.id = 'events-admin-list';
    body.append(toolbar, status, list);
    loading(list);
    try {
      const rows = await client.listEvents({ includeDrafts: true });
      if (generation !== token || !dialog.open) return;
      const items = Array.isArray(rows) ? rows : [];
      list.setAttribute('aria-busy', 'false'); list.replaceChildren();
      if (!items.length) return emptyState(list, 'Todavía no hay eventos.', 'Crea un borrador y publica cuando todos sus archivos estén listos.');
      for (const event of items) {
        const row = node('article', 'event-admin-row'); row.dataset.eventId = event.id;
        const info = node('div'); info.append(badge(event), node('h4', '', event.title || 'Evento sin título'), node('p', '', eventDate(event.starts_at)));
        const controls = node('div', 'event-admin-actions');
        controls.append(action('Editar', () => showEditor(event), 'edit-event'), action('Eliminar', () => confirmDeletion(event, controls), 'delete-event', 'events-button events-button-danger'));
        controls.querySelectorAll('button').forEach(control => control.disabled = busy);
        row.append(info, controls); list.append(row);
      }
    } catch {
      if (generation !== token || !dialog.open) return;
      emptyState(list, 'No pudimos cargar la administración.', 'Los eventos publicados no se han modificado.');
      list.querySelector('.events-empty').append(action('Reintentar', () => showAdmin(), 'retry-admin'));
    }
  }
  function confirmDeletion(event, target, after) {
    const box = node('div', 'events-confirm');
    box.setAttribute('role', 'group');
    box.append(node('p', '', `¿Eliminar «${event.title || 'este evento'}» y sus fotos y videos? Dejará de aparecer en el campus.`));
    const status = node('p', 'events-feedback'); status.setAttribute('role', 'alert');
    const confirm = action('Eliminar evento y archivos', async () => {
      confirm.disabled = true; cancel.disabled = true;
      try { await client.deleteEvent(event.id); if (after) await after(); else await showAdmin('Evento eliminado.'); }
      catch { feedback(status, 'No pudimos completar la eliminación. Reintenta para terminar de retirar el evento y sus archivos.', true); confirm.disabled = false; cancel.disabled = false; }
    }, 'confirm-delete', 'events-button events-button-danger');
    const cancel = action('Cancelar', () => box.remove(), 'cancel-delete');
    box.append(status, confirm, cancel); target.append(box); confirm.focus({ preventScroll: true });
  }
  function inputField(form, labelText, id, type = 'text') {
    const group = node('div', 'events-field');
    const label = node('label', '', labelText); label.htmlFor = id;
    const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input'); input.id = id; input.name = id;
    if (input.tagName === 'INPUT') input.type = type;
    group.append(label, input); form.append(group); return input;
  }
  function showEditor(event = null) {
    beginView('editor'); editingEvent = event ? { ...event, media: [...(event.media || [])] } : null;
    uploadQueue = []; fileError = ''; desiredPublish = false; busy = false;
    const toolbar = node('div', 'events-editor-toolbar');
    toolbar.append(node('h3', '', event ? 'Editar evento' : 'Nuevo evento'), action('Volver a administración', () => showAdmin(), 'back-admin'));
    editorForm = node('form', 'events-form events-editor'); editorForm.id = 'events-editor-form';
    const title = inputField(editorForm, 'Título del evento', 'event-title'); title.required = true; title.maxLength = 120; title.value = event?.title || '';
    const date = inputField(editorForm, 'Fecha y hora · Culiacán', 'event-date', 'datetime-local'); date.required = true; date.value = localDateValue(event?.starts_at);
    const location = inputField(editorForm, 'Ubicación en el campus', 'event-location'); location.maxLength = 160; location.value = event?.location || ''; location.setAttribute('list', 'event-locations');
    const options = node('datalist'); options.id = 'event-locations';
    for (const name of new Set(locations.map(location => location.name).filter(Boolean))) { const option = node('option'); option.value = name; options.append(option); }
    editorForm.append(options);
    const description = inputField(editorForm, 'Descripción', 'event-description', 'textarea'); description.maxLength = 4000; description.rows = 4; description.value = event?.description || '';
    const files = inputField(editorForm, 'Fotos y videos', 'event-media', 'file'); files.multiple = true; files.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
    files.parentElement.append(node('small', '', 'Fotos JPEG, PNG, WebP o GIF: hasta 10 MiB. Videos MP4, WebM o MOV: hasta 45 MiB. Se publican cuando todas las subidas terminen correctamente.'));
    queueList = node('ul', 'event-upload-queue'); queueList.id = 'events-upload-queue'; editorForm.append(queueList);
    files.addEventListener('change', () => {
      uploadQueue = []; fileError = '';
      try { for (const file of files.files) { validateMediaFile(file); uploadQueue.push({ file, done: false, error: false }); } }
      catch (error) { uploadQueue = []; fileError = error.message || 'Elige archivos de foto o video permitidos.'; feedback(editorFeedback, fileError, true); }
      renderUploadQueue();
      if (!fileError) feedback(editorFeedback, uploadQueue.length ? `${uploadQueue.length} archivo(s) por subir. Todavía no están publicados.` : '');
    });
    mediaList = node('div', 'events-existing-media'); editorForm.append(mediaList); renderExistingMedia();
    const streamHeading = node('h4', 'events-section-title', 'Transmisión por YouTube'); editorForm.append(streamHeading, node('p', 'events-stream-hint', 'Inicia la transmisión en tu canal de YouTube y pega aquí su enlace para que se vea en Eventos.'));
    const youtube = inputField(editorForm, 'Enlace de YouTube', 'event-youtube'); youtube.inputMode = 'url'; youtube.placeholder = 'https://www.youtube.com/watch?v=…'; youtube.value = videoId(event?.youtube_video_id) ? `https://www.youtube.com/watch?v=${event.youtube_video_id}` : '';
    const live = inputField(editorForm, 'Estado de la transmisión', 'event-live-state', 'select');
    for (const [value, text] of Object.entries(LIVE_LABELS)) { const option = node('option', '', text); option.value = value; live.append(option); } live.value = event?.live_state || 'off';
    editorFeedback = node('p', 'events-feedback'); editorFeedback.id = 'events-editor-feedback'; editorFeedback.setAttribute('role', 'status');
    editorActions = node('div', 'events-editor-actions');
    const publish = action('Publicar evento', () => saveEvent(true), 'publish', 'events-button events-button-primary');
    const save = action('Guardar borrador', () => saveEvent(false), 'save-draft');
    retryButton = action('Reintentar archivos pendientes', () => saveEvent(desiredPublish), 'retry-uploads'); retryButton.hidden = true;
    const remove = action('Eliminar borrador', () => { if (editingEvent) confirmDeletion(editingEvent, editorActions); }, 'delete-draft', 'events-button events-button-danger'); remove.hidden = !event || event.status !== 'draft';
    editorActions.append(publish, save, retryButton, remove);
    editorForm.append(editorFeedback, editorActions);
    editorForm.addEventListener('submit', event => { event.preventDefault(); saveEvent(true); });
    body.append(toolbar, editorForm);
    if (event?.status === 'draft') feedback(editorFeedback, 'Borrador guardado. Todavía no aparece en los eventos públicos.');
    title.focus({ preventScroll: true });
  }
  function renderUploadQueue() {
    queueList.replaceChildren();
    for (const entry of uploadQueue) {
      const li = node('li');
      li.append(node('span', '', entry.file.name), node('small', '', entry.done ? 'Subido' : entry.error ? 'Pendiente · reintenta' : 'Por subir'));
      queueList.append(li);
    }
  }
  function renderExistingMedia() {
    mediaList.replaceChildren();
    if (!editingEvent?.media?.length) return;
    mediaList.append(node('h4', '', 'Archivos guardados'));
    for (const row of editingEvent.media) {
      const item = node('div', 'events-saved-file'); item.dataset.mediaId = row.id;
      item.append(node('span', '', row.original_name || 'Archivo del evento'));
      const remove = action('Eliminar archivo', () => {
        const box = node('div', 'events-confirm'); box.append(node('p', '', `¿Eliminar «${row.original_name || 'este archivo'}» del evento?`));
        const status = node('p', 'events-feedback'); status.setAttribute('role', 'alert');
        const confirm = action('Eliminar archivo', async () => {
          confirm.disabled = true;
          try { await client.removeMedia(row); editingEvent.media = editingEvent.media.filter(media => media.id !== row.id); renderExistingMedia(); }
          catch { feedback(status, 'No pudimos eliminar el archivo. Inténtalo nuevamente.', true); confirm.disabled = false; }
        }, 'confirm-remove-media', 'events-button events-button-danger');
        box.append(status, confirm, action('Cancelar', () => box.remove(), 'cancel-remove-media')); item.append(box);
      }, 'remove-media');
      remove.disabled = busy; item.append(remove); mediaList.append(item);
    }
  }
  function setBusy(value) {
    busy = value;
    editorForm.querySelectorAll('input,textarea,select,button').forEach(element => element.disabled = value);
    body.querySelector('[data-event-action="back-admin"]').disabled = value;
    manageButton.disabled = value; close.disabled = value;
  }
  async function saveEvent(publish) {
    if (busy || !editorForm?.isConnected || !admin) return;
    desiredPublish = publish;
    if (!editorForm.reportValidity()) return;
    if (fileError) { feedback(editorFeedback, fileError, true); return; }
    const get = id => editorForm.querySelector(`#${id}`).value;
    let fields;
    try {
      const youtube = get('event-youtube').trim();
      const id = youtube ? parseYouTubeUrl(youtube) : null;
      const live = get('event-live-state');
      if (id && live === 'off') throw new Error('Elige Programada, En vivo o Finalizada para guardar el enlace de YouTube.');
      if (live !== 'off' && !id) throw new Error('Agrega un enlace válido de YouTube para activar la transmisión.');
      fields = { title: get('event-title').trim(), description: get('event-description').trim(), location: get('event-location').trim(), starts_at: utcFromCampusDate(get('event-date')), status: 'draft', live_state: live, youtube_video_id: id };
      if (!fields.title) throw new Error('Escribe el título del evento.');
    } catch (error) { feedback(editorFeedback, error.message || 'Revisa la información del evento.', true); return; }
    setBusy(true); retryButton.hidden = true;
    feedback(editorFeedback, 'Guardando borrador…');
    try {
      const saved = editingEvent?.id ? await client.updateEvent(editingEvent.id, fields) : await client.createEvent(fields);
      editingEvent = { ...editingEvent, ...saved, ...fields, media: editingEvent?.media || saved?.media || [] };
      if (!editingEvent.id) throw new Error('No se guardó el borrador.');
      editorActions.querySelector('[data-event-action="delete-draft"]').hidden = false;
      for (let i = 0; i < uploadQueue.length; i++) {
        const entry = uploadQueue[i]; if (entry.done) continue;
        entry.error = false;
        feedback(editorFeedback, `Subiendo archivo ${i + 1} de ${uploadQueue.length}: ${entry.file.name}`);
        try {
          const media = await client.uploadMedia(editingEvent.id, entry.file);
          entry.done = true;
          if (media && !editingEvent.media.some(row => row.id === media.id)) editingEvent.media.push(media);
          renderUploadQueue(); renderExistingMedia();
        } catch (error) { entry.error = true; renderUploadQueue(); throw error; }
      }
      if (publish) {
        feedback(editorFeedback, 'Publicando evento…');
        await client.updateEvent(editingEvent.id, { status: 'published' });
        await showAdmin('Evento publicado.');
      } else await showAdmin('Borrador guardado. Aún no aparece en los eventos públicos.');
    } catch {
      if (editorForm.isConnected) {
        const hasDraft = Boolean(editingEvent?.id && editingEvent.status === 'draft');
        feedback(editorFeedback, hasDraft ? 'No se pudo completar la publicación. El borrador está guardado; puedes reintentar o eliminarlo.' : 'No pudimos completar los cambios. Vuelve a la administración para comprobar el estado del evento.', true);
        retryButton.textContent = publish ? 'Reintentar y publicar' : 'Reintentar archivos pendientes'; retryButton.hidden = !hasDraft;
      }
    } finally {
      if (editorForm.isConnected && currentView === 'editor') setBusy(false);
      else { busy = false; manageButton.disabled = false; close.disabled = false; body.querySelectorAll('button').forEach(control => control.disabled = false); }
    }
  }
  return { open, close: () => { if (!busy) dialog.close(); }, refresh: () => { if (!busy) return showGallery(); } };
}
