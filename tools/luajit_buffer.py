"""LuaJIT string.buffer serialization format.

Authoritative spec: https://luajit.org/ext_buffer.html ("Serialization Format
Specification"). This module implements the subset needed for Towers of Scale
.sav files, plus decoding of every documented tag so unexpected data is
reported rather than silently misread.

Prefix-encoded unsigned (.U):
    n <= 0xDF                 -> one byte
    0xE0 <= n <= 0x1FDF       -> (0xE0 | ((n-0xE0)>>8 & 0x1F)), ((n-0xE0) & 0xFF)
    n >= 0x1FE0               -> 0xFF, n as 32-bit little-endian
"""
import struct, zlib

MAX_U2 = 0x1FDF

def enc_u(n):
    if n <= 0xDF: return bytes([n])
    if n <= MAX_U2:
        d = n - 0xE0
        return bytes([0xE0 | ((d >> 8) & 0x1F), d & 0xFF])
    return b'\xFF' + struct.pack('<I', n)

def dec_u(d, i):
    c = d[i]
    if c <= 0xDF: return c, i+1
    if c == 0xFF: return struct.unpack('<I', d[i+1:i+5])[0], i+5
    return 0xE0 + ((c & 0x1F) << 8) + d[i+1], i+2

class Dict(dict): pass          # 0x09 hash table
class Arr1(list): pass          # 0x0C 1-based array

def parse(d, i=0):
    t = d[i]
    if t == 0x00: return None, i+1
    if t == 0x01: return False, i+1
    if t == 0x02: return True, i+1
    if t == 0x06: return struct.unpack('<i', d[i+1:i+5])[0], i+5      # int32
    if t == 0x07: return struct.unpack('<d', d[i+1:i+9])[0], i+9      # double
    if t == 0x08: return Dict(), i+1                                  # empty table
    if t == 0x09:                                                     # hash table
        n, i = dec_u(d, i+1); out = []
        for _ in range(n):
            k, i = parse(d, i); v, i = parse(d, i); out.append((k, v))
        return Dict(out), i
    if t == 0x0A:                                                     # 0-based array
        n, i = dec_u(d, i+1); out = []
        for _ in range(n): v, i = parse(d, i); out.append(v)
        return out, i
    if t == 0x0C:                                                     # 1-based array
        n, i = dec_u(d, i+1); out = []
        for _ in range(n-1): v, i = parse(d, i); out.append(v)
        return Arr1(out), i
    if t == 0x10: return struct.unpack('<q', d[i+1:i+9])[0], i+9
    if t == 0x11: return struct.unpack('<Q', d[i+1:i+9])[0], i+9
    if t in (0x03, 0x04, 0x05, 0x0B, 0x0D, 0x0E, 0x0F, 0x12):
        raise NotImplementedError('LuaJIT tag 0x%02x at %d — documented but unused '
                                  'by TOS so far; implement before trusting' % (t, i))
    if t >= 0x20 or t == 0xFF:                                        # string
        n, i = dec_u(d, i); L = n - 0x20
        return d[i:i+L], i+L
    raise ValueError('unknown tag 0x%02x at %d' % (t, i))

def emit(v):
    if isinstance(v, (bytes, str)):
        b = v.encode() if isinstance(v, str) else v
        return enc_u(len(b) + 0x20) + b
    if isinstance(v, dict):
        if not v: return b'\x08'
        return b'\x09' + enc_u(len(v)) + b''.join(emit(k)+emit(x) for k, x in v.items())
    if isinstance(v, (list, tuple)):
        return b'\x0C' + enc_u(len(v)+1) + b''.join(emit(x) for x in v)
    if isinstance(v, bool): return bytes([0x02 if v else 0x01])
    if v is None: return b'\x00'
    if isinstance(v, (int, float)): return b'\x07' + struct.pack('<d', float(v))
    raise TypeError(type(v))

# --- Towers of Scale specifics -------------------------------------------
def load(path):
    d = open(path, 'rb').read()
    top, end = parse(d, 0)
    assert end == len(d), ('trailing bytes', end, len(d))
    return top, d

def entries(blob):
    """Undo history. Entries are usually (floor,x,y) but NOT always: 'orb'
    moves in tower 3-1 add two more values, giving a 5-tuple. Arity may grow
    again as towers are added. Never assume 3."""
    assert blob[:8] == b'TOSSAVE\x00'
    return [tuple(int(x) for x in e) for e in parse(zlib.decompress(blob[8:]), 0)[0]]

def make_blob(rows):
    return b'TOSSAVE\x00' + zlib.compress(emit([list(r) for r in rows]))
