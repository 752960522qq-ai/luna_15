"""Restore the character and city GLBs from their lossless repository archives."""
import gzip
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
for manifest in ['manifest.json','city-manifest.json']:
    metadata = json.loads((root / 'models' / manifest).read_text())
    target = root / 'web/assets' / metadata['fileName']
    def valid(data):
        return len(data) == metadata['byteLength'] and hashlib.sha256(data).hexdigest() == metadata['sha256']
    if target.is_file() and valid(target.read_bytes()):
        print(f'{target.name} is ready; SHA-256 matches.')
        continue
    archive = (root / 'models' / metadata.get('archiveName','jill-heels-locomotion.glb.gz')).read_bytes()
    assert hashlib.sha256(archive).hexdigest() == metadata['compressedSha256'], 'Model archive checksum mismatch'
    data = gzip.decompress(archive)
    assert valid(data), 'GLB checksum mismatch'
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_bytes(data)
    temporary.replace(target)
    print(f'Restored {target.name}; SHA-256 matches.')
