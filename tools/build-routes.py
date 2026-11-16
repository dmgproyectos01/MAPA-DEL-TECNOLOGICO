"""Generate pedestrian connections from the traced reference paths, not a grid.
Run from the repository root. Uses only the Python standard library.
"""
import json,math
from pathlib import Path
locations=json.loads(Path('data/locations.json').read_text())
layout=json.loads(Path('data/map-layout.json').read_text())
obstacles=[l for l in locations if 'footprint' in l]
def sub(a,b):return(a[0]-b[0],a[1]-b[1])
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def hit(a,b,c,d):
 r,s=sub(b,a),sub(d,c);den=cross(r,s)
 if abs(den)<1e-9:return None
 t,u=cross(sub(c,a),s)/den,cross(sub(c,a),r)/den
 if -1e-7<=t<=1+1e-7 and -1e-7<=u<=1+1e-7:return [a[0]+r[0]*t,a[1]+r[1]*t]
 return None
def inside(p,polygon):
 result=False
 for a,b in zip(polygon,polygon[1:]+polygon[:1]):
  if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:result=not result
 return result
def closest(p,a,b):
 dx,dy=sub(b,a);den=dx*dx+dy*dy;t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den))if den else 0
 return[a[0]+t*dx,a[1]+t*dy]
def segdist(a,b,c,d):
 if hit(a,b,c,d)is not None:return 0
 return min(math.dist(a,closest(a,c,d)),math.dist(b,closest(b,c,d)),math.dist(c,closest(c,a,b)),math.dist(d,closest(d,a,b)))
def polygonhit(a,b,polygon):
 return inside(a,polygon)or inside(b,polygon)or any(hit(a,b,c,d)is not None for c,d in zip(polygon,polygon[1:]+polygon[:1]))
canal=list(zip(layout['canal'],layout['canal'][1:]))
crossings=[(a,b)for path in layout['crossings']for a,b in zip(path,path[1:])]
def bridge(a,b):return any(segdist(a,b,c,d)<15 for c,d in crossings)
def valid(a,b):
 if not inside(a,layout['land'])or not inside(b,layout['land']):return False
 if any(polygonhit(a,b,l['footprint'])for l in obstacles):return False
 if any(segdist(a,b,c,d)<8 for c,d in canal)and not bridge(a,b):return False
 return True
segments=[(a,b)for path in layout['walkways']for a,b in zip(path,path[1:])]
nodes={};edges=[];index={};edge_kinds={}
def add(p):
 p=[round(p[0],3),round(p[1],3)];key=tuple(p)
 if key not in index:index[key]=f'path-{len(index)}';nodes[index[key]]=p
 return index[key]
def connect(a,b,kind='walkway'):
 if a==b:return
 pair=[a,b]
 if pair not in edges and pair[::-1]not in edges:
  edges.append(pair);edge_kinds[tuple(sorted(pair))]=kind
for a,b in segments:
 cuts=[a,b]
 for c,d in segments:
  p=hit(a,b,c,d)
  if p is not None:cuts.append(p)
 cuts=sorted(cuts,key=lambda p:math.dist(p,a));unique=[]
 for p in cuts:
  if not unique or math.dist(p,unique[-1])>.05:unique.append(p)
 for c,d in zip(unique,unique[1:]):
  count=max(1,math.ceil(math.dist(c,d)/14));part=[[c[0]+(d[0]-c[0])*i/count,c[1]+(d[1]-c[1])*i/count]for i in range(count+1)]
  for p,q in zip(part,part[1:]):
   if valid(p,q):connect(add(p),add(q))
def components():
 adj={n:[]for n in nodes}
 for a,b in edges:adj[a].append(b);adj[b].append(a)
 left=set(nodes);groups=[]
 while left:
  stack=[min(left)];seen=set()
  while stack:
   n=stack.pop()
   if n in seen:continue
   seen.add(n);stack.extend(adj[n])
  left-=seen;groups.append(seen)
 return sorted(groups,key=lambda group:(-len(group),min(group)))
# Close tiny breaks at hand-traced intersections without adding a rectangular grid.
while True:
 groups=components()
 if len(groups)==1:break
 main=groups[0];best=None
 for group in groups[1:]:
  for a in sorted(main):
   for b in sorted(group):
    d=math.dist(nodes[a],nodes[b])
    if d>48 or (best and d>=best[0]):continue
    if polygonhit(nodes[a],nodes[b],layout['pedestrianCorrections']['protectedArea']):continue
    if valid(nodes[a],nodes[b]):best=(d,a,b)
 if best is None:break
 connect(best[1],best[2],'junction')
groups=components();main=groups[0]
print('Path components:',[(len(g),min(nodes[n][0]for n in g),min(nodes[n][1]for n in g),max(nodes[n][0]for n in g),max(nodes[n][1]for n in g))for g in groups])
nodes={n:p for n,p in nodes.items()if n in main};edges=[e for e in edges if all(n in main for n in e)]
base=dict(nodes)
for l in obstacles:
 options=[];p=l['footprint']
 for n,b in base.items():
  for c,d in zip(p,p[1:]+p[:1]):
   a=closest(b,c,d);dx,dy=sub(b,a);length=math.hypot(dx,dy)
   if length<1:continue
   door=[a[0]+dx/length*4,a[1]+dy/length*4]
   if valid(door,b):options.append((math.dist(door,b),n,door))
 if not options:raise ValueError('No pedestrian connection for '+l['id'])
 length,n,door=min(options);print('Door',l['id'],round(length))
 node='door-'+l['id'];nodes[node]=[round(v,3)for v in door];edges.append([node,n]);l['node']=node
for a in layout['accesses']:
 p=[a['x'],a['y']];options=[(math.dist(p,b),n)for n,b in base.items()if valid(p,b)]
 if not options:raise ValueError('No path from '+a['id'])
 _,n=min(options);nodes[a['id']]=p;connect(a['id'],n,'entrance')
bridges=[[nodes[a],nodes[b]]for a,b in edges if any(segdist(nodes[a],nodes[b],c,d)<8 for c,d in canal)]
graph=dict(nodes=nodes,edges=edges,edgeKinds=[edge_kinds.get(tuple(sorted(e)),'entrance')for e in edges],accesses=layout['accesses'],bridges=bridges,metersPerUnit=.7,approximate=True,source='Pedestrian paths traced from the user-provided campus reference image.')
Path('data/routes.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2))
Path('data/locations.json').write_text(json.dumps(locations,ensure_ascii=False,indent=2))
