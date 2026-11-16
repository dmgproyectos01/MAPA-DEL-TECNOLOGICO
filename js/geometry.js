export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function intersection(a, b, c, d) {
  const r = [b[0]-a[0], b[1]-a[1]], s = [d[0]-c[0], d[1]-c[1]], cross = (u,v) => u[0]*v[1]-u[1]*v[0], den = cross(r,s);
  if (Math.abs(den) < 1e-9) return null;
  const v = [c[0]-a[0],c[1]-a[1]], t = cross(v,s)/den, u = cross(v,r)/den;
  return t >= -1e-7 && t <= 1+1e-7 && u >= -1e-7 && u <= 1+1e-7 ? [a[0]+r[0]*t,a[1]+r[1]*t] : null;
}
export function segmentHitsPolygon(a,b,polygon) {
  return pointInPolygon(a,polygon) || pointInPolygon(b,polygon) || polygon.some((c,i) => intersection(a,b,c,polygon[(i+1)%polygon.length]));
}
