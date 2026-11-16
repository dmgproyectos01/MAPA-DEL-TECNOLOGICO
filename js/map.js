// The source image is the only visual campus layer. These polygons are hit areas,
// never replacements for the roads, buildings, vegetation or sports in the image.
export const NS = 'http://www.w3.org/2000/svg';
export function campus(locations, layout) {
  const base = layout.base;
  return `<svg id="campus" viewBox="0 0 ${base.width} ${base.height}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa original del Instituto Tecnológico de Culiacán con zonas interactivas">
    <g id="world">
      <image id="campus-base" href="assets/${base.image}" x="0" y="0" width="${base.width}" height="${base.height}" preserveAspectRatio="xMidYMid meet" pointer-events="none"><title>Plano original del campus, sin la leyenda lateral</title></image>
      <g id="hotspots">${locations.filter(l => l.footprint).map(l => `<g class="place hotspot ${l.category}" data-id="${l.id}" role="button" tabindex="0" aria-label="${l.id}: ${l.name}"><title>${l.name}</title><polygon class="hotspot-shape" points="${l.footprint.map(p => p.join(',')).join(' ')}"/></g>`).join('')}</g>
      <g id="route-layer" pointer-events="none"></g><g id="access-layer"></g>
    </g>
  </svg>`;
}
