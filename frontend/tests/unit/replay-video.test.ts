import { describe, expect, it } from 'vitest';
import { muxMp4 } from '../../src/lib/replay/mp4';
import { VIDEO_FPS, frameTime, videoSize } from '../../src/lib/replay/video-export';

interface Box {
  type: string;
  start: number;
  size: number;
  body: DataView;
}
function boxes(view: DataView, start = 0, end = view.byteLength): Box[] {
  const found: Box[] = [];
  for (let at = start; at < end;) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at + 4, 4));
    found.push({ type, start: at, size, body: new DataView(view.buffer, view.byteOffset + at + 8, size - 8) });
    expect(size).toBeGreaterThanOrEqual(8);
    at += size;
  }
  return found;
}
const child = (parent: Box, type: string, skip = 0) => {
  const box = boxes(parent.body, skip).find((b) => b.type === type);
  expect(box, type).toBeDefined();
  return box!;
};
const path = (root: Box, ...types: string[]) => types.reduce((box, type) => child(box, type), root);

async function sampleFile(reorder = false) {
  const avcC = new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 2, 0x68, 0xee]);
  const samples = [0, 1, 2, 3].map((i) => ({
    data: new Uint8Array(10 + i).fill(i + 1),
    timestamp: Math.round(((reorder ? [0, 2, 1, 3][i] : i) * 1e6) / 30),
    key: i === 0 || i === 3,
  }));
  const blob = muxMp4({ width: 720, height: 1280, fps: 30, avcC, samples });
  return { view: new DataView(await blob.arrayBuffer()), samples, blob };
}

describe('MP4 writer', () => {
  it('writes ftyp, moov then mdat with sample tables that point at the samples', async () => {
    const { view, samples, blob } = await sampleFile();
    expect(blob.type).toBe('video/mp4');
    const top = boxes(view);
    expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    const moov = top[1],
      mdat = top[2];
    const stbl = path(moov, 'trak', 'mdia', 'minf', 'stbl');
    // stco: version/flags, entry count, then the chunk offset of the first sample byte.
    const offset = child(stbl, 'stco').body.getUint32(8);
    expect(offset).toBe(mdat.start + 8);
    expect(new Uint8Array(view.buffer, offset, samples[0].data.length)).toEqual(samples[0].data);
    const stsz = child(stbl, 'stsz').body;
    expect(stsz.getUint32(8)).toBe(4);
    expect([0, 1, 2, 3].map((i) => stsz.getUint32(12 + i * 4))).toEqual([10, 11, 12, 13]);
    expect(mdat.size).toBe(8 + 10 + 11 + 12 + 13);
    const stss = child(stbl, 'stss').body;
    expect([stss.getUint32(4), stss.getUint32(8), stss.getUint32(12)]).toEqual([2, 1, 4]);
    const stts = child(stbl, 'stts').body;
    expect([stts.getUint32(4), stts.getUint32(8), stts.getUint32(12)]).toEqual([1, 4, 1000]);
    expect(boxes(stbl.body).some((b) => b.type === 'ctts')).toBe(false);
    // tkhd width/height are 16.16 fixed point at the end of the box.
    const tkhd = path(moov, 'trak', 'tkhd').body;
    expect(tkhd.getUint32(tkhd.byteLength - 8) / 65536).toBe(720);
    expect(tkhd.getUint32(tkhd.byteLength - 4) / 65536).toBe(1280);
    const mdhd = path(moov, 'trak', 'mdia', 'mdhd').body;
    expect(mdhd.getUint32(12)).toBe(30000); // timescale
    expect(mdhd.getUint32(16)).toBe(4000); // 4 frames
    // stsd → avc1 (78-byte visual sample entry) → avcC holds the encoder's record unchanged.
    const avc1 = child(child(stbl, 'stsd'), 'avc1', 8);
    expect(avc1.body.getUint16(24)).toBe(720);
    expect(child(avc1, 'avcC', 78).body.getUint8(1)).toBe(0x64);
  });
  it('adds composition offsets only when presentation order differs from decode order', async () => {
    const { view } = await sampleFile(true);
    const stbl = path(boxes(view)[1], 'trak', 'mdia', 'minf', 'stbl');
    const ctts = child(stbl, 'ctts').body;
    expect(ctts.getUint8(0)).toBe(1); // signed offsets
    expect([0, 1, 2, 3].map((i) => ctts.getInt32(12 + i * 8))).toEqual([0, 1000, -1000, 0]);
  });
  it('refuses an empty video', () => {
    expect(() => muxMp4({ width: 2, height: 2, fps: 30, avcC: new Uint8Array(1), samples: [] })).toThrow();
  });
});

describe('video timeline', () => {
  it('sizes each aspect for 720p and 1080p', () => {
    expect(videoSize('9:16', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(videoSize('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(videoSize('1:1', '720p')).toEqual({ width: 720, height: 720 });
    expect(videoSize('9:16', '720p')).toEqual({ width: 720, height: 1280 });
  });
  it('travels the whole track, then holds the finished route until the last frame', () => {
    const frames = 15 * VIDEO_FPS;
    expect(frameTime(0, 15, 100)).toBe(0);
    const times = Array.from({ length: frames }, (_, k) => frameTime(k, 15, 100));
    const reached = times.findIndex((t) => t === 100);
    expect(times.slice(1).every((t, k) => t >= times[k])).toBe(true);
    // About 1.5 s of hold at 30 fps.
    expect(frames - reached).toBeGreaterThanOrEqual(44);
    expect(frames - reached).toBeLessThanOrEqual(47);
  });
});
