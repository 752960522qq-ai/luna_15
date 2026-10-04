import * as THREE from './vendor/three.module.js';

export function usesHeelPosture(id){return id==='black-heels'||id==='ada-shoes';}

// All attachments reuse the protagonist's existing skeleton and texture data.
// No duplicate character, armature or per-frame geometry fitting is necessary.
export class WardrobeAttachments{
 constructor(avatar,assets){
  this.avatar=avatar;this.meshes={};this.originalFoot=avatar.foot;this.originalSoles=avatar.soleIndices;
  this.body=avatar.root.getObjectByName('BodySkin_Mat')||avatar.root.getObjectByName('pl2020_Skin_Mat');
  const skeleton=this.body.skeleton,names=new Map(skeleton.bones.map((b,i)=>[b.name.replace(/^Body/,''),i]));
  for(const [slot,gltf] of Object.entries(assets)){
   const jointNames=gltf.parser.json.extras.bindJointNames,meshes=[];
   gltf.scene.traverse(source=>{if(!source.isMesh)return;const geometry=source.geometry.clone(),indices=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
    const remapped=new Uint16Array(indices.count*4);for(let i=0;i<indices.count;i++)for(let k=0;k<4;k++){const joint=names.get(jointNames[indices.array[i*4+k]]);if(weights.array[i*4+k]>0&&joint===undefined)throw new Error(`服装骨骼缺失：${jointNames[indices.array[i*4+k]]}`);remapped[i*4+k]=joint??0;}
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(remapped,4));
    const mesh=new THREE.SkinnedMesh(geometry,source.material);mesh.name='Ada_'+source.name;mesh.bind(skeleton,this.body.bindMatrix);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.visible=false;avatar.root.add(mesh);meshes.push(mesh);
   });this.meshes[slot]=meshes;
  }
  this.body.geometry=this.body.geometry.clone();this.fullPosition=this.body.geometry.attributes.position;this.fullNormal=this.body.geometry.attributes.normal;this.coveredPosition=this.fullPosition.clone();this.coveredNormal=this.fullNormal.clone();
  const variant=avatar.root.getObjectByName('BodySkin_Mat')?'heels':'barefoot';
  for(const [i,x,y,z,nx,ny,nz] of assets.top.parser.json.extras.bodyConform[variant]){this.coveredPosition.setXYZ(i,x,y,z);this.coveredNormal.setXYZ(i,nx,ny,nz);}
  this.fullIndex=this.body.geometry.index;const toeMask=new Set(assets.shoes.parser.json.extras.bodyMasks[variant]),kept=[];for(let i=0;i<this.fullIndex.count;i+=3)if(!toeMask.has(i/3))kept.push(this.fullIndex.array[i],this.fullIndex.array[i+1],this.fullIndex.array[i+2]);this.closedToeIndex=new THREE.BufferAttribute(new this.fullIndex.array.constructor(kept),1);
  this.underlayerProps=['pl2020_pl2020_Cardigan_Mat','pl2020_pl2000_Props_Mat'].map(n=>avatar.root.getObjectByName(n)).filter(Boolean);
  this.originalBoots=avatar.root.getObjectByName('Bodypl2020_Boots_Mat');
  this.shoeSoles=[];const position=this.meshes.shoes[0].geometry.attributes.position;for(let i=0;i<position.count;i++)if(position.getY(i)<.012)this.shoeSoles.push(i);
  if(!this.shoeSoles.length)throw new Error('新高跟鞋缺少鞋底采样');
 }
 outfit(value){
  const top=value.top==='ada-top',shoes=value.shoes==='ada-shoes';
  for(const mesh of this.meshes.top)mesh.visible=top;for(const mesh of this.meshes.shoes)mesh.visible=shoes;
  this.body.geometry.setAttribute('position',top?this.coveredPosition:this.fullPosition);this.body.geometry.setAttribute('normal',top?this.coveredNormal:this.fullNormal);for(const prop of this.underlayerProps)prop.visible=!top;
  this.body.geometry.setIndex(shoes?this.closedToeIndex:this.fullIndex);
  if(this.originalBoots)this.originalBoots.visible=!shoes;
  this.avatar.foot=shoes?this.meshes.shoes[0]:this.originalFoot;this.avatar.soleIndices=shoes?this.shoeSoles:this.originalSoles;
 }
}
