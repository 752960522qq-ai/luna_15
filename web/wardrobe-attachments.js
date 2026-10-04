import * as THREE from './vendor/three.module.js';
export function usesHeelPosture(id){return ['black-heels','ada-shoes','dorsay-shoes'].includes(id);}
// Reuse the existing Jill skeleton. Fitting and skin transfer are offline.
export class WardrobeAttachments{
 constructor(avatar,assets){
  this.avatar=avatar;this.meshes={};this.items=new Map();this.originalFoot=avatar.foot;this.originalSoles=avatar.soleIndices;this.activeKey=null;this.indexCache=new Map();
  this.body=avatar.root.getObjectByName('BodySkin_Mat')||avatar.root.getObjectByName('pl2020_Skin_Mat');this.variant=avatar.root.getObjectByName('BodySkin_Mat')?'heels':'barefoot';
  const skeleton=this.body.skeleton,names=new Map(skeleton.bones.map((b,i)=>[b.name.replace(/^Body/,''),i]));
  for(const [key,gltf] of Object.entries(assets)){
   const extras=gltf.parser.json.extras,jointNames=extras.bindJointNames,meshes=[],id=extras.itemId||(key==='top'?'ada-top':key==='shoes'?'ada-shoes':key);
   gltf.scene.traverse(source=>{if(!source.isMesh)return;const geometry=source.geometry.clone(),indices=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
    const remapped=new Uint16Array(indices.count*4);for(let i=0;i<indices.count;i++)for(let k=0;k<4;k++){const joint=names.get(jointNames[indices.array[i*4+k]]);if(weights.array[i*4+k]>0&&joint===undefined)throw new Error('服装骨骼缺失：'+jointNames[indices.array[i*4+k]]);remapped[i*4+k]=joint??0;}
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(remapped,4));const mesh=new THREE.SkinnedMesh(geometry,source.material);mesh.name=id+'_'+source.name;mesh.bind(skeleton,this.body.bindMatrix);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.visible=false;avatar.root.add(mesh);meshes.push(mesh);
   });let foot=null,soleIndices=[],lowest=Infinity;
   if(extras.slot==='shoes')for(const mesh of meshes){const p=mesh.geometry.attributes.position;let min=Infinity;for(let i=0;i<p.count;i++)min=Math.min(min,p.getY(i));if(min<lowest){lowest=min;foot=mesh;}}
   if(foot){const p=foot.geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)<lowest+.009)soleIndices.push(i);if(!soleIndices.length)throw new Error('高跟鞋缺少鞋底采样');}
   this.items.set(id,{id,slot:extras.slot,meshes,foot,soleIndices,conform:extras.bodyConform?.[this.variant]||[],mask:extras.bodyMasks?.[this.variant]||[]});this.meshes[key]=meshes;if(id==='ada-top')this.meshes.top=meshes;if(id==='ada-shoes')this.meshes.shoes=meshes;
  }
  this.body.geometry=this.body.geometry.clone();this.fullPosition=this.body.geometry.attributes.position;this.fullNormal=this.body.geometry.attributes.normal;this.workingPosition=this.fullPosition.clone();this.workingNormal=this.fullNormal.clone();this.fullIndex=this.body.geometry.index;
  this.underlayerProps=['pl2020_pl2020_Cardigan_Mat','pl2020_pl2000_Props_Mat'].map(n=>avatar.root.getObjectByName(n)).filter(Boolean);this.originalBoots=avatar.root.getObjectByName('Bodypl2020_Boots_Mat');
 }
 outfit(value){
  const key=[value.top||'',value.dress||'',value.shoes||''].join('|');if(key===this.activeKey)return;this.activeKey=key;const active=[];for(const item of this.items.values()){const enabled=value[item.slot]===item.id;for(const mesh of item.meshes)mesh.visible=enabled;if(enabled)active.push(item);}
  const conform=active.filter(item=>item.conform.length);if(conform.length){this.workingPosition.array.set(this.fullPosition.array);this.workingNormal.array.set(this.fullNormal.array);for(const item of conform)for(const [i,x,y,z,nx,ny,nz] of item.conform){this.workingPosition.setXYZ(i,x,y,z);this.workingNormal.setXYZ(i,nx,ny,nz);}this.workingPosition.needsUpdate=this.workingNormal.needsUpdate=true;this.body.geometry.setAttribute('position',this.workingPosition);this.body.geometry.setAttribute('normal',this.workingNormal);}else{this.body.geometry.setAttribute('position',this.fullPosition);this.body.geometry.setAttribute('normal',this.fullNormal);}
  const masked=active.filter(item=>item.mask.length);if(masked.length){const maskKey=masked.map(i=>i.id).sort().join('|');if(!this.indexCache.has(maskKey)){const mask=new Set(masked.flatMap(i=>i.mask)),kept=[];for(let i=0;i<this.fullIndex.count;i+=3)if(!mask.has(i/3))kept.push(this.fullIndex.array[i],this.fullIndex.array[i+1],this.fullIndex.array[i+2]);this.indexCache.set(maskKey,new THREE.BufferAttribute(new this.fullIndex.array.constructor(kept),1));}this.body.geometry.setIndex(this.indexCache.get(maskKey));}else this.body.geometry.setIndex(this.fullIndex);
  for(const prop of this.underlayerProps)prop.visible=!active.some(i=>i.slot==='top'||i.slot==='dress');const footwear=active.find(i=>i.slot==='shoes');if(this.originalBoots)this.originalBoots.visible=!footwear;this.avatar.foot=footwear?.foot||this.originalFoot;this.avatar.soleIndices=footwear?.soleIndices||this.originalSoles;
 }
 visibleMeshes(slot){let count=0;for(const item of this.items.values())if(item.slot===slot)count+=item.meshes.filter(m=>m.visible).length;return count;}
 snapshot(){return Object.fromEntries([...this.items].map(([id,item])=>[id,item.meshes.filter(m=>m.visible).length]));}
}
