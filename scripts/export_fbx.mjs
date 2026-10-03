// Extract animation data only; source meshes and textures are not imported.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

globalThis.window = { URL: globalThis.URL };
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/export_fbx.mjs input.fbx output.json');
const bytes = fs.readFileSync(input);
const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
model.updateMatrixWorld(true);
const nodes = [], indices = new Map();
model.traverse(node => { indices.set(node, nodes.length); nodes.push(node); });
const document = {
  sourceFile: path.basename(input),
  nodes: nodes.map(node => ({ name: node.name, isBone: !!node.isBone,
    parent: indices.get(node.parent) ?? null, position: node.position.toArray(),
    quaternion: node.quaternion.toArray(), scale: node.scale.toArray() })),
  animations: model.animations.filter(clip => clip.tracks.length).map(clip => ({
    name: clip.name, duration: clip.duration, tracks: clip.tracks.map(track => ({
      name: track.name, type: track.ValueTypeName,
      times: Array.from(track.times), values: Array.from(track.values) })) }))
};
fs.writeFileSync(output, JSON.stringify(document));
console.log(JSON.stringify({sourceFile: document.sourceFile, bones: nodes.filter(n => n.isBone).length,
  animations: document.animations.map(a => ({name: a.name, duration: a.duration, tracks: a.tracks.length}))}));
