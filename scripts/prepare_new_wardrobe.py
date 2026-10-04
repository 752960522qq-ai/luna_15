"""Fit supplied D'Orsay shoes and extract only the dress; repair Ada shoe overlap.

Uses the existing Jill bind geometry and named skin joints. Original uploads
remain untouched. All generated assets are embedded, metre-scale attachments.
"""
import argparse, copy, hashlib, json
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree
from asset_tools import read,array,worlds,points,normals,Writer,textured,primitive,record,surface
ROOT=Path(__file__).resolve().parents[1]
def body(variant):
 g,b=read(ROOT/f'web/assets/jill-{variant}-locomotion.glb');node=next(n for n in g['nodes'] if n.get('name') in ['Body/Skin_Mat','pl2020_Skin_Mat']);p=g['meshes'][node['mesh']]['primitives'][0];attrs={k:array(g,b,i) for k,i in p['attributes'].items()};names=[g['nodes'][i]['name'].split('/')[-1] for i in g['skins'][node['skin']]['joints']];return attrs,array(g,b,p['indices']).reshape(-1,3).astype(int),names
def transfer(p,attrs,faces,allowed=None):
 eligible=np.ones(len(attrs['POSITION']),bool) if allowed is None else allowed;valid=faces[np.all(eligible[faces],1)];hit,tri,bary=surface(p,attrs['POSITION'],valid);ids=valid[tri];js=attrs['JOINTS_0'][ids].astype(int);ws=attrs['WEIGHTS_0'][ids]*bary[:,:,None];indices=np.zeros((len(p),4),np.uint16);weights=np.zeros((len(p),4),float)
 for i in range(len(p)):
  merged={}
  for j,w in zip(js[i].ravel(),ws[i].ravel()):merged[int(j)]=merged.get(int(j),0)+w
  best=sorted(merged.items(),key=lambda v:-v[1])[:4];total=sum(w for j,w in best)
  for k,(j,w) in enumerate(best):indices[i,k]=j;weights[i,k]=w/total
 return indices,weights
def radial_fit(p,attrs,ease=.014,hem=None):
 result=p.copy();v=attrs['POSITION'];body_points=v[(np.abs(v[:,0])<.26)&(v[:,1]>.61)&(v[:,1]<1.46)];ys=np.round(body_points[:,1]/.025).astype(int);slices={k:body_points[ys==k] for k in np.unique(ys)}
 for i,point in enumerate(p):
  y=point[1];rows=slices.get(round(y/.025),np.empty((0,3)))
  if len(rows)<8:continue
  # A directional silhouette, with mild ease, retains the uploaded neckline.
  angle=np.arctan2(point[2],point[0]);theta=np.arctan2(rows[:,2],rows[:,0]);diff=np.arctan2(np.sin(theta-angle),np.cos(theta-angle));selected=rows[np.abs(diff)<.16]
  if not len(selected):continue
  r=float(np.max(np.hypot(selected[:,0],selected[:,2])))+ease;original=np.hypot(point[0],point[2]);r=max(r,original) if hem is not None and y<hem else r
  result[i,0]=r*np.cos(angle);result[i,2]=r*np.sin(angle)
 return result
def vertex_normals(p,faces):
 n=np.zeros_like(p);tri=p[faces];fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);
 for k in range(3):np.add.at(n,faces[:,k],fn)
 return n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
def foot_conform(kind):
 result={}
 for variant in ['barefoot','heels']:
  attrs,faces,names=body(variant);original=attrs['POSITION'];v=original.copy();selected=(original[:,1]<.17)&(np.abs(original[:,0])>.045);p=v[selected];t=np.clip((.17-p[:,1])/.13,0,1);side=np.sign(p[:,0]);center=side*.111
  if kind=='ada':
   p[:,0]=center+(p[:,0]-center)*(1-.32*t);p[:,2]=-.025+(p[:,2]+.025)*(1-.18*t);p[:,1]-=.015*t*np.clip((p[:,2]-.015)/.055,0,1)
  else:
   front=np.clip((p[:,2]-.025)/.035,0,1);back=np.clip((-p[:,2]-.025)/.045,0,1);p[:,0]=center+(p[:,0]-center)*(1-t*(.18*front+.08*back));p[:,2]=np.where(front>0,.025+(p[:,2]-.025)*(1-.08*t*front),p[:,2]);p[:,1]-=.012*t*front
  p[:,1]=np.maximum(p[:,1],.008);v[selected]=p;n=vertex_normals(v,faces);result[variant]=[[int(i),*v[i].tolist(),*n[i].tolist()] for i in np.flatnonzero(selected)]
 return result
def dress_fit(original,source_body,target):
 sy=original[:,1].copy();v=original.copy();v[:,1]=np.interp(sy,[770,950,1100,1320,1550,1650],[.67,.84,.99,1.19,1.385,1.425]);grid=np.linspace(.66,1.43,90);profile=[]
 for y in grid:
  source_y=np.interp(y,[.67,.84,.99,1.19,1.385,1.425],[770,950,1100,1320,1550,1650]);s=source_body[np.abs(source_body[:,1]-source_y)<45];t=target[(np.abs(target[:,1]-y)<.025)&(np.abs(target[:,0])<.245)&~((target[:,1]<1.07)&(target[:,2]>.20))]
  if len(s)<8:s=source_body[np.abs(source_body[:,1]-source_y)<100]
  if len(t)<8:t=target[np.abs(target[:,1]-y)<.05]
  sx=max(.08,np.quantile(np.abs(s[:,0])*.001,.97));sz0=min(-.025,np.quantile(s[:,2]*.001,.025));sz1=max(.025,np.quantile(s[:,2]*.001,.975));tx=np.quantile(np.abs(t[:,0]),.97)+.012;tz0=np.quantile(t[:,2],.025)-.013;tz1=np.quantile(t[:,2],.975)+.013
  if y<.92:tx=max(tx,.173);tz0=min(tz0,-.105);tz1=max(tz1,.13)
  profile.append([tx/sx,tz0/sz0,tz1/sz1])
 profile=gaussian_filter1d(np.array(profile),2,axis=0);v[:,0]*=.001*np.interp(v[:,1],grid,profile[:,0]);front=original[:,2]>=0;v[:,2]*=.001*np.where(front,np.interp(v[:,1],grid,profile[:,2]),np.interp(v[:,1],grid,profile[:,1]));return v
def dress_conform(v,faces):
 result={};tri=v[faces];cn=vertex_normals(v,faces)
 for variant in ['barefoot','heels']:
  attrs,bfaces,names=body(variant);p=attrs['POSITION'].copy();original=p.copy();select=(p[:,1]>.67)&(p[:,1]<1.42)&(np.abs(p[:,0])<.25);ids=np.flatnonzero(select);hit,fi,bary=surface(p[select],v,faces);n=np.sum(cn[faces[fi]]*bary[:,:,None],1);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12);distance=np.linalg.norm(hit-p[select],axis=1);covered=(p[select,1]<1.19)&(np.abs(p[select,0])<.225);near=distance<.025;outside=np.sum((p[select]-hit)*n,1)>-.009;change=(covered|near)&outside
  # Retract covered body surfaces without deleting triangles: continuous skin
  # at hem and neckline, no jagged cut edge or detached ankle geometry.
  p[ids[change]]=hit[change]-n[change]*.009;normal=vertex_normals(p,bfaces);result[variant]=[[int(i),*p[i].tolist(),*normal[i].tolist()] for i in ids[change]]
 return result
def masks(gltf,kind,shoe_vertices=None,dress_vertices=None,dress_faces=None):
 result={}
 for variant in ['barefoot','heels']:
  attrs,faces,names=body(variant);c=attrs['POSITION'][faces].mean(1);y,z=c[:,1],c[:,2]
  if kind=='ada':
   # Cover the entire enclosed vamp/counter, not only the very front toes.
   ceiling=np.interp(z,[-.13,-.045,.015,.05,.13],[.143,.127,.104,.067,.04]);mask=(y<ceiling)&(np.abs(c[:,0])>.055)&(y<.15)
  elif kind=='dorsay':mask=(y<.06)&(z>.047)|(y<.12)&(z<-.058)
  else:
   hit,tri,bary=surface(c,dress_vertices,dress_faces);distance=np.linalg.norm(hit-c,axis=1);mask=((y>.655)&(y<1.20)&(np.abs(c[:,0])<.24))|((distance<.025)&(y<1.42)&(y>.66))
  result[variant]=np.flatnonzero(mask).tolist()
 return result
def attachment(source,selected,entries,slot,item,names,extra):
 g,b=read(source);w=Writer();out,mm=textured(g,b,w,[g['meshes'][i]['primitives'][0]['material'] for i in selected]);out['extras']={'units':'metres','slot':slot,'itemId':item,'bindJointNames':names,'sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'sourceAttribution':g['asset'].get('extras'),**extra}
 for name,attrs,indices,material in entries:
  out['scenes'][0]['nodes'].append(len(out['nodes']));out['nodes'].append({'name':name,'mesh':len(out['meshes'])});out['meshes'].append({'name':name,'primitives':[primitive(w,attrs,indices,mm[material])]})
 target=ROOT/f'web/assets/{item}.glb';w.save(out,target);return record(target,meshes=len(entries),vertices=sum(len(a['POSITION']) for n,a,i,m in entries),triangles=sum(len(i)//3 for n,a,i,m in entries))
def repair_ada():
 path=ROOT/'web/assets/ada-shoes.glb';g,b=read(path);w=Writer();out,mm=textured(g,b,w,[p['material'] for m in g['meshes'] for p in m['primitives']]);out['extras']=copy.deepcopy(g['extras']);out['extras'].update(itemId='ada-shoes',bodyMasks={'barefoot':[],'heels':[]},bodyConform=foot_conform('ada'),repair='Continuous fitted foot surface inside closed shoe; no triangle cutting at ankle opening')
 for m in g['meshes']:
  p=m['primitives'][0];attrs={k:array(g,b,i) for k,i in p['attributes'].items()};v=attrs['POSITION'];faces=array(g,b,p['indices']).ravel();attrs['NORMAL']=vertex_normals(v,faces.reshape(-1,3));out['scenes'][0]['nodes'].append(len(out['nodes']));out['nodes'].append({'name':m['name'],'mesh':len(out['meshes'])});out['meshes'].append({'name':m['name'],'primitives':[primitive(w,attrs,faces,mm[p['material']])]})
 w.save(out,path);manifest=json.loads((ROOT/'models/ada-clothing-manifest.json').read_text());manifest['assets']['ada-shoes.glb'].update(record(path));manifest['version']=2;manifest['shoeRepair']=out['extras']['repair'];(ROOT/'models/ada-clothing-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');return record(path)
def main(shoes,dress):
 attrs,faces,names=body('heels');assets={};g,b=read(shoes);world,_=worlds(g);entries=[]
 for mi,m in enumerate(g['meshes']):
  ni=next(i for i,n in enumerate(g['nodes']) if n.get('mesh')==mi);p=m['primitives'][0];original={k:array(g,b,a) for k,a in p['attributes'].items() if k!='TANGENT'};v=points(original['POSITION'],world[ni]);original['POSITION']=v;original['NORMAL']=normals(original['NORMAL'],world[ni]);idx=array(g,b,p['indices']).reshape(-1,3).astype(int)
  # A pair at the original density would exceed 89k faces; simplify the static
  # input before transferring UVs and binding. Keep material boundaries.
  import fast_simplification
  vv,ff=fast_simplification.simplify(v.astype(float),idx,target_reduction=.7);hit,tri,bary=surface(vv,v,idx);uv=np.sum(original['TEXCOORD_0'][idx[tri]]*bary[:,:,None],1);parts=[];part_indices=[]
  for sign in [-1,1]:
   q=vv.copy();q[:,0]*=1.32*sign;q[:,1]*=.88;q[:,2]=q[:,2]*1.12+.003;q[:,0]+=sign*.111;q[:,1]-=q[:,1].min();j,weights=transfer(q,attrs,faces,attrs['POSITION'][:,1]<.28);parts.append({'POSITION':q,'NORMAL':vertex_normals(q,ff),'TEXCOORD_0':uv,'JOINTS_0':j,'WEIGHTS_0':weights});fi=ff[:,[0,2,1]] if sign==-1 else ff;part_indices.append(fi+len(vv)*len(part_indices))
  pair={k:np.concatenate([p[k] for p in parts]) for k in parts[0]};index=np.concatenate(part_indices).ravel();pair['NORMAL']=vertex_normals(pair['POSITION'],index.reshape(-1,3));entries.append(('Dorsay_'+str(mi),pair,index,p['material']))
 assets['dorsay-shoes.glb']=attachment(shoes,list(range(len(g['meshes']))),entries,'shoes','dorsay-shoes',names,{'bodyMasks':{'barefoot':[],'heels':[]},'bodyConform':foot_conform('dorsay'),'binding':'Existing Jill ankles/balls; mirrored pair, original UVs and two materials','textureLimit':1024})
 g,b=read(dress);world,_=worlds(g);mi=next(i for i,m in enumerate(g['meshes']) if any(g['materials'][p['material']]['name'].startswith('FABRIC') for p in m['primitives']));ni=next(i for i,n in enumerate(g['nodes']) if n.get('mesh')==mi);p=g['meshes'][mi]['primitives'][0];a={k:array(g,b,v) for k,v in p['attributes'].items() if k!='TANGENT'};source_parts=[]
 for i,n in enumerate(g['nodes']):
  if 'mesh' in n and any(g['materials'][p['material']]['name'] in ['Marabody3','Maraleg2'] for p in g['meshes'][n['mesh']]['primitives']):
   for pbody in g['meshes'][n['mesh']]['primitives']:source_parts.append(points(array(g,b,pbody['attributes']['POSITION']),world[i]))
 arm_ids=[i for i,n in enumerate(names) if ('_arm_' in n and 'clavicle' not in n) or '_hand_' in n];arm_weight=np.sum(attrs['WEIGHTS_0']*np.isin(attrs['JOINTS_0'],arm_ids),1);torso=arm_weight<.08
 v=dress_fit(points(a['POSITION'],world[ni]),np.concatenate(source_parts),attrs['POSITION'][torso]);idx=array(g,b,p['indices']).ravel().astype(int);a['POSITION']=v;a['NORMAL']=vertex_normals(v,idx.reshape(-1,3));allowed=torso&(np.abs(attrs['POSITION'][:,0])<.25)&(attrs['POSITION'][:,1]>.60);a['JOINTS_0'],a['WEIGHTS_0']=transfer(v,attrs,faces,allowed)
 # Shoulder straps stay with clavicle/spine instead of following upper-arm
 # rotation when Jill lowers her arms from the bind pose.
 for i in range(len(v)):
  if v[i,1]>1.33:a['JOINTS_0'][i]=[names.index('spine_2'),0,0,0];a['WEIGHTS_0'][i]=[1,0,0,0]
 extra={'bodyMasks':{'barefoot':[],'heels':[]},'bodyConform':dress_conform(v,idx.reshape(-1,3)),'extractedMesh':mi,'excluded':'Original model body, head, hair, arms, legs and shoes','binding':'Torso and leg weights from existing Jill body; neckline retained','textureLimit':1024};assets['city-dress.glb']=attachment(dress,[mi],[('Uploaded_Dress',a,idx,p['material'])],'dress','city-dress',names,extra)
 assets['ada-shoes.glb']=repair_ada();manifest={'version':1,'characterScale':1,'units':'metres','assets':assets,'sourceFiles':{Path(shoes).name:record(shoes),Path(dress).name:record(dress)}};(ROOT/'models/new-wardrobe-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False,indent=2))
if __name__=='__main__':p=argparse.ArgumentParser();p.add_argument('shoes');p.add_argument('dress');args=p.parse_args();main(args.shoes,args.dress)
