"""Bake the newly supplied city in metres, merge by material, add street bounds.

The original city's scale is handled by city.js; this district is independently
1.6 times the upload's metric geometry and connects to the eastern street edge.
"""
import argparse,gzip,json
from pathlib import Path
import numpy as np
from asset_tools import read,array,worlds,points,normals,Writer,textured,primitive,record
ROOT=Path(__file__).resolve().parents[1]
def main(source):
 g,b=read(source);world,parents=worlds(g);groups={};all_points=[];triangles=0
 for i,n in enumerate(g['nodes']):
  if 'mesh' not in n:continue
  for p in g['meshes'][n['mesh']]['primitives']:
   attrs={k:array(g,b,a) for k,a in p['attributes'].items() if k in ['POSITION','NORMAL','TEXCOORD_0']};v=points(attrs['POSITION'],world[i]);v-=np.array([-4.8,-.187,0]);attrs['POSITION']=v;attrs['NORMAL']=normals(attrs['NORMAL'],world[i]);faces=array(g,b,p['indices']).reshape(-1,3).astype(int)
   if np.linalg.det(world[i][:3,:3])<0:faces=faces[:,[0,2,1]]
   tri=v[faces];fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);ground=(tri[:,:,1].max(1)<.48)&(fn[:,1]>np.linalg.norm(fn,axis=1)*.5)
   for is_ground in [False,True]:
    f=faces[ground if is_ground else ~ground]
    if not len(f):continue
    key=(p['material'],is_ground);group=groups.setdefault(key,[]);group.append((attrs,f))
   all_points.append(v);triangles+=len(faces)
 w=Writer();out,mm=textured(g,b,w,[key[0] for key in groups],limit=512);bounds=np.concatenate(all_points);ground_nodes=[]
 for (mat,is_ground),entries in groups.items():
  attrs={k:[] for k in entries[0][0]};indices=[];offset=0
  for a,f in entries:
   used=np.unique(f);remap=np.full(len(a['POSITION']),-1);remap[used]=np.arange(len(used))
   for k in attrs:attrs[k].append(a[k][used])
   indices.append(remap[f]+offset);offset+=len(used)
  attrs={k:np.concatenate(v) for k,v in attrs.items()};idx=np.concatenate(indices).reshape(-1,3);packed=np.concatenate([attrs[k] for k in attrs],1).astype('f4');unique,first,remap=np.unique(packed,axis=0,return_index=True,return_inverse=True);attrs={k:v[first] for k,v in attrs.items()};idx=remap[idx]
  if len(idx)>1800:
   import fast_simplification
   from asset_tools import surface
   v,f=fast_simplification.simplify(attrs['POSITION'].astype(float),idx,target_reduction=.60);hit,t,bary=surface(v,attrs['POSITION'],idx);new={k:np.sum(a[idx[t]]*bary[:,:,None],1) for k,a in attrs.items()};new['POSITION']=v;new['NORMAL']/=np.maximum(np.linalg.norm(new['NORMAL'],axis=1,keepdims=True),1e-12);attrs=new;idx=f
  name=('District_Ground_' if is_ground else 'District_Static_')+str(mat);out['scenes'][0]['nodes'].append(len(out['nodes']));out['nodes'].append({'name':name,'mesh':len(out['meshes'])});out['meshes'].append({'name':name,'primitives':[primitive(w,attrs,idx.ravel(),mm[mat])]})
  if is_ground:ground_nodes.append(name)
 # These coherent blocks include their fragmented upper floors and facade
 # props; car boxes prevent walking through the stationary uploaded vehicles.
 boxes=[('West buildings',[-22.1,-.31,-37.9],[-7.94,21.53,43.74]),('East south',[-1.72,-.31,-39.5],[12.42,21.53,-3.03]),('East centre',[-1.27,-.24,-2.88],[15.31,12.69,10.02]),('East north',[-1.72,-.31,10.0],[12.42,21.53,41.33]),('Parked car',[-8.91,-.24,21.05],[-6.63,1.38,26.1]),('Parked scooter south',[-8.87,-.24,-8.03],[-7.24,1.04,-7.17]),('Parked scooter north',[-2.37,-.19,20.36],[-.82,1.07,21.48])]
 baked_triangles=sum(w.acc[p['indices']]['count']//3 for m in out['meshes'] for p in m['primitives'])
 offset=np.array([-4.8,-.187,0]);obstacles=[{'name':name,'min':(np.array(lo)-offset).tolist(),'max':(np.array(hi)-offset).tolist()} for name,lo,hi in boxes];extra={'name':'Uploaded city east district','unit':'metre','sourceUnitToMetres':1,'bounds':{'minX':float(bounds[:,0].min()),'maxX':float(bounds[:,0].max()),'minZ':float(bounds[:,2].min()),'maxZ':float(bounds[:,2].max())},'groundY':0,'obstacles':obstacles,'groundNodes':ground_nodes,'drawMeshes':len(out['meshes']),'sourceTriangles':triangles,'triangles':baked_triangles,'sourceAttribution':g['asset'].get('extras'),'normalizationOffset':offset.tolist()};out['scenes'][0]['extras']=extra;out['extras']={'sourceAttribution':g['asset'].get('extras'),'textureLimit':512};target=ROOT/'web/assets/city-east-district.glb';w.save(out,target)
 archive=ROOT/'models/city-east-district.glb.gz';archive.write_bytes(gzip.compress(target.read_bytes(),compresslevel=9,mtime=0));asset=record(target)
 manifest={'version':1,'asset':target.name,'fileName':target.name,'archiveName':archive.name,**asset,'compressedSha256':record(archive)['sha256'],'sourceFile':Path(source).name,'source':record(source),'assetRecord':asset,'world':extra};(ROOT/'models/city-district-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'bytes':target.stat().st_size,'archiveBytes':archive.stat().st_size,'drawMeshes':len(out['meshes']),'triangles':baked_triangles,'bounds':extra['bounds']},indent=2))
if __name__=='__main__':p=argparse.ArgumentParser();p.add_argument('source');main(p.parse_args().source)
