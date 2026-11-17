import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchLocations, initSearch, storage, normalize} from '../js/search.js';

const locations = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url)));
const ua = locations.find(location => location.id === '6');
const up = locations.find(location => location.id === '7');
const professors = [
  'Flor de la Cruz Saida Lizárraga',
  'Carmen Guadalupe López Varela',
  'José Fernando Hernández Silva',
  'Leonel Ernesto Amabilis Sosa',
  'Modesto Guadalupe Medina Meléndrez',
  'Yaneth Alejandra Bustos Terrones',
  'David Enrique Castro Palazuelos',
  'Blenda Ramírez Pereda',
  'Guillermo Javier Rubio Astorga'
];
const laboratories = [
  'Instrumentación y Procesamiento de Señales',
  'Microbiología de Alimentos y Biología Molecular',
  'Bioprocesos y Análisis Ambientales',
  'Microbiología Molecular y Bioactivos',
  'Posgrado e Investigación en Ciencias Ambientales',
  'Cromatografía y Espectrometría'
];

function expectFloorItem(query, building, level, name) {
  const result = searchLocations(query, locations)[0];
  assert.ok(result, query);
  assert.equal(result.location.id, building, query);
  assert.equal(result.level, level, query);
  assert.equal(result.item, name, query);
  assert.equal(result.label, name, query);
  assert.match(result.description, new RegExp(`^${building === '6' ? 'UA' : 'UP'} · `));
  return result;
}

test('UA y UP conservan IDs estables, y sus códigos no se confunden con aulas o apellidos', () => {
  assert.equal(ua.code, 'UA');
  assert.equal(up.code, 'UP');
  for (const [query, id] of [['UA', '6'], ['UP', '7'], ['Unidad Academica', '6'], ['UNIDAD DE POSGRADO', '7']]) {
    const [result] = searchLocations(query, locations);
    assert.equal(result.location.id, id, query);
    assert.equal(result.level, undefined, 'Una búsqueda del edificio debe dejar el piso por defecto a la ficha');
  }
  assert.equal(searchLocations('ua', locations).length, 1);
  assert.equal(searchLocations('up', locations).length, 1);
});

test('UA contiene dos plantas, cantidades confirmadas y ningún código individual inventado', () => {
  assert.deepEqual(ua.levels.map(level => level.id), ['planta-baja', 'planta-alta']);
  assert.deepEqual(ua.levels.map(level => level.items.find(item => item.type === 'classrooms')?.count), [6, 3]);
  for (const level of ua.levels) {
    assert.equal(level.items.find(item => item.type === 'computer-room')?.count, 1);
    assert.ok(level.items.some(item => item.name === 'Baños'));
    assert.ok(level.items.every(item => !item.room));
  }
  assert.deepEqual(ua.rooms, []);
  expectFloorItem('ua 6 salones', '6', 'planta-baja', '6 salones');
  expectFloorItem('ua 3 salones', '6', 'planta-alta', '3 salones');
  expectFloorItem('MECATRONICA', '6', 'planta-baja', 'Laboratorio de Mecatrónica');
  const computers = searchLocations('UA salon con computadoras', locations);
  assert.deepEqual(computers.map(result => result.level), ['planta-baja', 'planta-alta']);
  assert.ok(computers.every(result => !result.room));
  const offices = searchLocations('Oficinas administrativas', locations);
  assert.ok(offices.some(result => result.location.id === '6' && result.level === 'planta-alta'));
});

test('UP-15 aparece una sola vez y abre primer piso, incluyendo variantes con espacios', () => {
  assert.deepEqual(up.rooms, ['UP-15']);
  for (const query of ['UP-15', 'up15', 'UP 15']) {
    const results = searchLocations(query, locations);
    assert.equal(results.length, 1, query);
    const result = expectFloorItem(query, '7', 'primer-piso', 'Aula UP-15');
    assert.equal(result.room, 'UP-15');
  }
  assert.deepEqual(searchLocations('UP-99', locations), []);
});

for (const laboratory of laboratories) {
  test(`El laboratorio ${laboratory} abre primer piso de UP`, () => {
    expectFloorItem(normalize(laboratory).toUpperCase(), '7', 'primer-piso', `Laboratorio de ${laboratory}`);
  });
}

test('Una consulta UP laboratorio prioriza solo sus seis laboratorios y no duplica servicios planos', () => {
  const results = searchLocations('UP laboratorio', locations);
  assert.equal(results.length, 6);
  assert.ok(results.every(result => result.location.id === '7' && result.level === 'primer-piso' && result.item));
  assert.equal(new Set(results.map(result => result.item)).size, 6);
});

test('El segundo piso de UP contiene ocho salones, incubadora, calidad y baños', () => {
  expectFloorItem('UP 8 salones', '7', 'segundo-piso', '8 salones');
  expectFloorItem('Incubadora de Software', '7', 'segundo-piso', 'Incubadora de Software');
  expectFloorItem('AREA DE CALIDAD', '7', 'segundo-piso', 'Área de Calidad');
  const level = up.levels.find(level => level.id === 'segundo-piso');
  assert.equal(level.items.find(item => item.type === 'classrooms')?.count, 8);
  assert.ok(level.items.some(item => item.name === 'Baños'));
});

for (const professor of professors) {
  test(`Buscar ${professor} abre su cubículo en tercer piso de UP`, () => {
    const result = searchLocations(normalize(professor).toUpperCase(), locations)[0];
    assert.equal(result.location.id, '7');
    assert.equal(result.level, 'tercer-piso');
    assert.ok(result.item.includes(professor));
    assert.ok(result.label.includes(professor));
    assert.equal(result.room, undefined);
  });
}

test('El tercer piso conserva el orden de cubículos indicado y sus espacios compartidos', () => {
  const level = up.levels.find(level => level.id === 'tercer-piso');
  assert.deepEqual(level.items.filter(item => item.type === 'cubicle').map(item => professors.find(name => item.name.endsWith(name))), professors);
  assert.equal(level.items.find(item => item.type === 'classrooms')?.count, 4);
  expectFloorItem('UP 4 salones', '7', 'tercer-piso', '4 salones');
  expectFloorItem('Sala de Usos Multiples', '7', 'tercer-piso', 'Sala de Usos Múltiples');
  expectFloorItem('Oficinas DEPI', '7', 'tercer-piso', 'Oficinas DEPI');
});

test('Se pueden buscar pisos completos sin seleccionar un espacio arbitrario', () => {
  for (const [query, id, level] of [['UA planta alta', '6', 'planta-alta'], ['UP segundo piso', '7', 'segundo-piso'], ['UP tercer piso', '7', 'tercer-piso']]) {
    const result = searchLocations(query, locations)[0];
    assert.equal(result.location.id, id);
    assert.equal(result.level, level);
    assert.equal(result.item, undefined);
  }
});

test('Las búsquedas de salones y las siete sugerencias E se conservan', () => {
  for (const room of ['EE01', 'EV01', 'ED01', 'EW04', 'EJ10', 'EH02', 'EVLE']) {
    const result = searchLocations(room, locations)[0];
    assert.equal(result.location.id, room[1]);
    assert.equal(result.room, room);
  }
  assert.equal(searchLocations('EÑ01', locations)[0].location.id, 'Ñ');
  assert.equal(searchLocations('Ñ', locations)[0].location.id, 'Ñ');
  assert.deepEqual(searchLocations('E', locations).map(result => result.label), ['EA01', 'ED01', 'EE01', 'EV01', 'EW01', 'EJ01', 'EH01']);
  assert.ok(searchLocations('a', locations).length <= 16);
});

// Small DOM fixture for the search-to-detail/history contract, without a browser dependency.
function withSearchFixture(run) {
  const original = globalThis.document;
  // initSearch reads the global only during fixture construction and interactions.
  class TemporaryElement {
    constructor() {this.children = []; this.listeners = {}; this.value = ''; this.classList = {toggle() {}};}
    addEventListener(name, fn) {this.listeners[name] = fn;}
    setAttribute(name, value) {this[name] = value;}
    removeAttribute(name) {delete this[name];}
    append(...children) {this.children.push(...children);}
    replaceChildren() {this.children = [];}
    querySelector() {return this.button ||= new TemporaryElement();}
    querySelectorAll() {return this.children.filter(child => child.role === 'option');}
    blur() {}
    scrollIntoView() {}
  }
  const input = new TemporaryElement(), list = new TemporaryElement(), saved = new Map(), selected = [];
  globalThis.document = {querySelector(selector) {return selector === '#search' ? input : selector === '#suggestions' ? list : list.children.find(child => '#' + child.id === selector);}, createElement() {return new TemporaryElement();}, addEventListener() {}};
  const memory = {get(key) {return saved.get(key) || [];}, set(key, value) {saved.set(key, value);}, push(key, item) {this.set(key, [item, ...this.get(key)]);}};
  try {initSearch(locations, (...args) => selected.push(args), memory); run({input, list, memory, selected});}
  finally {if (original === undefined) delete globalThis.document; else globalThis.document = original;}
}

test('Elegir UP-15 comunica piso a la ficha y lo restaura desde búsquedas recientes', () => {
  withSearchFixture(({input, list, memory, selected}) => {
    input.value = 'UP-15'; input.listeners.input(); list.children[0].onclick();
    assert.deepEqual(selected.at(-1), ['7', 'UP-15', {level: 'primer-piso', item: 'Aula UP-15'}]);
    assert.equal(input.value, 'UP-15');
    assert.equal(memory.get('searches')[0].level, 'primer-piso');
    input.value = ''; input.listeners.focus(); list.children[1].onclick();
    assert.deepEqual(selected.at(-1), ['7', 'UP-15', {level: 'primer-piso', item: 'Aula UP-15'}]);
  });
});

test('Elegir un servicio conserva su nombre y piso en el campo y en el historial', () => {
  withSearchFixture(({input, list, memory, selected}) => {
    input.value = 'incubadora'; input.listeners.input(); list.children[0].onclick();
    assert.equal(input.value, 'Incubadora de Software');
    assert.deepEqual(selected.at(-1), ['7', undefined, {level: 'segundo-piso', item: 'Incubadora de Software'}]);
    assert.equal(memory.get('searches')[0].item, 'Incubadora de Software');
    input.value = ''; input.listeners.focus(); list.children[1].onclick();
    assert.equal(input.value, 'Incubadora de Software');
    assert.equal(selected.at(-1)[2].level, 'segundo-piso');
  });
});

test('El historial local distingue el mismo espacio en pisos diferentes', () => {
  const original = globalThis.localStorage, values = new Map();
  globalThis.localStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  try {
    storage.push('searches', {id: '6', level: 'planta-baja', item: '1 salón con computadoras'});
    storage.push('searches', {id: '6', level: 'planta-alta', item: '1 salón con computadoras'});
    assert.equal(storage.get('searches').length, 2);
    storage.push('searches', {id: '6', level: 'planta-alta', item: '1 salón con computadoras'});
    assert.equal(storage.get('searches').length, 2);
  } finally {if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original;}
});
