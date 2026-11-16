import json,math
from pathlib import Path
ls=json.loads(Path('data/locations.json').read_text())
obstacles=[l for l in ls if 'x'in l]
canal=[(220,100),(300,250),(320,430),(365,475),(420,490),(480,575),(550,720),(620,770),(760,805),(900,795),(1020,650),(1110,620)]
def cross(a,b,c,d):
 def ori(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 return ori(a,b,c)*ori(a,b,d)<0 and ori(c,d,a)*ori(c,d,b)<0
def recthit(a,b,l,pad=3):
 xmin,xmax=l['x']-l['w']/2-pad,l['x']+l['w']/2+pad
 ymin,ymax=l['y']-l['h']/2-pad,l['y']+l['h']/2+pad
 dx,dy=b[0]-a[0],b[1]-a[1];lo,hi=0,1
 for p,q in [(-dx,a[0]-xmin),(dx,xmax-a[0]),(-dy,a[1]-ymin),(dy,ymax-a[1])]:
  if p==0:
   if q<0:return False
  else:
   t=q/p
   if p<0:lo=max(lo,t)
   else:hi=min(hi,t)
 return lo<=hi
bridges=[]
def clear(a,b,ignore=None,bridge=False):
 if any(recthit(a,b,l) for l in obstacles if l['id']!=ignore):return False
 if not bridge and any(cross(a,b,c,d) for c,d in zip(canal,canal[1:])):return False
 return True
nodes={};edges=[];xs=[285,390,590,775,900,1030];ys=[120,225,310,375,440,505,580,685,760,860,935]
for i,x in enumerate(xs):
 for j,y in enumerate(ys):
  if x <= 850+(y-100)*.36 and not any(abs(x-l['x'])<=l['w']/2+3 and abs(y-l['y'])<=l['h']/2+3 for l in obstacles):nodes[f'{i}-{j}']=[x,y]
for i,x in enumerate(xs):
 for j,y in enumerate(ys):
  a=f'{i}-{j}'
  for b in [f'{i+1}-{j}',f'{i}-{j+1}']:
   if a not in nodes or b not in nodes:continue
   bridge=((y==580 and i==1) or (y==760 and i==2)) and b==f'{i+1}-{j}'
   if clear(nodes[a],nodes[b],bridge=bridge):
    edges.append([a,b])
    if bridge:bridges.append([nodes[a],nodes[b]])
# Additional walkway around Metal-Mecánica and a provisional canal crossing.
nodes['detour-n']=[750,580];nodes['detour-s']=[750,685]
nodes['north-spine']=[720,120];nodes['north-link']=[720,310]
for a,b,bridge in [('2-0','north-spine',False),('north-spine','north-link',False),('north-link','3-2',False),('2-6','detour-n',False),('detour-n','detour-s',False),('detour-s','3-7',False),('2-7','2-8',True)]:
 if a in nodes and b in nodes and clear(nodes[a],nodes[b],bridge=bridge):
  edges.append([a,b])
  if bridge:bridges.append([nodes[a],nodes[b]])
# Retain the connected central network.
adj={n:[] for n in nodes}
for a,b in edges:adj[a].append(b);adj[b].append(a)
seen=set();stack=['2-5']
while stack:
 n=stack.pop()
 if n in seen:continue
 seen.add(n);stack+=adj[n]
nodes={n:p for n,p in nodes.items() if n in seen};edges=[e for e in edges if all(n in seen for n in e)]
base=dict(nodes)

for l in obstacles:
 options=[]
 for n,b in base.items():
  dx,dy=b[0]-l['x'],b[1]-l['y']; t=min((l['w']/2+4)/abs(dx) if dx else 1e9,(l['h']/2+4)/abs(dy) if dy else 1e9)
  a=[l['x']+dx*t,l['y']+dy*t]
  if clear(a,b,l['id']):options.append((math.dist(a,b),n,a))
 if not options:raise Exception('No path for '+l['id'])
 _,n,a=min(options);nodes['door-'+l['id']]=a;edges.append(['door-'+l['id'],n]);l['node']='door-'+l['id']
accesses=[dict(id='access-computo',name='Centro de Cómputo · entrada/salida vehicular',x=280,y=90),dict(id='access-sistemas',name='Sistemas · entrada peatonal',x=480,y=100),dict(id='access-bronco',name='Plaza del Bronco · entrada/salida peatonal',x=685,y=100),dict(id='access-civica',name='Plaza Cívica · entrada peatonal',x=800,y=105)]
for a in accesses:
 p=[a['x'],a['y']];options=[(math.dist(p,b),n) for n,b in base.items() if clear(p,b)]
 if not options:raise Exception('Access disconnected')
 _,n=min(options);nodes[a['id']]=p;edges.append([a['id'],n])
Path('data/routes.json').write_text(json.dumps(dict(nodes=nodes,edges=edges,accesses=accesses,bridges=bridges,metersPerUnit=.7,approximate=True),ensure_ascii=False,indent=2))
Path('data/locations.json').write_text(json.dumps(ls,ensure_ascii=False,indent=2))
