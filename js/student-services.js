import {normalize} from './search.js';

export function filterStudentServices(services, query = '', category = 'Todos') {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return services.filter(service => (category === 'Todos' || service.category === category) && words.every(word =>
    normalize([service.title, service.summary, service.category, ...(service.links || []).map(link => link.label), ...(service.keywords || []), ...(service.sections || []).flatMap(section => [section.title, section.text])].join(' ')).includes(word)));
}

export function safeServiceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

export async function initStudentServices({button, dialog, selectLocation, notify = () => {}}) {
  let services;
  try {
    const response = await fetch('data/student-services.json?v=student-services-v2', {cache: 'no-store'});
    if (!response.ok) throw Error('No se pudo cargar la guía');
    ({services} = await response.json());
    if (!Array.isArray(services)) throw Error('Guía inválida');
  } catch {
    button.disabled = false;
    button.onclick = () => notify('No se pudo cargar Servicios. Actualiza la página e inténtalo de nuevo.');
    return;
  }
  let category = 'Todos', returnFocus = button;
  const heading = node('header', 'student-services-header');
  const titles = node('div');
  titles.append(node('span', 'eyebrow', 'ACOMPAÑAMIENTO Y TRÁMITES'));
  const title = node('h2', '', 'Servicios para estudiantes'); title.id = 'student-services-title';
  titles.append(title, node('p', '', 'Información útil, citas y enlaces, en un solo lugar.'));
  const close = node('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar servicios');
  close.onclick = () => dialog.close();
  heading.append(titles, close);
  const controls = node('div', 'student-services-controls');
  const label = node('label', 'sr-only', 'Buscar servicios'); label.htmlFor = 'student-services-search';
  const input = node('input'); input.id = 'student-services-search'; input.type = 'search'; input.placeholder = 'Busca un servicio, trámite o persona…'; input.autocomplete = 'off';
  const filters = node('div', 'student-services-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Categorías de servicios');
  for (const name of ['Todos', ...new Set(services.map(service => service.category))]) {
    const filter = node('button', '', name); filter.type = 'button'; filter.setAttribute('aria-pressed', String(name === category));
    filter.onclick = () => {category = name; render();};
    filters.append(filter);
  }
  const count = node('p', 'student-services-count'); count.setAttribute('role', 'status');
  controls.append(label, input, filters, count);
  const list = node('div', 'student-services-list');
  const footer = node('footer', 'student-services-footer', 'Consulta los requisitos y avisos vigentes antes de realizar un trámite.');
  dialog.replaceChildren(heading, controls, list, footer);

  function render(selectedId) {
    for (const filter of filters.children) filter.setAttribute('aria-pressed', String(filter.textContent === category));
    const matches = filterStudentServices(services, input.value, category);
    count.textContent = `${matches.length} ${matches.length === 1 ? 'servicio' : 'servicios'}`;
    list.replaceChildren();
    for (const service of matches) {
      const details = node('details', 'student-service'); details.dataset.serviceId = service.id;
      const summary = node('summary');
      summary.append(node('span', 'student-service-category', service.category), node('h3', '', service.title), node('span', 'student-service-summary', service.summary));
      const body = node('div', 'student-service-body');
      for (const section of service.sections || []) body.append(node('h4', '', section.title), node('p', '', section.text));
      const actions = node('div', 'student-service-actions');
      for (const link of service.links || []) {
        const href = safeServiceUrl(link.url); if (!href) continue;
        const anchor = node('a', 'secondary', link.label + ' ↗'); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        actions.append(anchor);
      }
      if (service.locationId) {
        const locate = node('button', 'secondary', 'Ver en el mapa'); locate.type = 'button';
        locate.onclick = () => {
          dialog.close(); selectLocation(service.locationId);
          document.querySelector('#detail .close')?.focus({preventScroll: true});
        };
        actions.append(locate);
      }
      body.append(actions);
      const source = node('p', 'student-service-source');
      const sourceUrl = safeServiceUrl(service.source?.url);
      if (sourceUrl) {
        const anchor = node('a', '', service.source.label); anchor.href = sourceUrl; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; source.append('Fuente: ', anchor);
      } else source.textContent = `Fuente: ${service.source?.label || 'Directorio del campus'}`;
      if (service.source?.checkedAt) {
        const date = new Date(service.source.checkedAt + 'T12:00:00Z');
        if (Number.isFinite(date.getTime())) source.append(' · Consultado el ' + new Intl.DateTimeFormat('es-MX', {timeZone: 'America/Mazatlan', dateStyle: 'long'}).format(date));
      }
      body.append(source);
      details.append(summary, body); details.open = service.id === selectedId;
      list.append(details);
    }
    if (!matches.length) list.append(node('p', 'student-services-empty', 'No encontramos ese servicio. Prueba con otro nombre o selecciona Todos.'));
  }
  function open(id) {
    if (!dialog.open) returnFocus = document.activeElement;
    input.value = ''; category = 'Todos'; render(id);
    if (!dialog.open) dialog.showModal();
    if (id) {
      const selected = [...list.children].find(el => el.dataset.serviceId === id);
      selected?.scrollIntoView({block: 'nearest'}); selected?.querySelector('summary')?.focus();
    } else { list.scrollTop = 0; input.focus(); }
  }
  input.oninput = () => render();
  button.onclick = () => open();
  dialog.addEventListener('close', () => {if (returnFocus?.isConnected) returnFocus.focus({preventScroll: true});});
  dialog.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); dialog.close();}});
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  window.addEventListener('open-student-service', event => open(event.detail));
  render();
  button.disabled = false;
}
