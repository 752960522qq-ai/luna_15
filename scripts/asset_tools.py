"""Small offline GLB helpers for supplied clothing, city and citizen assets."""
import copy, functools, hashlib, io, json, struct
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

TYPES={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
WIDTH={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read(path):
 b=Path(path).read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def array(g,b,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];dtype=np.dtype(TYPES[a['componentType']]);w=WIDTH[a['type']]
 out=np.ndarray((a['count'],w),dtype=dtype,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dtype.itemsize*w),dtype.itemsize)).copy()
 if a.get('normalized') and dtype.kind in 'ui':out=out.astype(float)/np.iinfo(dtype).max
 return out
def matrix(n):
 if 'matrix' in n:return np.array(n['matrix']).reshape(4,4).T
 m=np.eye(4);m[:3,:3]=Rotation.from_quat(n.get('rotation',[0,0,0,1])).as_matrix()@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
def worlds(g):
 parents={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])}
 @functools.lru_cache(None)
 def w(i):return (w(parents[i]) if i in parents else np.eye(4))@matrix(g['nodes'][i])
 return [w(i) for i in range(len(g['nodes']))],parents
def points(p,m):return p@m[:3,:3].T+m[:3,3]
def normals(p,m):
 n=p@np.linalg.inv(m[:3,:3]);return n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
class Writer:
 def __init__(self):self.b=bytearray();self.views=[];self.acc=[]
 def view(self,b):
  self.b.extend(b'\0'*((-len(self.b))%4));i=len(self.views);self.views.append({'buffer':0,'byteOffset':len(self.b),'byteLength':len(b)});self.b.extend(b);return i
 def accessor(self,a,kind,component=5126):
  a=np.asarray(a,dtype=TYPES[component]).reshape(-1,WIDTH[kind]);record={'bufferView':self.view(a.tobytes()),'componentType':component,'count':len(a),'type':kind}
  if kind in ['VEC3','SCALAR']:record.update(min=a.min(0).astype(float).tolist(),max=a.max(0).astype(float).tolist())
  i=len(self.acc);self.acc.append(record);return i
 def save(self,g,path):
  g.update(bufferViews=self.views,accessors=self.acc,buffers=[{'byteLength':len(self.b)}]);j=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4);self.b.extend(b'\0'*((-len(self.b))%4));Path(path).parent.mkdir(parents=True,exist_ok=True);Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(self.b))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(self.b),0x004e4942)+self.b)
def textured(g,b,w,ids,limit=1024):
 out={'asset':copy.deepcopy(g['asset']),'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[]};out['asset']['generator']='luna_15 / supplied asset fitted in metres'
 ids=sorted(set(ids));mapping={old:i for i,old in enumerate(ids)};out['materials']=[copy.deepcopy(g['materials'][i]) for i in ids];textures=set()
 def visit(x,fn):
  if isinstance(x,dict):
   for k,v in x.items():
    if k.lower().endswith('texture') and isinstance(v,dict) and 'index' in v:fn(v)
    visit(v,fn)
  elif isinstance(x,list):
   for v in x:visit(v,fn)
 for m in out['materials']:visit(m,lambda v:textures.add(v['index']))
 tm={i:k for k,i in enumerate(sorted(textures))}
 for m in out['materials']:visit(m,lambda v:v.update(index=tm[v['index']]))
 out['textures']=[copy.deepcopy(g['textures'][i]) for i in sorted(textures)];ims=sorted({t['source'] for t in out['textures']});immap={i:k for k,i in enumerate(ims)};out['images']=[]
 colors={m['pbrMetallicRoughness']['baseColorTexture']['index'] for m in out['materials'] if 'baseColorTexture' in m.get('pbrMetallicRoughness',{})};colorims={out['textures'][i]['source'] for i in colors}
 for i in ims:
  im=g['images'][i];v=g['bufferViews'][im['bufferView']];raw=b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];image=Image.open(io.BytesIO(raw));mime=im['mimeType']
  changed=max(image.size)>limit
  if changed:image.thumbnail((limit,limit),Image.Resampling.LANCZOS)
  if i in colorims and image.mode=='RGBA' and image.getextrema()[3]==(255,255):image=image.convert('RGB')
  if i in colorims and image.mode=='RGB':stream=io.BytesIO();image.save(stream,'JPEG',quality=95,subsampling=0,optimize=True);raw=stream.getvalue();mime='image/jpeg'
  elif changed:stream=io.BytesIO();image.save(stream,'PNG',optimize=True);raw=stream.getvalue();mime='image/png'
  out['images'].append({'bufferView':w.view(raw),'mimeType':mime})
 for t in out['textures']:t['source']=immap[t['source']]
 out['samplers']=copy.deepcopy(g.get('samplers',[]))
 if g.get('extensionsUsed'):out['extensionsUsed']=g['extensionsUsed']
 return out,mapping
def primitive(w,attrs,index,material):
 return {'attributes':{k:w.accessor(v,'VEC4' if k in ['JOINTS_0','WEIGHTS_0','TANGENT'] else 'VEC2' if k.startswith('TEXCOORD') else 'VEC3',5123 if k=='JOINTS_0' else 5126) for k,v in attrs.items()},'indices':w.accessor(index,'SCALAR',5125),'material':material,'mode':4}
def record(path,**extra):
 b=Path(path).read_bytes();return dict(byteLength=len(b),sha256=hashlib.sha256(b).hexdigest(),**extra)
def surface(points_in,vertices,faces):
 """Closest projected triangle with barycentric weights; local candidates via KD."""
 tri=vertices[faces];tree=cKDTree(tri.mean(1));_,candidates=tree.query(points_in,k=min(16,len(tri)));a=tri[candidates,0];ab=tri[candidates,1]-a;ac=tri[candidates,2]-a;ap=points_in[:,None,:]-a
 d00=np.sum(ab*ab,2);d01=np.sum(ab*ac,2);d11=np.sum(ac*ac,2);d20=np.sum(ap*ab,2);d21=np.sum(ap*ac,2);den=np.maximum(d00*d11-d01*d01,1e-20)
 v=(d11*d20-d01*d21)/den;u=(d00*d21-d01*d20)/den;bary=np.stack([1-v-u,v,u],2);bary=np.maximum(bary,0);bary/=np.maximum(bary.sum(2,keepdims=True),1e-12);hit=np.sum(tri[candidates]*bary[:,:,:,None],2);best=np.argmin(np.sum((hit-points_in[:,None,:])**2,2),1);rows=np.arange(len(points_in));return hit[rows,best],candidates[rows,best],bary[rows,best]
