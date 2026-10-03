"""Prepare the supplied barefoot protagonist and an independent pair of heels.

The supplied files are read only. Existing high-heel motion is retained; the
barefoot character shares the original body skeleton and receives its tracks.
"""
import argparse, copy, gzip, hashlib, io, json, struct
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation
from bake_locomotion import Rig, DTYPES, WIDTH

ROOT=Path(__file__).resolve().parents[1]
def read(path):
 b=Path(path).read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def array(g,b,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];d=np.dtype(DTYPES[a['componentType']]);w=WIDTH[a['type']]
 return np.ndarray((a['count'],w),dtype=d,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',d.itemsize*w),d.itemsize)).copy()
class Writer:
 def __init__(self):self.b=bytearray();self.views=[];self.acc=[]
 def view(self,b,extra=None):
  self.b.extend(b'\0'*((-len(self.b))%4));i=len(self.views);self.views.append(dict(buffer=0,byteOffset=len(self.b),byteLength=len(b),**(extra or {})));self.b.extend(b);return i
 def accessor(self,g,b,i):
  a=copy.deepcopy(g['accessors'][i]);a['bufferView']=self.view(array(g,b,i).tobytes());a.pop('byteOffset',None);self.acc.append(a);return len(self.acc)-1
 def save(self,g,path):
  g.update(bufferViews=self.views,accessors=self.acc,buffers=[{'byteLength':len(self.b)}]);j=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4);self.b.extend(b'\0'*((-len(self.b))%4));Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(self.b))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(self.b),0x004e4942)+self.b)
def repack(g,b,w):
 for i,a in enumerate(g['accessors']):
  ac=copy.deepcopy(a);ac['bufferView']=w.view(array(g,b,i).tobytes());ac.pop('byteOffset',None);w.acc.append(ac)
 colors={g['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source'] for m in g['materials'] if 'baseColorTexture' in m.get('pbrMetallicRoughness',{})}
 for i,image in enumerate(g.get('images',[])):
  bv=g['bufferViews'][image['bufferView']];raw=b[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']];im=Image.open(io.BytesIO(raw));mime=image['mimeType']
  if max(im.size)>1024:
   im.thumbnail((1024,1024),Image.Resampling.LANCZOS);stream=io.BytesIO();im.save(stream,'PNG',optimize=True);raw=stream.getvalue();mime='image/png'
  if i in colors and im.mode=='RGB':
   stream=io.BytesIO();im.save(stream,'JPEG',quality=95,subsampling=0,optimize=True);raw=stream.getvalue();mime='image/jpeg'
  image['bufferView']=w.view(raw);image['mimeType']=mime
def main(source):
 old,ob=read(ROOT/'web/assets/jill-heels-locomotion.glb');g,b=read(source);g=copy.deepcopy(g);w=Writer();repack(g,b,w)
 names={n.get('name'):i for i,n in enumerate(g['nodes'])};g['animations']=[]
 for original in old['animations']:
  a={'name':original['name'],'samplers':[],'channels':[],'extras':copy.deepcopy(original['extras'])};a['extras'].update(footwear='barefoot',generator='Existing body motion mapped onto the supplied matching barefoot rig')
  used=set()
  for channel in original['channels']:
   oldname=old['nodes'][channel['target']['node']].get('name','');plain=oldname.split('/',1)[-1]
   if not oldname.startswith('Body/') or plain not in names:continue
   target=names[plain];key=(target,channel['target']['path'])
   if key in used:continue
   used.add(key);s=original['samplers'][channel['sampler']];sampler={k:v for k,v in s.items() if k not in ['input','output']};sampler.update(input=w.accessor(old,ob,s['input']),output=w.accessor(old,ob,s['output']));a['channels'].append({'sampler':len(a['samplers']),'target':{'node':target,'path':channel['target']['path']}});a['samplers'].append(sampler)
   node=g['nodes'][target]
   if 'matrix' in node:
    m=Rig.matrix(node);scale=np.linalg.norm(m[:3,:3],axis=0);node.pop('matrix');node.update(translation=m[:3,3].tolist(),rotation=Rotation.from_matrix(m[:3,:3]/scale).as_quat().tolist(),scale=scale.tolist())
  assert len(a['channels'])>=45;g['animations'].append(a)
 g.setdefault('extras',{}).update(defaultProtagonist=True,units='metres',sourceFile=Path(source).name,sourceSha256=hashlib.sha256(Path(source).read_bytes()).hexdigest(),motionReference='jill-heels-locomotion.glb',textureLimit=1024)
 g['asset']['generator']='luna_15 Life V1 / matching body motion, original mesh proportions'
 target=ROOT/'web/assets/jill-barefoot-locomotion.glb';w.save(g,target)
 archive=ROOT/'models/jill-barefoot-locomotion.glb.gz';archive.write_bytes(gzip.compress(target.read_bytes(),compresslevel=9,mtime=0))
 (ROOT/'models/barefoot-manifest.json').write_text(json.dumps({'fileName':'jill-barefoot-locomotion.glb','archiveName':archive.name,'byteLength':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'compressedSha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2)+'\n')
 # Boots vertices are already in the original bind space. A static standalone
 # GLB retains their normals, UVs and complete material, without body geometry.
 mesh_index=next(n['mesh'] for n in old['nodes'] if n.get('name')=='Body/pl2020_Boots_Mat');mesh=copy.deepcopy(old['meshes'][mesh_index]);material_ids=sorted({p['material'] for p in mesh['primitives']});materials=[copy.deepcopy(old['materials'][i]) for i in material_ids];mm={i:k for k,i in enumerate(material_ids)}
 texids=set()
 def textures(d):
  if isinstance(d,dict):
   for k,v in d.items():
    if k.lower().endswith('texture') and isinstance(v,dict) and 'index' in v:texids.add(v['index'])
    textures(v)
  elif isinstance(d,list):
   for v in d:textures(v)
 for m in materials:textures(m)
 texids=sorted(texids);tm={i:k for k,i in enumerate(texids)}
 def remap(d):
  if isinstance(d,dict):
   for k,v in d.items():
    if k.lower().endswith('texture') and isinstance(v,dict) and 'index' in v:v['index']=tm[v['index']]
    remap(v)
  elif isinstance(d,list):
   for v in d:remap(v)
 for m in materials:remap(m)
 textures_new=[copy.deepcopy(old['textures'][i]) for i in texids];imids=sorted({t['source'] for t in textures_new});imm={i:k for k,i in enumerate(imids)}
 for t in textures_new:t['source']=imm[t['source']]
 shoe={'asset':{'version':'2.0','generator':'Extracted original Jill high heels; no body meshes'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Jill_Black_High_Heels','mesh':0}],'meshes':[mesh],'materials':materials,'textures':textures_new,'images':[copy.deepcopy(old['images'][i]) for i in imids],'samplers':copy.deepcopy(old.get('samplers',[])),'extras':{'source':'jill-heels-locomotion.glb','units':'metres','originalGeometry':True,'component':'pair of high heels'}}
 sw=Writer()
 for p in mesh['primitives']:
  p['material']=mm[p['material']];p['indices']=sw.accessor(old,ob,p['indices']);p['attributes']={name:sw.accessor(old,ob,i) for name,i in p['attributes'].items() if name not in ['JOINTS_0','WEIGHTS_0']}
 for im in shoe['images']:
  v=old['bufferViews'][im['bufferView']];im['bufferView']=sw.view(ob[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])
 shoe_path=ROOT/'web/assets/jill-high-heels.glb';sw.save(shoe,shoe_path)
 assets={}
 for p in [target,shoe_path]:assets[p.name]={'byteLength':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 manifest={'version':1,'defaultModel':'jill-barefoot-locomotion.glb','heelsModel':'jill-heels-locomotion.glb','standaloneShoes':'jill-high-heels.glb','units':'metres','sourceBarefootSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'assets':assets}
 (ROOT/'models/life-assets-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');main(p.parse_args().source)
