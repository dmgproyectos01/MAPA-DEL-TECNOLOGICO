export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const identifier = value => normalize(value).replace(/[\s-]/g, '');
const buildingCode = location => location.code || location.id;
const buildingNames = location => [location.id, location.code, location.name, ...(location.aliases || [])].filter(Boolean);
const wordsMatch = (query, text) => query.split(/\s+/).every(word => text.includes(word));
const levelDescription = (location, level) => `${buildingCode(location)} · ${level.name}`;

function buildingResult(location, detail) {
  return {
    location,
    label: location.name,
    description: `${location.x ? 'Edificio ' + buildingCode(location) : 'Servicio del campus'} · ${detail || location.services?.[0] || location.category}`
  };
}

export function searchLocations(query, locations) {
  const q = normalize(query);
  if (!q) return [];

  // Keep the established one-letter shortcut and unconfirmed classroom lookup.
  if (q === 'e') return ['EA01', 'ED01', 'EE01', 'EV01', 'EW01', 'EJ01', 'EH01'].flatMap(code => searchLocations(code, locations));
  const legacyRoom = /^e([a-zñ])(\d{1,2})$/i.exec(String(query).trim());
  if (legacyRoom) {
    const location = locations.find(place => String(place.id).toUpperCase() === legacyRoom[1].toUpperCase());
    if (location) {
      const room = `E${location.id}${legacyRoom[2].padStart(2, '0')}`;
      return [{location, room, label: room, description: `Edificio ${buildingCode(location)} · ${location.rooms?.includes(room) ? 'Salón confirmado' : 'Consultar salones del edificio'}`}];
    }
  }

  // Exact identities must precede substring matches such as UA inside "aulas".
  const exactBuildings = locations.filter(location => buildingNames(location).some(name => normalize(name) === q));
  const exactCode = locations.find(location => String(location.code || location.id).toUpperCase() === String(query).trim().toUpperCase());
  if (exactCode) return [buildingResult(exactCode)];
  const ranked = [];
  const add = (result, score) => ranked.push({...result, score, order: ranked.length});
  exactBuildings.forEach(location => add(buildingResult(location), 1100));
  const scope = locations.find(location => location.code && q.split(/\s+/).includes(normalize(location.code)));
  for (const location of locations) {
    if (scope && location !== scope) continue;
    const names = location.code ? [location.code, location.name, ...(location.aliases || [])] : buildingNames(location);
    const identity = normalize(names.join(' '));
    let matchedLevelItem = false;
    for (const level of location.levels || []) {
      const levelName = normalize(level.name);
      const levelContext = `${identity} ${levelName}`;
      const exactLevel = q === levelName || buildingNames(location).some(name => q === normalize(`${name} ${level.name}`));
      if (exactLevel) add({location, level: level.id, label: levelDescription(location, level), description: `${levelDescription(location, level)} · Ver espacios del piso`}, 700);

      for (const item of level.items || []) {
        const name = normalize(item.name);
        const text = normalize([item.name, item.room, item.description, item.professor, ...(item.aliases || [])].filter(Boolean).join(' '));
        const roomExact = item.room && identifier(q) === identifier(item.room);
        if (!roomExact && !wordsMatch(q, `${levelContext} ${text}`)) continue;
        matchedLevelItem = true;
        const score = roomExact ? 1000 : q === name ? 800 : name.includes(q) ? 600 : wordsMatch(q, name) ? 550 : wordsMatch(q, text) ? 500 : 350;
        add({location, room: item.room, level: level.id, item: item.name, label: item.name, description: levelDescription(location, level)}, score);
      }
    }

    for (const room of location.rooms || []) {
      if (!normalize(room).includes(q) && identifier(q) !== identifier(room)) continue;
      const exact = identifier(q) === identifier(room);
      // The corresponding level result ranks above this flat legacy room entry.
      add({location, room, label: room, description: `Edificio ${buildingCode(location)} · ${location.name}`}, exact ? 900 : 400);
    }

    const services = location.services || [];
    const text = normalize([identity, ...services, location.category, location.id === 'H' ? 'doctor médico salud' : ''].join(' '));
    const identityMatch = wordsMatch(q, identity);
    if ((identityMatch || wordsMatch(q, text)) && (!matchedLevelItem || identityMatch)) {
      const detail = services.find(service => normalize(service).includes(q));
      add(buildingResult(location, detail), identityMatch ? 450 : 250);
    }
  }

  // A confirmed room in a level should appear once, not again from flat rooms.
  const seen = new Set();
  return ranked.sort((a, b) => b.score - a.score || a.order - b.order).filter(result => {
    const key = result.room ? `${result.location.id}:room:${identifier(result.room)}` : `${result.location.id}:${result.level || ''}:${normalize(result.item || result.label)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16).map(({score, order, ...result}) => result);
}

export function initSearch(locations, select, storage) {
  const input = document.querySelector('#search'), list = document.querySelector('#suggestions');
  let results = [], active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  function choose(index) {
    const result = results[index];
    if (!result) return;
    select(result.location.id, result.room, {level: result.level, item: result.item});
    storage.push('searches', {id: result.location.id, room: result.room, level: result.level, item: result.item, label: result.label});
    input.value = result.room || (result.level || result.item ? result.label : result.location.name);
    close();
    input.blur();
  }
  function recentResults() {
    return storage.get('searches').flatMap(recent => {
      const location = locations.find(place => place.id === recent.id);
      if (!location) return [];
      // Also recover the floor for an older saved room such as UP-15.
      const level = (location.levels || []).find(level => level.id === recent.level || recent.room && level.items?.some(item => identifier(item.room) === identifier(recent.room)));
      const item = level?.items?.find(item => item.name === recent.item || recent.room && identifier(item.room) === identifier(recent.room));
      return [{location, room: recent.room, level: level?.id, item: item?.name || recent.item, label: recent.label || recent.room || location.name, description: `Búsqueda reciente${level ? ' · ' + levelDescription(location, level) : ''}`}];
    });
  }
  function render() {
    active = -1;
    results = searchLocations(input.value, locations);
    list.replaceChildren();
    if (!input.value.trim()) {
      const heading = document.createElement('div');
      heading.className = 'search-heading';
      heading.innerHTML = '<span>BÚSQUEDAS RECIENTES</span><button type="button">Limpiar</button>';
      heading.querySelector('button').onclick = () => {storage.set('searches', []); render();};
      list.append(heading);
      results = recentResults();
    }
    results.forEach((result, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `suggestion-${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const title = document.createElement('b'); title.textContent = result.label;
      const description = document.createElement('span'); description.textContent = result.description;
      button.append(title, description);
      button.onclick = () => choose(index);
      list.append(button);
    });
    if (!results.length) {
      const message = document.createElement('p');
      message.textContent = input.value ? 'No encontramos coincidencias. Prueba un edificio o servicio.' : 'Tus próximas búsquedas aparecerán aquí.';
      list.append(message);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) render();
      if (!results.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('[role=option]').forEach((element, index) => {
        element.classList.toggle('active', index === active);
        element.setAttribute('aria-selected', index === active ? 'true' : 'false');
      });
      input.setAttribute('aria-activedescendant', `suggestion-${active}`);
      document.querySelector(`#suggestion-${active}`).scrollIntoView({block: 'nearest'});
    }
    if (event.key === 'Enter') {event.preventDefault(); choose(Math.max(0, active));}
    if (event.key === 'Escape') close();
  });
  document.addEventListener('pointerdown', event => {if (!event.target.closest('.search-wrap')) close();});
}

export const storage = {
  get(key) {try {return JSON.parse(localStorage.getItem('tec-' + key)) || [];} catch {return [];}},
  set(key, value) {try {localStorage.setItem('tec-' + key, JSON.stringify(value));} catch {}},
  push(key, item) {
    this.set(key, [item, ...this.get(key).filter(previous => previous.id !== item.id || previous.room !== item.room || previous.level !== item.level || previous.item !== item.item)].slice(0, 15));
  }
};
