import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterStudentServices, safeServiceUrl} from '../js/student-services.js';
import {searchLocations} from '../js/search.js';
const {services} = JSON.parse(readFileSync(new URL('../data/student-services.json', import.meta.url)));
const locations = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url)));

test('La guía encuentra personas y trámites sin acentos y respeta la categoría', () => {
  assert.equal(filterStudentServices(services, 'ALMA LORENA')[0].id, 'psicologia-lorena');
  assert.equal(filterStudentServices(services, 'evaluacion vocacional')[0].id, 'evaluacion-vocacional');
  assert.equal(filterStudentServices(services, 'Lorena', 'Trámites').length, 0);
});
test('Las dos atenciones psicológicas conservan sus citas y ubicaciones distintas', () => {
  const lorena = services.find(service => service.id === 'psicologia-lorena');
  const misael = services.find(service => service.id === 'psicologia-misael');
  assert.equal(lorena.links[0].url, 'https://psicologa-lorena.youcanbook.me/');
  assert.equal(misael.links[0].url, 'https://misael-burgos.youcanbook.me/');
  assert.match(lorena.sections.find(section => section.title === 'Dónde acudir').text, /Desarrollo Académico/);
  const result = searchLocations('Alma Lorena', locations)[0];
  assert.equal(result.location.id, 'PSIL');
  assert.equal(result.location.buildingId, undefined);
  assert.equal(result.location.node, undefined);
  assert.equal(result.location.footprint, undefined);
});
test('Los destinos de la guía existen y no hay IDs duplicados', () => {
  assert.equal(new Set(services.map(service => service.id)).size, services.length);
  for (const service of services) {
    if (service.locationId) assert.ok(locations.some(location => location.id === service.locationId));
    for (const link of service.links) assert.equal(safeServiceUrl(link.url), link.url);
    assert.ok(service.source.label);
  }
});
test('Los enlaces de servicios rechazan ejecución de código y credenciales', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,abc', '//example.com', 'https://user:password@example.com', 'http://example.com']) assert.equal(safeServiceUrl(url), null);
});

test('La guía encuentra trámites oficiales y documentos por su nombre', () => {
  for (const [query, id] of [['servicio social','servicio-social'], ['residencias profesionales','residencias'], ['kárdex','control-escolar'], ['THONA','seguro-thona'], ['IMSS','seguro-imss'], ['AMBAR','ambar'], ['convalidación 2009','reglamentos'], ['evaluación agosto 2015','reglamentos']]) {
    assert.ok(filterStudentServices(services, query).some(service => service.id === id), query);
  }
  const official = services.filter(service => service.source.type === 'official');
  assert.ok(official.length >= 20);
  for (const service of official) {
    assert.equal(new URL(service.source.url).hostname, 'www.culiacan.tecnm.mx');
    assert.match(service.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});
test('Los avisos por semestre y los programas antiguos muestran su periodo', () => {
  for (const id of ['calendario','cuotas']) assert.match(services.find(service => service.id === id).title, /2026/);
  assert.match(services.find(service => service.id === 'idiomas').sections.find(section => section.title === 'Inscripciones').text, /2023/);
  assert.match(services.find(service => service.id === 'financieros').sections[0].text, /2023/);
});
test('La información dental del cartel oficial se asocia al edificio H sin añadir polígonos', () => {
  const dentist = locations.find(location => location.id === 'DEN');
  assert.equal(dentist.buildingId, 'H');
  assert.equal(dentist.footprint, undefined);
  assert.equal(dentist.studentServiceId, 'medico');
});
