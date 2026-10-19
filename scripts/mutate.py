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
E2E, CHAT, SESSION = 'src/lib/e2e.ts', 'src/lib/space/chat-actions.ts', 'src/lib/session.ts'
SPACES, CONTENT = 'src/lib/spaces.ts', 'src/lib/space/content-actions.ts'
E2E_T, CHAT_T, SESSION_T = 'src/lib/e2e.test.ts', 'src/lib/space/chat-actions.test.ts', 'src/lib/session.test.ts'
SPACES_T, CONTENT_T = 'src/lib/spaces.test.ts', 'src/lib/space/content-actions.test.ts'
# (what breaks, file, exact text to replace, replacement, test file that must fail)
MUTANTS = [
    ('presence budget raised to 10', ROOM,
     'export const PRESENCE_MAX_PER_WINDOW = 4', 'export const PRESENCE_MAX_PER_WINDOW = 10', ROOM_T),
    ('replay age check removed', ROOM,
     "if (typeof at === 'number' && Math.abs(Date.now() - at) < SIGNAL_MAX_AGE_MS) this.link.handleSignal(signal)",
     'this.link.handleSignal(signal)', ROOM_T),
    ('files accepted from anyone', ROOM, 'acceptFrom: options.isPartner,', 'acceptFrom: () => true,', ROOM_T),
    ('signal sealed to the wrong context', ROOM,
     'encryptRecord(key, contexts.signal(this.options.spaceId),', "encryptRecord(key, contexts.signal('x'),", ROOM_T),
    ('oversized signals decrypted', ROOM, 'MAX_SEALED_SIGNAL_LENGTH = 64_000', 'MAX_SEALED_SIGNAL_LENGTH = 64_000_000', ROOM_T),
    ('rejoin never backs off', ROOM, '1_000 * 2 ** this.rejoinAttempts', '1_000', ROOM_T),
    ('unencrypted rows shown once the space is encrypted', VIEW,
     'if (!cipher) return this.encryptionOn ? null : readLegacy()', 'if (!cipher) return readLegacy()', VIEW_T),
    ('more bytes than promised accepted', DIRECT, "    if (this.received > this.header.size) return 'invalid'\n", '', DIRECT_T),
    ('text accepted as file bytes', DIRECT, "    if (!(data instanceof ArrayBuffer)) return 'invalid'\n", '', DIRECT_T),
    ('any header accepted', DIRECT, "if (typeof header.messageId !== 'string' || !UUID.test(header.messageId)) return null", '', DIRECT_T),
    ('stale invites kept', INVITE, 'if (now - saved.at > KEEP_MS) {', 'if (false) {', INVITE_T),
    ('malformed decrypted record accepted', VIEW,
     "if (!valid(value)) throw new Error('Not the expected shape')", 'if (false) throw new Error(0)', SHAPES_T),
    ('any file type sent and opened', MEDIA,
     "export const PLAYABLE_TYPE = /^(image\\/(?!svg)[\\w.+-]+|video\\/[\\w.+-]+)$/i",
     'export const PLAYABLE_TYPE = /.*/', MEDIA_T),
    ('signals dated in the future accepted', ROOM, 'Math.abs(Date.now() - at)', '(Date.now() - at)', ROOM_T),
    ('room joined as a public channel', ROOM, 'config: { private: true,', 'config: { private: false,', ROOM_T),
    ('signals for someone else, or from a stranger, accepted', DIRECT,
     'if (signal.to !== selfId || !acceptFrom(signal.from)) return', 'if (false) return', DIRECT_T),
    ('no cap on transfers at once', DIRECT, 'transfersBySession.size < MAX_INCOMING', 'true', DIRECT_T),
    ('any file type prepared for sending', MEDIA,
     "  if (!PLAYABLE_TYPE.test(file.type)) throw new Error('Only photos and videos can be sent.')\n", '', MEDIA_T),
    ("sender's file type trusted when opening", CHAT,
     "const type = message.media && PLAYABLE_TYPE.test(message.media.mime) ? message.media.mime : 'application/octet-stream'",
     "const type = message.media?.mime ?? 'application/octet-stream'", CHAT_T),
    ('key made exportable', E2E, "    false,\n    ['encrypt', 'decrypt'],\n", "    true,\n    ['encrypt', 'decrypt'],\n", E2E_T),
    ('a stored-data label changed', E2E, '`duo:msg:${spaceId}', '`duo:message:${spaceId}', E2E_T),
    ('sign-out keeps the keys', SESSION, 'keystore.clear().catch(() => {}), ', '', SESSION_T),
    ("another space's waiting photos cleared", CHAT,
     'const gone = expired || openedHere', 'const gone = expired || openedHere || message === undefined', CHAT_T),
    ('a rename reaches every space', CONTENT, ".eq('space_id', spaceId).eq('user_id', userId)", ".eq('user_id', userId)", CONTENT_T),
    ('the last-opened space forgotten', SPACES, 'if (lastOpened && spaceIds.includes(lastOpened)) return lastOpened', '', SPACES_T),
    ("a locked space's plaintext name shown", SPACES,
     'if (!cipher) return encryptionOn ? null : (plaintext ?? null)', 'if (!cipher) return plaintext ?? null', SPACES_T),
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
