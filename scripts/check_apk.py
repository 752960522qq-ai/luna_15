"""Verify that a built APK contains the exact current offline framework."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
apk = Path(sys.argv[1])
with zipfile.ZipFile(apk) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    assert {'AndroidManifest.xml', 'classes.dex', 'resources.arsc'} <= names
    for path in (root / 'web').rglob('*'):
        if path.is_file():
            packed = 'assets/' + path.relative_to(root / 'web').as_posix()
            assert packed in names, packed
            assert z.read(packed) == path.read_bytes(), packed
    assert not any(name.startswith('lib/') for name in names), 'architecture independent'
    print(json.dumps({'status': 'passed', 'bytes': apk.stat().st_size,
        'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        'offlineAssetsMatchSource': True, 'architecture': 'universal'}, indent=2))
