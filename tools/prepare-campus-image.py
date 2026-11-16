"""Losslessly crop the supplied campus image; never redraw or resample its pixels.
Usage: python tools/prepare-campus-image.py path/to/original.png
"""
from pathlib import Path
import hashlib,json,sys
from PIL import Image,ImageDraw
import numpy as np
from scipy import ndimage
source=Path(sys.argv[1]);im=Image.open(source).convert('RGB')
assert im.size==(4096,2212),'Source dimensions differ; review registration before proceeding.'
scale=1720/4096
crop=(0,0,2620,2212)
# Only white space / right legend is removed along the campus's diagonal edge.
# This mask does not touch the campus, sports fields, compass or access labels.
clip=[[0,0],[900,0],[900,130],[905,175],[920,225],[940,275],[960,325],[980,380],[1000,435],[1020,500],[1016,550],[1040,650],[1070,750],[1092,810],[1092,929],[0,929]]
base=im.crop(crop).convert('RGBA');alpha=Image.new('L',base.size,0);ImageDraw.Draw(alpha).polygon([(round(x/scale),round(y/scale))for x,y in clip],fill=255)
# The largest non-white component is the complete connected campus footprint.
a=np.asarray(im);foreground=(a.min(axis=2)<245);components,count=ndimage.label(foreground);sizes=np.bincount(components.ravel());sizes[0]=0;campus=components==sizes.argmax();outside=np.ones(campus.shape,dtype=bool);outside[:crop[3],:crop[2]]=np.asarray(alpha)==0
assert not (campus&outside).any(),'Crop would remove campus pixels.'
base.putalpha(alpha);target=Path('assets/mapa-campus-base-v1.webp');base.save(target,'WEBP',lossless=True,method=6,exact=True)
back=Image.open(target).convert('RGBA');visible=np.asarray(alpha)>0
assert np.array_equal(np.asarray(back)[visible],np.asarray(base)[visible]),'Image encoding changed visible pixels.'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
metadata=dict(version=1,image=target.name,source={'url':'https://raw.githubusercontent.com/Serpens55/ChatbotPrueba2/94c1ce3c9188efc874408d85c617e26f739b0510/static/img/mapa.png','sha256':sha(source),'width':4096,'height':2212},crop=list(crop),clip=clip,pixelsPerSvgUnit=1/scale,width=base.width*scale,height=base.height*scale,assetSha256=sha(target),encoding='WebP lossless; original visible RGB and alpha pixels verified after decoding.',campusPixelsRemoved=0)
Path('assets/mapa-campus-base.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
print(json.dumps({'asset':str(target),'bytes':target.stat().st_size,'viewBox':[0,0,metadata['width'],metadata['height']],'campusPixelsRemoved':0}))
