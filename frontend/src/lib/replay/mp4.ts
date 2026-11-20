/**
 * Minimal MP4 (ISO BMFF) writer for one H.264 video track, as produced by WebCodecs with
 * `avc: { format: 'avc' }`: length-prefixed samples plus an avcC decoder configuration record.
 * moov precedes mdat so players can start before the whole file is read. No audio, no edit lists.
 */
export interface Mp4Sample {
  data: Uint8Array;
  /** Presentation time in microseconds, as WebCodecs reports it. */
  timestamp: number;
  key: boolean;
}
export interface Mp4Options {
  width: number;
  height: number;
  fps: number;
  /** AVCDecoderConfigurationRecord from VideoEncoder metadata.decoderConfig.description. */
  avcC: Uint8Array;
  samples: Mp4Sample[];
}

const MOVIE_TIMESCALE = 1000;
// 2^32 - 1: 32-bit box sizes and chunk offsets are enough for the exports this writes (well under 1 GB).
const MAX_U32 = 0xffffffff;

class Writer {
  bytes: number[] = [];
  u8(value: number) {
    this.bytes.push(value & 0xff);
  }
  u16(value: number) {
    this.u8(value >>> 8);
    this.u8(value);
  }
  u32(value: number) {
    if (value < 0 || value > MAX_U32) throw new RangeError('MP4 field out of range');
    this.u16(value >>> 16);
    this.u16(value & 0xffff);
  }
  i32(value: number) {
    this.u32(value >>> 0);
  }
  ascii(text: string) {
    for (const char of text) this.u8(char.charCodeAt(0));
  }
  zeros(count: number) {
    for (let i = 0; i < count; i++) this.bytes.push(0);
  }
}

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 8 + children.reduce((sum, child) => sum + child.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let offset = 8;
  for (const child of children) {
    out.set(child, offset);
    offset += child.length;
  }
  return out;
}
function fields(write: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  write(w);
  return new Uint8Array(w.bytes);
}
const full = (type: string, version: number, flags: number, write: (w: Writer) => void, ...children: Uint8Array[]) =>
  box(
    type,
    fields((w) => {
      w.u8(version);
      w.u8(flags >>> 16);
      w.u16(flags & 0xffff);
      write(w);
    }),
    ...children,
  );
// Identity transform: 16.16 fixed point, then 2.30 for the last column.
const matrix = (w: Writer) => [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].forEach((value) => w.u32(value));

export function muxMp4({ width, height, fps, avcC, samples }: Mp4Options): Blob {
  if (!samples.length) throw new Error('No video samples');
  const timescale = fps * 1000;
  const delta = 1000; // one frame in media timescale units
  const mediaDuration = samples.length * delta;
  const movieDuration = Math.round((mediaDuration / timescale) * MOVIE_TIMESCALE);
  // Encoders may emit frames in decode order with reordered presentation times (B-frames).
  const offsets = samples.map((sample, i) => Math.round((sample.timestamp / 1e6) * timescale) - i * delta);
  const reordered = offsets.some((offset) => offset !== 0);

  const stsd = full(
    'stsd',
    0,
    0,
    (w) => w.u32(1),
    box(
      'avc1',
      fields((w) => {
        w.zeros(6);
        w.u16(1); // data_reference_index
        w.zeros(16);
        w.u16(width);
        w.u16(height);
        w.u32(0x00480000); // 72 dpi
        w.u32(0x00480000);
        w.u32(0);
        w.u16(1); // frame_count
        w.zeros(32); // compressorname
        w.u16(0x0018); // depth
        w.u16(0xffff); // pre_defined = -1
      }),
      box('avcC', avcC),
    ),
  );
  const stts = full('stts', 0, 0, (w) => {
    w.u32(1);
    w.u32(samples.length);
    w.u32(delta);
  });
  const stss = full('stss', 0, 0, (w) => {
    const keys = samples.flatMap((sample, i) => (sample.key ? [i + 1] : []));
    w.u32(keys.length);
    keys.forEach((key) => w.u32(key));
  });
  const ctts = reordered
    ? [
        full('ctts', 1, 0, (w) => {
          w.u32(samples.length);
          offsets.forEach((offset) => {
            w.u32(1);
            w.i32(offset);
          });
        }),
      ]
    : [];
  const stsc = full('stsc', 0, 0, (w) => {
    w.u32(1);
    w.u32(1);
    w.u32(samples.length); // every sample in one chunk
    w.u32(1);
  });
  const stsz = full('stsz', 0, 0, (w) => {
    w.u32(0);
    w.u32(samples.length);
    samples.forEach((sample) => w.u32(sample.data.length));
  });
  const moov = (chunkOffset: number) =>
    box(
      'moov',
      full('mvhd', 0, 0, (w) => {
        w.u32(0);
        w.u32(0);
        w.u32(MOVIE_TIMESCALE);
        w.u32(movieDuration);
        w.u32(0x00010000); // rate 1.0
        w.u16(0x0100); // volume 1.0
        w.zeros(10);
        matrix(w);
        w.zeros(24);
        w.u32(2); // next_track_ID
      }),
      box(
        'trak',
        full('tkhd', 0, 3, (w) => {
          w.u32(0);
          w.u32(0);
          w.u32(1); // track_ID
          w.u32(0);
          w.u32(movieDuration);
          w.zeros(8);
          w.u16(0); // layer
          w.u16(0); // alternate_group
          w.u16(0); // volume: video
          w.u16(0);
          matrix(w);
          w.u32(width * 0x10000);
          w.u32(height * 0x10000);
        }),
        box(
          'mdia',
          full('mdhd', 0, 0, (w) => {
            w.u32(0);
            w.u32(0);
            w.u32(timescale);
            w.u32(mediaDuration);
            w.u16(0x55c4); // 'und'
            w.u16(0);
          }),
          full('hdlr', 0, 0, (w) => {
            w.u32(0);
            w.ascii('vide');
            w.zeros(12);
            w.ascii('VideoHandler');
            w.u8(0);
          }),
          box(
            'minf',
            full('vmhd', 0, 1, (w) => w.zeros(8)),
            box(
              'dinf',
              full(
                'dref',
                0,
                0,
                (w) => w.u32(1),
                full('url ', 0, 1, () => {}),
              ),
            ),
            box(
              'stbl',
              stsd,
              stts,
              stss,
              ...ctts,
              stsc,
              stsz,
              full('stco', 0, 0, (w) => {
                w.u32(1);
                w.u32(chunkOffset);
              }),
            ),
          ),
        ),
      ),
    );
  const ftyp = box(
    'ftyp',
    fields((w) => {
      w.ascii('isom');
      w.u32(0x200);
      w.ascii('isomiso2avc1mp41');
    }),
  );
  const payload = samples.reduce((sum, sample) => sum + sample.data.length, 0);
  // The moov size does not depend on the offset value, so measure it once with a placeholder.
  const header = ftyp.length + moov(0).length + 8;
  if (header + payload > MAX_U32) throw new RangeError('Video too large');
  const mdatHeader = new Uint8Array(8);
  new DataView(mdatHeader.buffer).setUint32(0, 8 + payload);
  mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4); // 'mdat'
  return new Blob([ftyp, moov(header), mdatHeader, ...samples.map((sample) => sample.data)] as BlobPart[], {
    type: 'video/mp4',
  });
}
