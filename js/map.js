export const NS = 'http://www.w3.org/2000/svg';
const points = polygon => polygon.map(p => p.join(',')).join(' ');
const line = path => `M${path.map(p => p.join(',')).join('L')}`;

export function campus(locations, layout) {
  return `<svg id="campus" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="Mapa del Instituto Tecnológico de Culiacán, trazado siguiendo la fotografía de referencia">
    <defs>
      <pattern id="parking" width="12" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(13)"><path d="M0 0v18h10V0" fill="none" stroke="#eef0db" stroke-width=".9"/></pattern>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx=".5" dy="2" stdDeviation="1.2" flood-color="#3a3c25" flood-opacity=".16"/></filter>
    </defs>
    <g id="world">
      <polygon class="campus-land" points="${points(layout.land)}"/>
      <polygon class="parking-land" points="${points(layout.parkingNorth)}"/>
      <polygon points="${points(layout.parkingNorth)}" fill="url(#parking)"/>
      ${layout.roads.map(path => `<path class="road" d="${line(path)}"/>`).join('')}
      ${layout.roads.slice(0,1).map(path => `<path class="road-center" d="${line(path)}"/>`).join('')}
      <path class="canal" d="${line(layout.canal)}"/>
      <g id="paths"></g>
      ${layout.plazas.map(p => `<polygon class="plaza" points="${points(p)}"/>`).join('')}
      <text class="terrain-label" transform="translate(494 266) rotate(13)">EXPLANADA</text>
      <text class="terrain-label" transform="translate(416 386) rotate(13)">EXPLANADA</text>
      <text class="terrain-label" transform="translate(674 217) rotate(13)">PLAZA CÍVICA</text>
      <text class="street" x="583" y="113">JUAN DE DIOS BÁTIZ 310 · PONIENTE</text>
      <text class="street" transform="translate(941 382) rotate(71)">PROL. AV. GRAL. ÁLVARO OBREGÓN</text>
      <g id="buildings">${locations.filter(l => l.footprint).map(building).join('')}</g>
      <g id="route-layer"></g><g id="access-layer"></g>
    </g>
  </svg>`;
}

function building(l) {
  const shape = l.id === 'FUT' ? football(l) : l.id === 'BAS' ? basketball(l) : l.id === 'BEI' ? baseball(l) : `<polygon class="building" points="${points(l.footprint)}"/>${l.category === 'estacionamientos' ? `<polygon points="${points(l.footprint)}" fill="url(#parking)"/>` : ''}`;
  const label = ({'1':'CÓMPUTO','I':'CENTRO DE INFORMACIÓN','L':'OFICINAS','L2':'ADMINISTRATIVAS','6':'UNIDAD ACADÉMICA','7':'UNIDAD DE POSGRADO','GA':'GIMNASIO AUDITORIO','BAS':'BALONCESTO','BEI':'BÉISBOL','FUT':'FÚTBOL Y ATLETISMO','V':'MECÁNICA','W':'MÁQUINAS-HERRAMIENTAS','EST1':'ESTACIONAMIENTO','EST2':'ESTACIONAMIENTO','EST3':'ESTACIONAMIENTO'})[l.id];
  const angle = ['FUT','BAS','BEI','EST1','EST2','EST3'].includes(l.id) ? 0 : l.angle;
  return `<g class="place ${l.category}" data-id="${l.id}" role="button" tabindex="0" aria-label="${l.id}: ${l.name}"><title>${l.name}</title>${shape}<g transform="translate(${l.x} ${l.y}) rotate(${angle})"><text class="building-code" y="${label ? 0 : 3}">${l.id}</text>${label ? `<text class="building-caption" y="${['FUT','BEI','BAS'].includes(l.id) ? 20 : 10}">${label}</text>${l.id === 'V' ? '<text class="building-caption" y="17">ELÉCTRICA</text>' : ''}` : ''}</g></g>`;
}
function football(l) {
  return `<g transform="translate(${l.x} ${l.y}) rotate(13)"><rect class="building athletics-track" x="-95" y="-137" width="190" height="274" rx="82"/><rect x="-78" y="-120" width="156" height="240" rx="68" fill="#94a94e"/><g stroke="#e8ecc4" fill="none" stroke-width="1.1"><rect x="-64" y="-107" width="128" height="214"/><path d="M-64 0H64M-35-107v33h70v-33M-35 107V74h70v33M-18-107v15h36v-15M-18 107V92h36v15"/><circle r="20"/></g></g>`;
}
function basketball(l) {
  return `<g transform="translate(${l.x} ${l.y}) rotate(13)"><rect class="building basketball-court" x="-52" y="-29" width="104" height="58"/><g fill="none" stroke="#f0e7c8" stroke-width=".9"><rect x="-49" y="-26" width="48" height="52"/><rect x="1" y="-26" width="48" height="52"/><circle cx="-25" r="10"/><circle cx="25" r="10"/><path d="M-49 0H49M-37-26v14h24v-14M13-26v14h24v-14M-37 26V12h24v14M13 26V12h24v14"/></g></g>`;
}
function baseball(l) {
  return `<polygon class="building baseball-field" points="${points(l.footprint)}"/><path d="M831 747L843 692L999 688L995 754Z" fill="#a9bd69"/><path d="M983 745L972 704L931 715L943 756Z" fill="#d7c494"/><path d="M986 747l-17-29-29 17 17 29z" fill="none" stroke="#eee8c6" stroke-width="1.5"/><circle cx="968" cy="734" r="8" fill="#ded2ae"/>`;
}
