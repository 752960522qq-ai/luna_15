"""Check offline modules, Android packaging, and the exact supplied animation."""
import hashlib
import json
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
model = WEB / 'assets/jill-heels-locomotion.glb'
data = model.read_bytes()
magic, version, length = struct.unpack_from('<III', data)
assert magic == 0x46546c67 and version == 2 and length == len(data)
json_length, chunk = struct.unpack_from('<II', data, 12)
assert chunk == 0x4e4f534a
gltf = json.loads(data[20:20 + json_length])
clips = {clip['name']: clip for clip in gltf['animations']}
sources = {'Idle_Heels':'Idle.fbx', 'Walk_Heels':'Female Walk.fbx',
    'Run_Heels':'Running.fbx', 'Rifle_Aim_Idle':'Rifle Aiming Idle.fbx'}
assert set(clips) == set(sources)
for name, file in sources.items():
    assert clips[name]['extras']['sourceFile'] == file
    assert clips[name]['extras']['inPlace'] is True

city = (WEB / 'assets/city-neighborhood.glb').read_bytes()
city_manifest = json.loads((ROOT / 'models/city-manifest.json').read_text())
assert hashlib.sha256(city).hexdigest() == city_manifest['sha256']
city_json_length = struct.unpack_from('<I',city,12)[0]
city_gltf = json.loads(city[20:20+city_json_length])
assert all('uri' not in image for image in city_gltf['images']), 'city textures must be embedded'
assert city_gltf['scenes'][0]['extras']['unit'] == 'metre'

life = json.loads((ROOT / 'models/life-assets-manifest.json').read_text())
for name, metadata in life['assets'].items():
    binary = (WEB / 'assets' / name).read_bytes()
    assert len(binary) == metadata['byteLength']
    assert hashlib.sha256(binary).hexdigest() == metadata['sha256']
    n = struct.unpack_from('<I', binary, 12)[0]
    document = json.loads(binary[20:20+n])
    assert all('uri' not in image for image in document.get('images', []))
    assert all('uri' not in buffer for buffer in document['buffers'])
    if name == life['defaultModel']:
        assert {clip['name'] for clip in document['animations']} == set(sources)
        assert len(document['skins'][0]['joints']) == 437
    else:
        assert len(document['meshes']) == 1 and not document.get('skins')

ada = json.loads((ROOT / 'models/ada-clothing-manifest.json').read_text())
for name, metadata in ada['assets'].items():
    binary = (WEB / 'assets' / name).read_bytes()
    assert len(binary) == metadata['byteLength']
    assert hashlib.sha256(binary).hexdigest() == metadata['sha256']
    n = struct.unpack_from('<I', binary, 12)[0]
    document = json.loads(binary[20:20+n])
    assert document['extras']['sourceSha256'] == ada['sourceSha256']
    assert all('uri' not in image for image in document.get('images', []))
    assert all('uri' not in buffer for buffer in document['buffers'])

refs = 0
for path in WEB.rglob('*.js'):
    source = re.sub(r'/\*.*?\*/', '', path.read_text(), flags=re.S)
    for ref in re.findall(r'(?:^\s*(?:import|export)\s+[^;]*?\bfrom\s*|^\s*import\s*)[\'"]([^\'"]+)[\'"]', source, re.M):
        assert ref.startswith('.'), (path, 'non-local import', ref)
        target = (path.parent / ref.split('?')[0]).resolve()
        assert target.is_relative_to(WEB) and target.is_file(), (path, ref)
        refs += 1
html = (WEB / 'index.html').read_text()
assert 'type="importmap"' not in html
for ref in re.findall(r'(?:src|href)="(\.[^"]+)"', html):
    assert (WEB / ref.split('?')[0]).is_file(), ref

manifest = ET.parse(ROOT / 'android/app/src/main/AndroidManifest.xml').getroot()
assert manifest.find('uses-permission') is None, 'offline test needs no permissions'
android = '{http://schemas.android.com/apk/res/android}'
activity = manifest.find('application/activity')
assert activity.get(android + 'exported') == 'true'
assert activity.get(android + 'screenOrientation') == 'sensorLandscape'
build = (ROOT / 'android/app/build.gradle').read_text()
assert "assets.srcDirs = ['../../web']" in build
assert (ROOT / 'android/app/../../web').resolve() == WEB
assert "minSdk 26" in build
print(json.dumps({'status': 'passed', 'localModuleReferences': refs,
    'modelSha256': hashlib.sha256(data).hexdigest(), 'animations': list(clips),
    'offline': True, 'citySha256':city_manifest['sha256'], 'androidMinSdk': 26}, indent=2))
