"""Split six supplied citizens and bake supplied idle/walk plus existing male talk.

Usage: python3 scripts/prepare_female_citizens.py /path/female_citizen_dafuq.glb
Run export_fbx.mjs for the two supplied FBX files first. No source is changed.
"""
import argparse, copy, hashlib, json, re
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp
from asset_tools import read,array,worlds,matrix,points,normals,Writer,textured,primitive,record
from retarget_walk import SourceMotion
ROOT=Path(__file__).resolve().parents[1]
def canonical(name):return re.sub(r'_\d+$','',name).replace('ValveBiped_','ValveBiped.')
def rotation(m):return m[:3,:3]/np.maximum(np.linalg.norm(m[:3,:3],axis=0),1e-12)
def align(a,b):
 a=a/np.linalg.norm(a);b=b/np.linalg.norm(b);cross=np.cross(a,b);dot=np.clip(a@b,-1,1)
 if np.linalg.norm(cross)<1e-9:
  if dot>0:return np.eye(3)
  axis=np.cross(a,[1,0,0] if abs(a[0])<.9 else [0,1,0]);return R.from_rotvec(axis/np.linalg.norm(axis)*np.pi).as_matrix()
 return R.from_rotvec(cross/np.linalg.norm(cross)*np.arccos(dot)).as_matrix()
def local_world(local,parents):
 result=[]
 def w(i):return (result[parents[i]] if i in parents else np.eye(4))@local[i]
 # Skin lists are topological; checked before baking.
 for i in range(len(local)):result.append(w(i))
 return result
class MaleTalk:
 def __init__(self):
  self.g,self.b=read(ROOT/'web/assets/npcs/male-citizen-01.glb');self.rest=[matrix(n) for n in self.g['nodes']];self.rest_world,self.parents=worlds(self.g);self.ids={canonical(n.get('name','')):i for i,n in enumerate(self.g['nodes'])};self.clip=next(a for a in self.g['animations'] if a['name']=='Citizen_Talk');self.period=max(float(array(self.g,self.b,s['input'])[-1,0]) for s in self.clip['samplers']);self.channels=[]
  for c in self.clip['channels']:
   s=self.clip['samplers'][c['sampler']];times=array(self.g,self.b,s['input']).ravel();values=array(self.g,self.b,s['output']);kind=c['target']['path'];self.channels.append((c['target']['node'],kind,times,values,Slerp(times,R.from_quat(values)) if kind=='rotation' else None))
 def sample(self,phase):
  local=[m.copy() for m in self.rest]
  for i,kind,t,v,interp in self.channels:
   time=np.clip(phase*self.period,t[0],t[-1])
   if kind=='rotation':local[i][:3,:3]=interp(time).as_matrix()@np.diag(np.linalg.norm(self.rest[i][:3,:3],axis=0))
   elif kind=='translation':local[i][:3,3]=[np.interp(time,t,v[:,k]) for k in range(3)]
  cache={}
  def w(i):
   if i not in cache:cache[i]=(w(self.parents[i]) if i in self.parents else np.eye(4))@local[i]
   return cache[i]
  return [w(i) for i in range(len(local))]
def mappings():
 pairs=[('Hips','Pelvis','Spine','Spine'),('Spine','Spine','Spine1','Spine1'),('Spine1','Spine1','Spine2','Spine2'),('Spine2','Spine2','Neck','Neck1'),('Neck','Neck1','Head','Head1'),('Head','Head1',None,None)]
 for prefix,side in [('Left','L'),('Right','R')]:
  pairs.extend((prefix+a,side+'_'+b,prefix+c if c else None,side+'_'+d if d else None) for a,b,c,d in [('Shoulder','Clavicle','Arm','UpperArm'),('Arm','UpperArm','ForeArm','Forearm'),('ForeArm','Forearm','Hand','Hand'),('Hand','Hand','HandMiddle1','Finger2'),('UpLeg','Thigh','Leg','Calf'),('Leg','Calf','Foot','Foot'),('Foot','Foot','ToeBase','Toe0'),('ToeBase','Toe0',None,None)])
  for finger,num in [('Thumb',0),('Index',1),('Middle',2),('Ring',3),('Pinky',4)]:
   for k in range(3):pairs.append((prefix+f'Hand{finger}{k+1}',side+'_Finger'+str(num)+('' if k==0 else str(k)),None,None))
 return pairs
def bake(g,meshes,writer,motion,name):
 local=[matrix(n) for n in g['nodes']];rest,parents=worlds(g);ids={canonical(n['name']):i for i,n in enumerate(g['nodes'])};pelvis=ids['ValveBiped.Bip01_Pelvis'];root_parent=parents.get(pelvis);is_talk=isinstance(motion,MaleTalk)
 feet=[]
 for attrs,indices,mat in meshes:
  selected=np.where(attrs['POSITION'][:,1]<.07)[0]
  if len(selected):feet.append({k:v[selected] for k,v in attrs.items() if k in ['POSITION','JOINTS_0','WEIGHTS_0']})
 corrections=[]
 if not is_talk:
  for sn,tn,sc,tc in mappings():
   ti=ids['ValveBiped.Bip01_'+tn];si=motion.id(sn);basis=rotation(rest[ti])
   if sc and tc:
    a=rest[ids['ValveBiped.Bip01_'+tc]][:3,3]-rest[ti][:3,3];b=motion.rest_world[motion.id(sc)][:3,3]-motion.rest_world[si][:3,3];basis=align(a,b)@basis
   elif 'Finger' in tn:
    a=rest[ti][:3,3]-rest[parents[ti]][:3,3];b=motion.rest_world[si][:3,3]-motion.rest_world[motion.nodes[si]['parent']][:3,3];basis=align(a,b)@basis
   corrections.append((ti,si,rotation(motion.rest_world[si]).T@basis))
  source_hip=motion.id('Hips');source_leg=sum(np.linalg.norm(motion.rest_world[motion.id(a)][:3,3]-motion.rest_world[motion.id(b)][:3,3]) for a,b in [('LeftUpLeg','LeftLeg'),('LeftLeg','LeftFoot')]);target_leg=sum(np.linalg.norm(rest[ids['ValveBiped.Bip01_L_'+a]][:3,3]-rest[ids['ValveBiped.Bip01_L_'+b]][:3,3]) for a,b in [('Thigh','Calf'),('Calf','Foot')]);unit=target_leg/source_leg
  first,last=motion.sample(0),motion.sample(1);drift=last[source_hip][:3,3]-first[source_hip][:3,3];drift[1]=0;stride=float(np.linalg.norm(drift[[0,2]])*unit)
 else:
  source_hip=motion.ids['ValveBiped.Bip01_Pelvis'];unit=rest[pelvis][1,3]/motion.rest_world[source_hip][1,3];drift=np.zeros(3);stride=0
  corrections=[(ti,motion.ids[n],rotation(motion.rest_world[motion.ids[n]]).T@rotation(rest[ti])) for n,ti in ids.items() if n in motion.ids and n.startswith('ValveBiped.Bip01')]
 corrections.sort();count=max(32,round(motion.period*30));frames=[];lifts=[];inverse=np.array([np.linalg.inv(m) for m in rest])
 for f in range(count+1):
  phase=f/count;source=motion.sample(phase);pose=[m.copy() for m in local]
  delta=(source[source_hip][:3,3]-(motion.rest_world[source_hip][:3,3] if not is_talk else motion.sample(0)[source_hip][:3,3])-drift*phase)*unit;delta[[0,2]]=0 if name!='Citizen_Walk' else delta[[0,2]]
  pose[pelvis][:3,3]+=np.linalg.inv(rest[root_parent][:3,:3])@delta if root_parent is not None else delta
  posed=local_world(pose,parents)
  for ti,si,correction in corrections:
   parent=parents.get(ti);desired=rotation(source[si])@correction;local_r=(rotation(posed[parent]).T if parent is not None else np.eye(3))@desired;pose[ti][:3,:3]=local_r@np.diag(np.linalg.norm(local[ti][:3,:3],axis=0));posed=local_world(pose,parents)
  transforms=np.array(posed)@inverse;low=np.inf
  for attrs in feet:
   v=np.concatenate([attrs['POSITION'],np.ones((len(attrs['POSITION']),1))],1);j=attrs['JOINTS_0'].astype(int);weights=attrs['WEIGHTS_0'];p=np.einsum('nkij,nj->nki',transforms[j],v);p=np.sum(p*weights[:,:,None],1);low=min(low,p[:,1].min())
  lift=.001-float(low);pose[pelvis][:3,3]+=np.linalg.inv(rest[root_parent][:3,:3])@np.array([0,lift,0]) if root_parent is not None else np.array([0,lift,0]);lifts.append(lift);frames.append(pose)
 # Explicitly close the cycle; corrections already removed forward root drift.
 frames[-1]=[m.copy() for m in frames[0]];times=writer.accessor(np.linspace(0,motion.period,count+1),'SCALAR');animation={'name':name,'channels':[],'samplers':[],'extras':{'sourceFile':'Talking.fbx (existing male Citizen_Talk)' if is_talk else motion.data['sourceFile'],'inPlace':True,'loop':True,'rootMotionRemovedMetres':[0,0,stride],'referenceStrideDistance':stride,'retargetedJoints':len(corrections),'sampleRate':30,'gender':'female','groundCorrectionRange':list(map(float,[min(lifts),max(lifts)]))}}
 def channel(i,kind,value,type):animation['channels'].append({'sampler':len(animation['samplers']),'target':{'node':i,'path':kind}});animation['samplers'].append({'input':times,'output':writer.accessor(value,type),'interpolation':'LINEAR'})
 for ti,_,_ in corrections:
  values=[R.from_matrix(rotation(frame[ti])).as_quat() for frame in frames]
  for k in range(1,len(values)):
   if np.dot(values[k-1],values[k])<0:values[k]=-values[k]
  channel(ti,'rotation',values,'VEC4')
 channel(pelvis,'translation',[frame[pelvis][:3,3] for frame in frames],'VEC3');g.setdefault('animations',[]).append(animation);return animation['extras']
def main(source):
 src,b=read(source);world,parents=worlds(src);heights=[];sets=[]
 for si,skin in enumerate(src['skins']):
  nodes=[i for i,n in enumerate(src['nodes']) if n.get('skin')==si];allp=np.concatenate([points(array(src,b,p['attributes']['POSITION']),world[i]) for i in nodes for p in src['meshes'][src['nodes'][i]['mesh']]['primitives']]);sets.append((nodes,allp));heights.append(np.ptp(allp[:,1]))
 scale=1.7/float(np.median(heights));idle=SourceMotion(ROOT/'scripts/source/female-citizen-idle.json');walk=SourceMotion(ROOT/'scripts/source/female-citizen-walk.json');talk=MaleTalk();citizens=[]
 for si,(mesh_nodes,allp) in enumerate(sets):
  skin=src['skins'][si];joints=skin['joints'];jm={v:k for k,v in enumerate(joints)};assert all(parents.get(i) not in jm or jm[parents[i]]<jm[i] for i in joints)
  center=(allp.min(0)+allp.max(0))/2;center[1]=allp[:,1].min();transform=np.eye(4);transform[:3,:3]*=scale;transform[:3,3]=-center*scale;rest=[transform@world[i] for i in joints]
  # The collection offsets its meshes and armatures by different amounts.
  # Register every armature to its own extracted body before calculating IBMs.
  pelvis_x=rest[1][0,3]
  for m in rest:m[0,3]-=pelvis_x
  w=Writer();materials=[p['material'] for i in mesh_nodes for p in src['meshes'][src['nodes'][i]['mesh']]['primitives']];out,mm=textured(src,b,w,materials);meshes=[]
  for k,i in enumerate(joints):
   local=np.linalg.inv(rest[jm[parents[i]]])@rest[k] if parents.get(i) in jm else rest[k];out['nodes'].append({'name':canonical(src['nodes'][i]['name']),'translation':local[:3,3].tolist(),'rotation':R.from_matrix(rotation(local)).as_quat().tolist(),'scale':np.linalg.norm(local[:3,:3],axis=0).tolist(),'children':[jm[c] for c in src['nodes'][i].get('children',[]) if c in jm]})
  out['scenes'][0]['nodes']=[k for k,i in enumerate(joints) if parents.get(i) not in jm];inverse=np.array([np.linalg.inv(m).T.reshape(16) for m in rest]);out['skins']=[{'joints':list(range(len(joints))),'inverseBindMatrices':w.accessor(inverse,'MAT4')}]
  for i in mesh_nodes:
   for p in src['meshes'][src['nodes'][i]['mesh']]['primitives']:
    attrs={k:array(src,b,a) for k,a in p['attributes'].items() if k!='TANGENT'};m=transform@world[i];attrs['POSITION']=points(attrs['POSITION'],m);attrs['NORMAL']=normals(attrs['NORMAL'],m);indices=array(src,b,p['indices']).reshape(-1);meshes.append((attrs,indices,mm[p['material']]))
    out['scenes'][0]['nodes'].append(len(out['nodes']));out['nodes'].append({'name':'Female_'+src['nodes'][i]['name'],'mesh':len(out['meshes']),'skin':0});out['meshes'].append({'name':src['nodes'][i]['name'],'primitives':[primitive(w,attrs,indices,mm[p['material']])]})
  # Bake while the document contains only its 57 topological joints.
  bone_nodes=out['nodes'];out['nodes']=out['nodes'][:len(joints)];extras=[bake(out,meshes,w,m,n) for m,n in [(idle,'Citizen_Idle'),(walk,'Citizen_Walk'),(talk,'Citizen_Talk')]];out['nodes']=bone_nodes
  name=f'female-citizen-{si+1:02d}';height=float(heights[si]*scale);out['extras']={'gender':'female','units':'metres','heightMetres':height,'sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'sourceSkin':si,'sourceAttribution':src['asset'].get('extras'),'textureLimit':1024};target=ROOT/'web/assets/npcs'/f'{name}.glb';w.save(out,target);citizens.append({'id':name,'path':f'assets/npcs/{name}.glb','gender':'female','heightMetres':height,'joints':57,'meshCount':len(meshes),'triangleCount':sum(len(i)//3 for a,i,m in meshes),'clips':extras,**record(target)});print(name,height,target.stat().st_size,flush=True)
 manifest={'version':1,'units':'metres','gender':'female','characterCount':len(citizens),'scaleFromSource':scale,'jillReferenceHeightMetres':1.7302537,'sourceFiles':{Path(source).name:hashlib.sha256(Path(source).read_bytes()).hexdigest(),'Dwarf Walk(1).fbx':hashlib.sha256((ROOT.parent/'upload/Dwarf Walk(1).fbx').read_bytes()).hexdigest(),'Standing Idle(1).fbx':hashlib.sha256((ROOT.parent/'upload/Standing Idle(1).fbx').read_bytes()).hexdigest()},'sourceAttribution':src['asset'].get('extras'),'citizens':citizens};(ROOT/'web/assets/npcs/female-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':p=argparse.ArgumentParser();p.add_argument('source');main(p.parse_args().source)
