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
