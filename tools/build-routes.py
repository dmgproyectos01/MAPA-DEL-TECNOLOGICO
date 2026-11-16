from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
from scipy import ndimage
import json,math,heapq,hashlib,time,argparse,zlib
ROOT=Path('.')
parser=argparse.ArgumentParser(description='Extract routes from the exact raster walkway pixels; development dependencies: numpy, scipy, Pillow.')
parser.add_argument('--source',default='assets/mapa-campus-base-v2.webp')
parser.add_argument('--locations',default='data/locations.json')
parser.add_argument('--output-dir',default='data')
parser.add_argument('--debug-dir',default='work')
args=parser.parse_args()
SOURCE=Path(args.source);OUT=Path(args.output_dir);DEBUG=Path(args.debug_dir)
OUT.mkdir(parents=True,exist_ok=True);DEBUG.mkdir(parents=True,exist_ok=True)
SCALE=1720/4096
DOWNSAMPLE=2
start=time.time()
source=np.array(Image.open(SOURCE).convert('RGB'))
h,w,_=source.shape
crop_width=min(w,2620)
a=source[:,:crop_width].astype(np.int16)
# Exact source pigment and nearby anti-aliased/compressed pixels, excluding
# exterior white, building grey, grass and the blue drainage channel.
mask=(abs(a[:,:,0]-233)<=18)&(abs(a[:,:,1]-244)<=16)&(abs(a[:,:,2]-186)<=24)&(a[:,:,0]-a[:,:,2]>27)&(a[:,:,1]-a[:,:,0]>=-1)&(a[:,:,1]-a[:,:,0]<=25)
# Repair only very small fully enclosed compression holes, never a courtyard.
labels,count=ndimage.label(~mask)
areas=np.bincount(labels.ravel())
repair=(areas<=12);repair[0]=False
mask=mask|repair[labels]
# Beige explanadas are explicitly pedestrian floors, not gardens. Limit
# classification to these photographed courtyard rectangles and their pigment.
plazas=[{'id':'plaza-civica-floor','type':'visible-plaza','bbox':[1530,430,1685,590]}, {'id':'plaza-c-floor','type':'visible-plaza','bbox':[1090,565,1250,680]}, {'id':'plaza-west-f-floor','type':'visible-plaza','bbox':[890,830,1100,995]}]
plaza_color=(abs(a[:,:,0]-207)<=20)&(abs(a[:,:,1]-195)<=20)&(abs(a[:,:,2]-171)<=20)&(a[:,:,0]-a[:,:,1]>=3)&(a[:,:,1]-a[:,:,2]>=12)
for annotation in plazas:
 x1,y1,x2,y2=annotation['bbox'];mask[y1:y2,x1:x2]|=plaza_color[y1:y2,x1:x2]
# Only these photographed staircase markings may repair grey pigment stripes.
annotations=[
 {'id':'steps-b-library','type':'visible-stairs','bbox':[1238,478,1323,516]},
 {'id':'steps-plaza-west','type':'visible-stairs','bbox':[1630,535,1700,602]},
 {'id':'steps-plaza-east','type':'visible-stairs','bbox':[1715,545,1775,615]},
 {'id':'steps-north-n','type':'visible-stairs','bbox':[1765,590,1830,640]},
 {'id':'steps-offices','type':'visible-stairs','bbox':[1795,480,1870,540]},
]
annotations.extend(plazas)
closed=ndimage.binary_closing(mask,structure=np.ones((3,3)),iterations=2)
for annotation in [x for x in annotations if x['type']=='visible-stairs']:
 x1,y1,x2,y2=annotation['bbox'];mask[y1:y2,x1:x2]|=closed[y1:y2,x1:x2]
# Thin grey outline between two photographed cream plaza floors, not a wall.
# The connected floor is separated by a 1–2px printing border at source1610,414.
plaza_border=ndimage.binary_closing(mask,structure=np.ones((3,3)),iterations=2)
mask[390:445,1570:1640]|=plaza_border[390:445,1570:1640]
annotations.append({'id':'bronco-plaza-outline','type':'visible-plaza-threshold','bbox':[1570,390,1640,445],'note':'Borde gris fino impreso entre pisos crema contiguos.'})
# Explicit photographed stair centreline; grey rungs at x1306 extend beyond
# the first visual estimate of the small staircase bounding box.
stair_line=Image.new('L',(crop_width,h));ImageDraw.Draw(stair_line).line([(1255,487),(1311,500)],fill=255,width=5)
mask|=np.array(stair_line)>0
annotations[0]['sourcePixelPolyline']=[[1255,487],[1311,500]];annotations[0]['widthPixels']=5
# Facing ends of the visible UA bridge and the opposite pedestrian path.
# Only grey avenue pixels inside a 9px band can be added, never blue or grass.
road=Image.new('L',(crop_width,h));rd=ImageDraw.Draw(road)
road_points=[(1301,1481),(1325,1451)]
rd.line(road_points,fill=255,width=9)
road_zone=np.array(road)>0
gray_avenue=(a[:,:,0]>=90)&(a[:,:,0]<=215)&(a[:,:,1]>=105)&(a[:,:,1]<=230)&(a[:,:,2]>=90)&(a[:,:,2]<=215)&(abs(a[:,:,1]-a[:,:,0])<=35)&(a[:,:,1]-a[:,:,2]<=45)
added_road=road_zone&gray_avenue
mask|=added_road
# The printed orange Z pin occludes 13.4 source pixels of the same walkway.
# This 3px band stays above the roof, with endpoints on verified cream floors.
symbol_image=Image.new('L',(crop_width,h));ImageDraw.Draw(symbol_image).line([(1618,1680),(1630,1674)],fill=255,width=3)
symbol_zone=np.array(symbol_image)>0
mask|=symbol_zone

annotations.append({'id':'ua-facing-avenue-crossing','type':'provisional-road-crossing','sourcePixelPolyline':road_points,'widthPixels':9,'note':'Cruce corto de avenida entre puente visible y pasillo enfrentado; por confirmar en campo.'})
annotations.append({'id':'z-marker-occlusion','type':'provisional-symbol-occlusion','sourcePixelPolyline':[[1618,1680],[1630,1674]],'widthPixels':3,'note':'Paso oculto por el marcador Z en el plano; conexión aproximada por confirmar.'})
visible_bridges=[{'id':'ua-canal-bridge','type':'visible-bridge','sourcePixelPolyline':[[1234,1513],[1301,1481]],'widthPixels':17}]
maskfile=OUT/'navigation-mask.bin'
maskfile.write_bytes(zlib.compress(np.packbits(mask.ravel()).tobytes(),9))
# The pale upper zone is explicitly labelled JARDINES in the source. Keep
# only its perimeter routes and exclude the labelled garden core.
mask[340:383,1357:1550]=False
annotations.append({'id':'upper-garden-exclusion','type':'excluded-garden','bbox':[1357,340,1550,383]})
# Rewrite after exclusions so the CI bitset matches the final mask exactly.
maskfile.write_bytes(zlib.compress(np.packbits(mask.ravel()).tobytes(),9))
Image.fromarray((mask*255).astype('uint8')).save(DEBUG/'raster-walkway-mask.png')
# Prefer image centre pixels. Every final segment is validated against full mask.
small=mask[1::DOWNSAMPLE,1::DOWNSAMPLE]
labels,count=ndimage.label(small,np.ones((3,3),int));areas=np.bincount(labels.ravel());areas[0]=0
print('Cream components',sorted(areas[1:].tolist(),reverse=True)[:20],flush=True)
# Retain components large enough to be actual paths; disconnected components
# are not automatically bridged across roads or the canal.
small=small&(areas[labels]>=18)

def thin(img):
 img=np.pad(img.astype(np.uint8),1)
 while True:
  changed=False
  for phase in (0,1):
   p=img[1:-1,1:-1];p2=img[:-2,1:-1];p3=img[:-2,2:];p4=img[1:-1,2:];p5=img[2:,2:];p6=img[2:,1:-1];p7=img[2:,:-2];p8=img[1:-1,:-2];p9=img[:-2,:-2]
   ns=(p2,p3,p4,p5,p6,p7,p8,p9);n=sum(ns);trans=sum(((ns[i]==0)&(ns[(i+1)%8]==1)).astype(np.uint8)for i in range(8))
   if phase==0:c1=p2*p4*p6==0;c2=p4*p6*p8==0
   else:c1=p2*p4*p8==0;c2=p2*p6*p8==0
   remove=(p==1)&(n>=2)&(n<=6)&(trans==1)&c1&c2
   if remove.any():p[remove]=0;changed=True
  if not changed:return img[1:-1,1:-1].astype(bool)
skeleton=thin(small)
print('Skeleton pixels',int(skeleton.sum()),'elapsed',round(time.time()-start,1),flush=True)
Image.fromarray((skeleton*255).astype('uint8')).save(DEBUG/'raster-walkway-skeleton.png')

def sourcept(p):return(p[0]*DOWNSAMPLE+1,p[1]*DOWNSAMPLE+1)
def valid_line(p,q):
 # Exact nearest-pixel supercover: test every crossed pixel cell and boundary,
 # rather than assuming one sampling density proves a different CI density.
 ts=[0.,1.]
 for axis in (0,1):
  delta=q[axis]-p[axis]
  if abs(delta)<1e-12:continue
  low,high=sorted([p[axis],q[axis]])
  for boundary in np.arange(math.floor(low)+.5,high+.5,1):
   t=(boundary-p[axis])/delta
   if 0<t<1:ts.append(t)
 ts=sorted(set(ts));samples=ts+[(a+b)/2 for a,b in zip(ts,ts[1:])]
 for t in samples:
  xx=p[0]+(q[0]-p[0])*t;yy=p[1]+(q[1]-p[1])*t
  # At a half-pixel boundary both nearest cells are required. At a corner
  # require all four, so Python ties-to-even, JS ties-up and floating-point
  # perturbations cannot select an unvalidated neighbouring pixel.
  xs=[math.floor(xx+.5)];ys=[math.floor(yy+.5)]
  if abs((xx-math.floor(xx))-.5)<1e-9:xs=[math.floor(xx),math.ceil(xx)]
  if abs((yy-math.floor(yy))-.5)<1e-9:ys=[math.floor(yy),math.ceil(yy)]
  for x in xs:
   for y in ys:
    if x<0 or x>=mask.shape[1]or y<0 or y>=mask.shape[0]or not mask[y,x]:return False
 return True

pts={(int(x),int(y))for y,x in np.argwhere(skeleton)}
adj={p:set()for p in pts}
for p in pts:
 x,y=p
 for dx,dy in [(1,0),(0,1),(1,1),(-1,1)]:
  q=(x+dx,y+dy)
  if q not in pts:continue
  # Drop redundant diagonals inside a 2x2 corner to reduce junction cliques.
  # Prune a redundant diagonal only when the complete orthogonal alternative
  # is present and source-mask-valid, preserving staircase connectivity.
  if dx and dy:
   corners=[(x+dx,y),(x,y+dy)]
   if any(r in pts and valid_line(sourcept(p),sourcept(r))and valid_line(sourcept(r),sourcept(q))for r in corners):continue
  if valid_line(sourcept(p),sourcept(q)):adj[p].add(q);adj[q].add(p)
# Classify actual connected paths. Keep all useful components for destination
# matching; routing honestly reports lack of a connected origin when needed.
groups=[];left=set(pts)
while left:
 seed=min(left);stack=[seed];group=set()
 while stack:
  p=stack.pop()
  if p in group:continue
  group.add(p);stack.extend(adj[p]-group)
 left-=group;groups.append(group)
groups.sort(key=lambda g:-len(g))
print('Skeleton components',[len(g)for g in groups[:20]],flush=True)
# Remove tiny isolated markings and text-like fragments.
keep=set().union(*(g for g in groups if len(g)>=25))
adj={p:adj[p]&keep for p in keep}
# Degree-2 chains become polylines; simplify only with a line wholly in the
# source path mask, so turns around buildings cannot be shortcut through grass.
key={p for p in keep if len(adj[p])!=2}
for g in groups:
 g=g&keep
 if g and not g&key:key.add(min(g))
visited=set();chains=[]
for p in sorted(key):
 for q in sorted(adj[p]):
  edge=frozenset((p,q))
  if edge in visited:continue
  visited.add(edge);chain=[p,q];prev,cur=p,q
  while cur not in key:
   nxt=next(iter(adj[cur]-{prev}));visited.add(frozenset((cur,nxt)));chain.append(nxt);prev,cur=cur,nxt
  chains.append(chain)
# Greedy centreline-aware simplification, maximum 24 source pixels per link.
segments=[]
for chain in chains:
 i=0
 while i<len(chain)-1:
  j=i+1
  while j+1<len(chain)and math.dist(sourcept(chain[i]),sourcept(chain[j+1]))<=24 and valid_line(sourcept(chain[i]),sourcept(chain[j+1])):j+=1
  segments.append((chain[i],chain[j]));i=j
nodes={};idx={};edges=[]
def add(p):
 if p not in idx:
  name='raster-'+str(len(idx));idx[p]=name;sp=sourcept(p);nodes[name]=[sp[0]*SCALE,sp[1]*SCALE]
 return idx[p]
for p,q in segments:
 if p==q:continue
 a,b=add(p),add(q)
 if[a,b]not in edges and[b,a]not in edges:edges.append([a,b])
# Skeletonization may leave two centreline branches disconnected at a tight
# corner. Rejoin only through an explicit 4-neighbour path in the SAME full-
# resolution authorized mask component; no pixel is added to the mask here.
from scipy.spatial import cKDTree
full_components,_=ndimage.label(mask)
def graph_groups():
 ga={n:set()for n in nodes}
 for aa,bb in edges:ga[aa].add(bb);ga[bb].add(aa)
 remaining=set(nodes);gg=[]
 while remaining:
  stack=[min(remaining)];group=set()
  while stack:
   n=stack.pop()
   if n in group:continue
   group.add(n);stack.extend(ga[n]-group)
  remaining-=group;gg.append(group)
 return sorted(gg,key=lambda x:-len(x))
def pixel(n):return tuple(int(round(v/SCALE))for v in nodes[n])
def astar(p,q):
 pad=20;x1=max(0,min(p[0],q[0])-pad);x2=min(crop_width-1,max(p[0],q[0])+pad);y1=max(0,min(p[1],q[1])-pad);y2=min(h-1,max(p[1],q[1])+pad)
 queue=[(math.dist(p,q),0,p)];dist={p:0};prev={}
 while queue:
  _,d,u=heapq.heappop(queue)
  if d!=dist[u]:continue
  if u==q:
   path=[u]
   while path[-1]!=p:path.append(prev[path[-1]])
   return path[::-1]
  for dx,dy in[(1,0),(-1,0),(0,1),(0,-1)]:
   v=(u[0]+dx,u[1]+dy)
   if not(x1<=v[0]<=x2 and y1<=v[1]<=y2)or not mask[v[1],v[0]]:continue
   nd=d+1
   if nd<dist.get(v,1e99):dist[v]=nd;prev[v]=u;heapq.heappush(queue,(nd+math.dist(v,q),nd,v))
 return None
repairs=0
while True:
 gg=graph_groups();main=gg[0];tree=cKDTree([pixel(n)for n in sorted(main)]);mainlist=sorted(main);best=None
 for group in gg[1:]:
  gl=sorted(group);ds,inds=tree.query([pixel(n)for n in gl])
  for k in np.argsort(ds)[:12]:
   if ds[k]>50:break
   aa,bb=gl[int(k)],mainlist[int(inds[k])];p,q=pixel(aa),pixel(bb)
   if full_components[p[1],p[0]]!=full_components[q[1],q[0]]:continue
   path=astar(p,q)
   if path is not None and(best is None or len(path)<len(best[2])):best=(aa,bb,path)
 if best is None:break
 aa,bb,path=best;previous=aa
 for point in path[1:-1]:
  n='repair-'+str(repairs);repairs+=1;nodes[n]=[point[0]*SCALE,point[1]*SCALE];edges.append([previous,n]);previous=n
 edges.append([previous,bb])
print('Full-mask centreline corner repair nodes',repairs,flush=True)
# Route portals are attached only to cream pixels at the nearest visible edge;
# no segment is allowed to cross a building polygon or other non-walkway area.
locpath=Path(args.locations)
if not locpath.exists():
 print('Waiting for calibrated locations; writing raw graph.',flush=True)
 raise FileNotFoundError('Calibrated locations file required: '+str(locpath))
else:locations=json.loads(locpath.read_text())
# Graph components in reduced nodes for accessibility diagnostics.
graph_adj={n:[]for n in nodes}
for aa,bb in edges:graph_adj[aa].append(bb);graph_adj[bb].append(aa)
components={};cid=0
for n in nodes:
 if n in components:continue
 stack=[n]
 while stack:
  u=stack.pop()
  if u in components:continue
  components[u]=cid;stack.extend(graph_adj[u])
 cid+=1
# Destination matching uses footprint proximity, not a straight line from centre.
def closest(p,a,b):
 dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den))if den else 0
 return[a[0]+dx*t,a[1]+dy*t]
# Origin anchors are on the first visible cream path inside pedestrian gates.
# A vehicle gate has no connected cream path in the source and remains pending.
origins=[('access-computo','Centro de Cómputo · entrada/salida vehicular',[284,128]),('access-sistemas','Sistemas · entrada peatonal',[476,132]),('access-bronco','Plaza del Bronco · entrada/salida peatonal',[682,143]),('access-civica','Plaza Cívica · entrada peatonal',[776,165])]
accesses=[];reachable=set()
for id,name,p in origins:
 if id=='access-computo':
  accesses.append({'id':id,'name':name,'x':p[0],'y':p[1],'routeStatus':'access-unconfirmed','note':'Conexión desde acceso vehicular a pasillo peatonal por confirmar.'});continue
 candidates=sorted((math.dist(p,q),n,q)for n,q in nodes.items())
 d,n,q=candidates[0]
 if d>15:
  accesses.append({'id':id,'name':name,'x':p[0],'y':p[1],'routeStatus':'access-unconfirmed'});continue
 accesses.append({'id':id,'name':name,'x':q[0],'y':q[1],'node':n,'routeStatus':'confirmed-path','approximate':True})
 nodes[id]=list(q);edges.append([id,n]);components[id]=components[n];reachable.add(components[n])
portal_report=[]
for l in locations:
 l.pop('node',None);l.pop('routePortal',None)
 if not l.get('footprint'):continue
 poly=l['footprint'];candidates=[]
 for n,p in nodes.items():
  if components[n]not in reachable:continue
  d=min(math.dist(p,closest(p,a,b))for a,b in zip(poly,poly[1:]+poly[:1]))
  if d<=18:candidates.append((d,n,p))
 if candidates:
  d,n,p=min(candidates);l['node']=n;l['routeStatus']='confirmed-path';l['routePortal']={'x':p[0],'y':p[1],'approximate':True};portal_report.append({'id':l['id'],'node':n,'distanceFromBuilding':round(d,2),'component':components[n]})
 else:l['routeStatus']='access-unconfirmed';l['routePending']='Acceso peatonal conectado por confirmar';portal_report.append({'id':l['id'],'pending':True})
# Validate every exported edge directly against the source mask.
errors=[]
for a,b in edges:
 p=[v/SCALE for v in nodes[a]];q=[v/SCALE for v in nodes[b]]
 if not valid_line(p,q):errors.append([a,b])
if errors:raise ValueError('Invalid exported edges: '+str(errors[:5]))
graph={'nodes':nodes,'edges':edges,'accesses':accesses,'bridges':[],'metersPerUnit':.7,'approximate':True,'source':'Skeleton of cream pedestrian paths in the exact official source raster','sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'maskSha256':hashlib.sha256(maskfile.read_bytes()).hexdigest(),'validatedPixelEdges':len(edges),'components':components,'navigationMask':{'file':'data/navigation-mask.bin','encoding':'zlib+packed-msb','width':crop_width,'height':h,'unitsPerPixel':SCALE},'annotations':annotations,'visibleBridges':visible_bridges}
edge_annotations={}
for aa,bb in edges:
 p=[v/SCALE for v in nodes[aa]];q=[v/SCALE for v in nodes[bb]]
 count=max(1,math.ceil(math.dist(p,q)*2.5));xx=np.rint(np.linspace(p[0],q[0],count+1)).astype(int);yy=np.rint(np.linspace(p[1],q[1],count+1)).astype(int)
 if added_road[yy,xx].any():edge_annotations.setdefault('|'.join(sorted([aa,bb])),[]).append('ua-facing-avenue-crossing')
 if symbol_zone[yy,xx].any():edge_annotations.setdefault('|'.join(sorted([aa,bb])),[]).append('z-marker-occlusion')
bridge_image=Image.new('L',(crop_width,h));bd=ImageDraw.Draw(bridge_image)
for annotation in visible_bridges:bd.line([tuple(p)for p in annotation['sourcePixelPolyline']],fill=255,width=annotation['widthPixels'])
bridge_mask=np.array(bridge_image)>0
for aa,bb in edges:
 p=[v/SCALE for v in nodes[aa]];q=[v/SCALE for v in nodes[bb]]
 count=max(1,math.ceil(math.dist(p,q)*2.5));xx=np.rint(np.linspace(p[0],q[0],count+1)).astype(int);yy=np.rint(np.linspace(p[1],q[1],count+1)).astype(int)
 if bridge_mask[yy,xx].any():
  edge_annotations.setdefault('|'.join(sorted([aa,bb])),[]).append('ua-canal-bridge');graph['bridges'].append([nodes[aa],nodes[bb]])
graph['edgeAnnotations']=edge_annotations
(OUT/('raster-routes.json' if OUT.name=='work' else 'routes.json')).write_text(json.dumps(graph,ensure_ascii=False,indent=2))
(OUT/('routed-locations.json' if OUT.name=='work' else 'locations.json')).write_text(json.dumps(locations,ensure_ascii=False,indent=2))
(DEBUG/'raster-portals-report.json').write_text(json.dumps(portal_report,ensure_ascii=False,indent=2))
# Raster debug overlay only; production never paints paths over the source.
overlay=Image.fromarray(source[:,:crop_width].copy()).convert('RGBA');draw=ImageDraw.Draw(overlay)
for a,b in edges:
 p=[v/SCALE for v in nodes[a]];q=[v/SCALE for v in nodes[b]];draw.line([tuple(p),tuple(q)],fill=(255,0,180,255),width=3)
for l in locations:
 if l.get('routePortal'):
  x,y=l['routePortal']['x']/SCALE,l['routePortal']['y']/SCALE;draw.ellipse((x-8,y-8,x+8,y+8),fill=(255,80,0,255))
overlay.save(DEBUG/'raster-routes-debug.png')
print('Exported',len(nodes),'nodes',len(edges),'edges; mask validation PASS;',round(time.time()-start,1),'seconds',flush=True)
print('Portal report',portal_report,flush=True)
