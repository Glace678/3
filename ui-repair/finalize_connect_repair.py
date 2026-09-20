from pathlib import Path
import hashlib
import json
import re

root = Path('C:/OpenMU-Local')
manifest_path = root / 'manifest.json'
raw = manifest_path.read_bytes()
manifest = json.loads(raw)
matches = [entry for entry in manifest['files'] if entry['path'] == 'App/Game/Main.exe']
assert len(matches) == 1
entry = matches[0]
client = root / entry['path']
digest = hashlib.sha256(client.read_bytes()).hexdigest().upper()
pattern = rb'("path"\s*:\s*"App/Game/Main.exe"\s*,\s*"size"\s*:\s*)\d+(\s*,\s*"sha256"\s*:\s*")[0-9A-Fa-f]+(")'
updated, count = re.subn(pattern, lambda match: match[1] + str(client.stat().st_size).encode() + match[2] + digest.encode() + match[3], raw)
assert count == 1
manifest_path.write_bytes(updated)
verified = json.loads(manifest_path.read_bytes())
record = next(item for item in verified['files'] if item['path'] == 'App/Game/Main.exe')
assert record['sha256'] == digest and record['size'] == client.stat().st_size
print(json.dumps(record))
