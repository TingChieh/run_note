#!/usr/bin/env python3
"""Describe how two PNG screenshots differ (dimensions, differing pixels, bounding box).

  png_diff.py A.png B.png

Pure standard library (8-bit, non-interlaced RGB/RGBA only). Diagnostics for CI annotations.
"""

import struct
import sys
import zlib


def read(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, chunks = 8, []
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        chunks.append((kind, data[pos + 8 : pos + 8 + length]))
        pos += 12 + length
    width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    assert depth == 8 and color in (2, 6) and interlace == 0, (depth, color, interlace)
    channels = 3 if color == 2 else 4
    raw = zlib.decompress(b"".join(c for k, c in chunks if k == b"IDAT"))
    stride = width * channels
    rows, prev = [], bytearray(stride)
    for y in range(height):
        base = y * (stride + 1)
        kind, line = raw[base], bytearray(raw[base + 1 : base + 1 + stride])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        rows.append(line)
        prev = line
    return width, height, channels, rows


def main(argv):
    wa, ha, ca, ra = read(argv[1])
    wb, hb, cb, rb = read(argv[2])
    print(f"A={wa}x{ha} B={wb}x{hb}", end=" ")
    if (wa, ha, ca) != (wb, hb, cb):
        print("-> different dimensions")
        return 0
    count, peak, box = 0, 0, [wa, ha, -1, -1]
    for y in range(ha):
        if ra[y] == rb[y]:
            continue
        for x in range(wa):
            pa, pb = ra[y][x * ca : x * ca + ca], rb[y][x * ca : x * ca + ca]
            if pa != pb:
                count += 1
                peak = max(peak, max(abs(i - j) for i, j in zip(pa, pb, strict=True)))
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
    print(f"differing_pixels={count} of {wa * ha} max_channel_delta={peak} bbox={box}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
