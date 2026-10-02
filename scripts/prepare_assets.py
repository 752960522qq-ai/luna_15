"""Restore the exact animated GLB from its lossless repository archive."""
import gzip
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
metadata = json.loads((root / 'models/manifest.json').read_text())
target = root / 'web/assets' / metadata['fileName']
def valid(data):
    return len(data) == metadata['byteLength'] and hashlib.sha256(data).hexdigest() == metadata['sha256']
if target.is_file() and valid(target.read_bytes()):
    print('Animated GLB is ready; SHA-256 matches.')
else:
    archive = (root / 'models/jill-heels-locomotion.glb.gz').read_bytes()
    assert hashlib.sha256(archive).hexdigest() == metadata['compressedSha256'], 'Model archive checksum mismatch'
    data = gzip.decompress(archive)
    assert valid(data), 'Animated GLB checksum mismatch'
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_bytes(data)
    temporary.replace(target)
    print('Restored complete animated GLB; SHA-256 matches.')
