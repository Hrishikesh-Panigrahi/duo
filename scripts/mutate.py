"""Breaks each check listed in MUTANTS on purpose, one at a time, and checks a test notices.
Always puts the file back byte for byte.

Usage: python scripts/mutate.py
Each mutant should say CAUGHT with a failing vitest line (starting with the multiplication sign) under it.
CAUGHT only means vitest exited non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOM, VIEW, DIRECT, INVITE, MEDIA = 'src/lib/space/room.ts', 'src/lib/space/view.ts', 'src/lib/direct.ts', 'src/lib/invite.ts', 'src/lib/media.ts'
ROOM_T, VIEW_T, DIRECT_T, INVITE_T = 'src/lib/space/room.test.ts', 'src/lib/space/view.test.ts', 'src/lib/direct.test.ts', 'src/lib/invite.test.ts'
MEDIA_T, SHAPES_T = 'src/lib/media.test.ts', 'src/lib/space/shapes.test.ts'
# (what breaks, file, exact text to replace, replacement, test file that must fail)
MUTANTS = [
    ('presence budget raised to 10', ROOM,
     'export const PRESENCE_MAX_PER_WINDOW = 4', 'export const PRESENCE_MAX_PER_WINDOW = 10', ROOM_T),
    ('replay age check removed', ROOM,
     "if (typeof at === 'number' && Math.abs(Date.now() - at) < SIGNAL_MAX_AGE_MS) this.link.handleSignal(signal)",
     'this.link.handleSignal(signal)', ROOM_T),
    ('files accepted from anyone', ROOM, 'acceptFrom: o.isPartner,', 'acceptFrom: () => true,', ROOM_T),
    ('signal sealed to the wrong context', ROOM,
     'encryptRecord(key, contexts.signal(this.o.spaceId),', "encryptRecord(key, contexts.signal('x'),", ROOM_T),
    ('oversized signals decrypted', ROOM, "sealed.length > 64_000", 'sealed.length > 64_000_000', ROOM_T),
    ('rejoin never backs off', ROOM, '1_000 * 2 ** this.rejoins++', '1_000', ROOM_T),
    ('unencrypted rows shown once the space is encrypted', VIEW,
     'if (!cipher) return this.encrypted ? null : fallback()', 'if (!cipher) return fallback()', VIEW_T),
    ('more bytes than promised accepted', DIRECT, "    if (this.received > this.header.size) return 'invalid'\n", '', DIRECT_T),
    ('text accepted as file bytes', DIRECT, "    if (!(data instanceof ArrayBuffer)) return 'invalid'\n", '', DIRECT_T),
    ('any header accepted', DIRECT, "if (typeof h.messageId !== 'string' || !UUID.test(h.messageId)) return null", '', DIRECT_T),
    ('stale invites kept', INVITE, 'if (now - saved.at > KEEP_MS) {', 'if (false) {', INVITE_T),
    ('malformed decrypted record accepted', VIEW,
     "if (!valid(value)) throw new Error('Not the expected shape')", 'if (false) throw new Error(0)', SHAPES_T),
    ('any file type sent and opened', MEDIA,
     "export const PLAYABLE_TYPE = /^(image\\/(?!svg)[\\w.+-]+|video\\/[\\w.+-]+)$/i",
     'export const PLAYABLE_TYPE = /.*/', MEDIA_T),
]

missed = 0
for name, path, old, new, test in MUTANTS:
    f = ROOT / path
    raw = f.read_bytes()
    # Anchors use \n; a CRLF checkout is matched as LF and mutated back to CRLF.
    crlf = b'\r\n' in raw
    original = raw.decode('utf-8').replace('\r\n', '\n')
    assert original.count(old) == 1, f'{name}: anchor not found exactly once in {path}'
    mutated = original.replace(old, new)
    try:
        f.write_bytes((mutated.replace('\n', '\r\n') if crlf else mutated).encode('utf-8'))
        res = subprocess.run(f'npx vitest run {test}', cwd=ROOT, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
        failed = [line.strip() for line in (res.stdout + res.stderr).splitlines() if line.strip().startswith('×')]
        missed += res.returncode == 0
        print(f"{'CAUGHT' if res.returncode != 0 else 'MISSED'}  {name}")
        for line in failed:
            print('         ', line[:110])
    finally:
        f.write_bytes(raw)

sys.exit(1 if missed else 0)
