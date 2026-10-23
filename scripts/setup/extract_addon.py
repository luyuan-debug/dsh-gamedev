"""Extract only bounded, regular addon files into a newly owned project."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

archive, project = map(Path, sys.argv[1:])
rows = []
seen = set()
with zipfile.ZipFile(archive) as source:
    if len(source.infolist()) > 1000:
        raise ValueError('Addon archive contains too many entries')
    total = 0
    for entry in source.infolist():
        relative = PurePosixPath(entry.filename)
        if (not entry.filename.startswith('addons/godot_mcp/') or relative.is_absolute()
                or any(part in ('..', '.') for part in relative.parts)
                or '\\' in entry.filename or entry.filename in seen):
            raise ValueError('Unsafe or duplicate addon member')
        seen.add(entry.filename)
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
            raise ValueError('Addon contains non-regular content')
        total += entry.file_size
        if entry.file_size > 8 * 1024 * 1024 or total > 32 * 1024 * 1024:
            raise ValueError('Addon exceeds extraction size limit')
        if entry.is_dir():
            continue
        target = project.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        data = source.read(entry)
        with target.open('xb') as out:
            out.write(data)
        rows.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(data).hexdigest()})
if not any(row['path'] == 'addons/godot_mcp/plugin.cfg' for row in rows):
    raise ValueError('Addon plugin.cfg missing')
print(json.dumps(rows))
