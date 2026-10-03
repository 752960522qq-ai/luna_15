"""Bake the supplied CCity GLB to metres and merge its static meshes by material.

Usage: python3 scripts/import_city.py /path/to/ccity_building_set_1.glb
Requires numpy. Embedded textures and the source building geometry are lossless.
"""
import argparse
import copy
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCALE = .01  # 350 source units per storey -> 3.5 metres.
SPAWN = np.array([-14300., 0., -8800.])  # Asphalt, below the 20-unit kerb.
CAR_SCALE = .55  # Source Elise: 6.76 x 3.17 x 2.05 m -> 3.72 x 1.74 x 1.13 m.
TYPES = {5120:'i1', 5121:'u1', 5122:'<i2', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
WIDTHS = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}


def import_city(source):
    data = source.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert (magic, version, length) == (0x46546c67, 2, len(data))
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    gltf = json.loads(data[20:20+length])
    binary = data[28+length:]

    def accessor(index):
        a = gltf['accessors'][index]
        v = gltf['bufferViews'][a['bufferView']]
        dtype = np.dtype(TYPES[a['componentType']])
        width = WIDTHS[a['type']]
        assert 'sparse' not in a and not a.get('normalized')
        return np.ndarray((a['count'], width), dtype, buffer=binary,
            offset=v.get('byteOffset',0)+a.get('byteOffset',0),
            strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize)).copy()

    def matrix(node):
        if 'matrix' in node:
            return np.array(node['matrix']).reshape(4,4).T
        x,y,z,w = node.get('rotation',[0,0,0,1])
        rotation = np.array([
            [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
            [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
            [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
        m = np.eye(4)
        m[:3,:3] = rotation @ np.diag(node.get('scale',[1,1,1]))
        m[:3,3] = node.get('translation',[0,0,0])
        return m

    transforms = {}
    def visit(index, parent):
        transforms[index] = parent @ matrix(gltf['nodes'][index])
        for child in gltf['nodes'][index].get('children',[]):
            visit(child, transforms[index])
    for index in gltf['scenes'][gltf.get('scene',0)]['nodes']:
        visit(index,np.eye(4))

    def descendants(index):
        yield index
        for child in gltf['nodes'][index].get('children',[]):
            yield from descendants(child)

    def source_points(index):
        points = []
        for child in descendants(index):
            node = gltf['nodes'][child]
            if 'mesh' not in node:
                continue
            m = transforms[child]
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                pos = accessor(primitive['attributes']['POSITION'])
                points.append(pos @ m[:3,:3].T + m[:3,3])
        return np.concatenate(points)

    # Correct this one imported vehicle in place; leave the building scale intact.
    car_nodes = set(descendants(743))
    car_points = source_points(743)
    car_center = (car_points.min(0)+car_points.max(0))/2
    car_base = car_points[:,1].min()
    def metric(points, car=False):
        if car:
            points = (points-car_center)*CAR_SCALE + car_center
            points[:,1] += 20-(car_base-car_center[1])*CAR_SCALE-car_center[1]
        return (points-SPAWN)*SCALE

    grouped = {}
    primitive_count = triangles = 0
    for index,m in transforms.items():
        node = gltf['nodes'][index]
        if 'mesh' not in node:
            continue
        for p in gltf['meshes'][node['mesh']]['primitives']:
            assert p.get('mode',4) == 4
            attrs = p['attributes']
            position = accessor(attrs['POSITION'])
            position = metric(position @ m[:3,:3].T + m[:3,3],index in car_nodes)
            normal = accessor(attrs['NORMAL']) @ np.linalg.inv(m[:3,:3])
            normal /= np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),1e-12)
            uv = accessor(attrs['TEXCOORD_0'])
            indices = accessor(p['indices']).reshape(-1).astype('<u4')
            if np.linalg.det(m[:3,:3]) < 0:
                indices = indices.reshape(-1,3)[:,[0,2,1]].reshape(-1)
            material = p.get('material',0)
            group = grouped.setdefault(material, {'position':[], 'normal':[], 'uv':[], 'indices':[], 'count':0})
            group['position'].append(position.astype('<f4'))
            group['normal'].append(normal.astype('<f4'))
            group['uv'].append(uv.astype('<f4'))
            group['indices'].append(indices+group['count'])
            group['count'] += len(position)
            primitive_count += 1
            triangles += len(indices)//3

    packed = bytearray()
    out = {'asset':copy.deepcopy(gltf['asset']), 'scene':0, 'scenes':[{'nodes':[]}],
        'nodes':[], 'meshes':[], 'materials':copy.deepcopy(gltf['materials']),
        'textures':copy.deepcopy(gltf['textures']), 'samplers':copy.deepcopy(gltf.get('samplers',[])),
        'images':[], 'accessors':[], 'bufferViews':[]}
    out['asset']['generator'] = 'luna_15 static city importer'
    def view(content, target=None):
        while len(packed)%4:
            packed.append(0)
        v = {'buffer':0,'byteOffset':len(packed),'byteLength':len(content)}
        if target:
            v['target'] = target
        packed.extend(content)
        out['bufferViews'].append(v)
        return len(out['bufferViews'])-1
    def add_accessor(values, kind, component=5126):
        a = {'bufferView':view(values.tobytes(),34963 if component==5125 else 34962),
            'componentType':component,'count':len(values),'type':kind}
        if kind == 'VEC3':
            a['min'] = values.min(0).tolist()
            a['max'] = values.max(0).tolist()
        out['accessors'].append(a)
        return len(out['accessors'])-1
    all_positions = []
    for material,g in sorted(grouped.items()):
        position = np.concatenate(g['position'])
        all_positions.append(position)
        attrs = {'POSITION':add_accessor(position,'VEC3'),
            'NORMAL':add_accessor(np.concatenate(g['normal']),'VEC3'),
            'TEXCOORD_0':add_accessor(np.concatenate(g['uv']),'VEC2')}
        indices = add_accessor(np.concatenate(g['indices']),'SCALAR',5125)
        out['meshes'].append({'name':f"City_{gltf['materials'][material]['name']}",
            'primitives':[{'attributes':attrs,'indices':indices,'material':material}]})
        out['nodes'].append({'name':out['meshes'][-1]['name'],'mesh':len(out['meshes'])-1})
        out['scenes'][0]['nodes'].append(len(out['nodes'])-1)
    for im in gltf['images']:
        v = gltf['bufferViews'][im['bufferView']]
        raw = binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        out['images'].append({'bufferView':view(raw),'mimeType':im['mimeType']})

    # Conservatively block complete building footprints, including balconies.
    obstacles = []
    for index in gltf['nodes'][2]['children']:
        name = gltf['nodes'][index]['name']
        if index==822 or name.startswith(('StreetLamp','StopLights','LM_Basketball')):
            continue
        pts = metric(source_points(index),index==743)
        low,high = pts.min(0),pts.max(0)
        obstacles.append({'name':name,'min':low.round(5).tolist(),'max':high.round(5).tolist()})
    ground = metric(source_points(822))
    low,high = ground.min(0),ground.max(0)
    world = {'name':'CCity Building Set 1','unit':'metre','sourceUnitToMetres':SCALE,
        'sourceSpawn':SPAWN.tolist(),'spawn':{'x':0,'z':0,'yaw':float(np.pi)},
        'bounds':{'minX':float(low[0]),'maxX':float(high[0]),'minZ':float(low[2]),'maxZ':float(high[2])},
        'groundY':0,'characterRadius':.26,'obstacles':obstacles,
        'sourcePrimitives':primitive_count,'drawMeshes':len(grouped),'triangles':triangles,
        'vehicleScaleCorrection':CAR_SCALE,'sourceSha256':hashlib.sha256(data).hexdigest(),
        'attribution':gltf['asset']['extras']}
    out['scenes'][0]['extras'] = world
    out['buffers'] = [{'byteLength':len(packed)}]
    js = json.dumps(out,separators=(',',':')).encode()
    js += b' ' * (-len(js)%4)
    packed.extend(b'\0' * (-len(packed)%4))
    result = (struct.pack('<III',0x46546c67,2,28+len(js)+len(packed))+
        struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(packed),0x004e4942)+packed)
    target = ROOT/'web/assets/city-neighborhood.glb'
    target.write_bytes(result)
    compressed = gzip.compress(result,compresslevel=9,mtime=0)
    (ROOT/'models/city-neighborhood.glb.gz').write_bytes(compressed)
    manifest = {'fileName':target.name,'archiveName':'city-neighborhood.glb.gz',
        'byteLength':len(result),'sha256':hashlib.sha256(result).hexdigest(),
        'compressedSha256':hashlib.sha256(compressed).hexdigest(),'world':world}
    (ROOT/'models/city-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'sizeMetres':(high-low).round(3).tolist(),'staticMeshes':len(grouped),
        'triangles':triangles,'obstacles':len(obstacles),'glbBytes':len(result),'archiveBytes':len(compressed)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    import_city(parser.parse_args().source)
