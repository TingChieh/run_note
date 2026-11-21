import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecap, recapPosterStyles, recapSlots, type RecapPosterStyle } from '#lib/recap.ts';
import { renderRecap } from '#lib/share/recap-render.ts';
import type { PeriodReport } from '#lib/api/period-report.ts';
import type { Trends } from '#lib/api/statistics.ts';

interface CapturedDraw {
  width: number;
  height: number;
  texts: { text: string; font: string; x: number; y: number }[];
  fills: string[];
  hasNaN: boolean;
  released: boolean;
}

function installCanvasMock(theme: 'light' | 'dark' = 'light') {
  const captured: CapturedDraw = {
    width: 0,
    height: 0,
    texts: [],
    fills: [],
    hasNaN: false,
    released: false,
  };

  const checkNums = (...nums: number[]) => {
    if (nums.some((n) => typeof n === 'number' && !Number.isFinite(n))) {
      captured.hasNaN = true;
    }
  };

  const ctx = {
    font: '400 16px sans-serif',
    fillStyle: '#000000' as string | object,
    strokeStyle: '#000000' as string | object,
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    textAlign: 'left',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn((x: number, y: number) => checkNums(x, y)),
    translate: vi.fn((x: number, y: number) => checkNums(x, y)),
    rotate: vi.fn((a: number) => checkNums(a)),
    clip: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    setLineDash: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => checkNums(x, y)),
    lineTo: vi.fn((x: number, y: number) => checkNums(x, y)),
    quadraticCurveTo: vi.fn((a: number, b: number, c: number, d: number) => checkNums(a, b, c, d)),
    bezierCurveTo: vi.fn((a: number, b: number, c: number, d: number, e: number, f: number) =>
      checkNums(a, b, c, d, e, f),
    ),
    arc: vi.fn((x: number, y: number, r: number, s: number, e: number) => checkNums(x, y, r, s, e)),
    rect: vi.fn((x: number, y: number, w: number, h: number) => checkNums(x, y, w, h)),
    roundRect: vi.fn((x: number, y: number, w: number, h: number) => checkNums(x, y, w, h)),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      checkNums(x, y, w, h);
      if (typeof ctx.fillStyle === 'string') captured.fills.push(ctx.fillStyle);
    }),
    fill: vi.fn(() => {
      if (typeof ctx.fillStyle === 'string') captured.fills.push(ctx.fillStyle);
    }),
    stroke: vi.fn(),
    createLinearGradient: vi.fn((a: number, b: number, c: number, d: number) => {
      checkNums(a, b, c, d);
      return { addColorStop: vi.fn() };
    }),
    measureText: vi.fn((value: string) => {
      const match = ctx.font.match(/(\d+(?:\.\d+)?)px/);
      const px = match ? Number(match[1]) : 16;
      return { width: value.length * px * 0.62 };
    }),
    fillText: vi.fn((value: string, x: number, y: number) => {
      checkNums(x, y);
      captured.texts.push({ text: value, font: ctx.font, x, y });
    }),
  };

  let w = 0;
  let h = 0;
  const canvas = {
    get width() {
      return w;
    },
    set width(value: number) {
      if (value > 0) captured.width = value;
      if (value === 0 && captured.width > 0) captured.released = true;
      w = value;
    },
    get height() {
      return h;
    },
    set height(value: number) {
      if (value > 0) captured.height = value;
      h = value;
    },
    getContext: () => ctx,
    toBlob: (cb: (blob: Blob | null) => void, type?: string) => {
      cb(new Blob(['synthetic-png'], { type: type ?? 'image/png' }));
    },
  };

  vi.stubGlobal('document', {
    fonts: { ready: Promise.resolve() },
    createElement: (tag: string) => {
      if (tag === 'canvas') return canvas;
      throw new Error(`unexpected tag ${tag}`);
    },
  });

  const tokens: Record<string, string> =
    theme === 'dark'
      ? {
          '--background': '#292725',
          '--surface': '#33312f',
          '--foreground': '#f2f0ee',
          '--muted-foreground': '#b1aca6',
          '--primary': '#77d4ac',
          '--border': '#46433f',
          '--sport-yellow': '#54451d',
          '--sport-heading-ink': '#ffe9a5',
          '--primary-foreground': '#10251b',
          '--success': '#9fe1b6',
          '--font-body': 'system-ui, sans-serif',
          '--recap-forest': '#1e2421',
          '--recap-forest-deep': '#151917',
          '--recap-desk': '#201e1c',
          '--recap-paper': '#312f2c',
        }
      : {
          '--background': '#f6f7f4',
          '--surface': '#ffffff',
          '--foreground': '#202d23',
          '--muted-foreground': '#5c695e',
          '--primary': '#17745c',
          '--border': '#e0e6da',
          '--sport-yellow': '#f5c519',
          '--sport-heading-ink': '#20332b',
          '--primary-foreground': '#ffffff',
          '--success': '#176448',
          '--font-body': 'system-ui, sans-serif',
          '--recap-forest': '#124e3d',
          '--recap-forest-deep': '#0b3529',
          '--recap-desk': '#eaece4',
          '--recap-paper': '#fcfcf7',
        };

  vi.stubGlobal('getComputedStyle', () => ({
    colorScheme: theme,
    getPropertyValue: (name: string) => tokens[name] ?? '',
  }));

  const fakeElement = {
    closest: () => ({ getAttribute: () => theme }),
  } as unknown as HTMLElement;

  return { captured, fakeElement };
}

function makeYearRecap(overrides: Partial<PeriodReport> = {}) {
  const report = {
    period: 'year',
    year: 2025,
    month: null,
    date_from: '2025-01-01',
    date_to: '2026-01-01',
    is_partial: false,
    cutoff_date: null,
    today: '2026-11-21',
    activity_count: 132,
    activity_days: 106,
    distance_m: '956240.000',
    duration_sum_seconds: '355212',
    known_duration_count: 132,
    missing_duration_count: 0,
    pace_eligible_count: 132,
    pace_eligible_distance_m: '956240.000',
    avg_pace_seconds_per_km: '371.5',
    quality_warning_count: 0,
    date_assignment: 'activity_local_date',
    // Forbidden PII fields injected to verify strict whitelist filtering.
    email: 'secret-runner@example.com',
    username: 'secret_runner',
    display_name: '林晨跑',
    activity_id: '11111111-1111-4111-8111-111111111111',
    city: '杭州市',
    notes: '膝盖微酸',
    avatar_url: '/api/v1/me/avatar',
    wellbeing: '用药记录',
    ...overrides,
  } as unknown as PeriodReport;

  const slots = recapSlots({ period: 'year', year: report.year, month: null });
  const observed = slots.filter((slot) => slot.start < report.date_to);
  const total = Number(report.distance_m);
  let remaining = total;
  const trends: Trends = {
    period: 'month',
    date_from: report.date_from,
    date_to: report.date_to,
    week_start: 'monday',
    date_assignment: 'activity_local_date',
    buckets: observed.map((slot, index) => {
      const end = slot.end < report.date_to ? slot.end : report.date_to;
      const dist = index === observed.length - 1 ? remaining : Math.round(total / observed.length);
      remaining -= dist;
      return {
        bucket_start: slot.start,
        bucket_end: end,
        is_partial: end !== slot.end,
        distance_m: String(dist),
        activity_count: Math.max(0, Math.round(report.activity_count / observed.length)),
        activity_days: Math.max(0, Math.round(report.activity_days / observed.length)),
        duration_sum_seconds: report.duration_sum_seconds === null ? null : '18000',
        known_duration_count: report.known_duration_count > 0 ? 1 : 0,
        missing_duration_count: report.missing_duration_count > 0 ? 1 : 0,
        pace_eligible_count: report.pace_eligible_count > 0 ? 1 : 0,
        pace_eligible_distance_m: String(dist),
        avg_pace_seconds_per_km: report.avg_pace_seconds_per_km === null ? null : String(350 + index * 3),
        quality_warning_count: 0,
        date_assignment: 'activity_local_date',
      };
    }),
  };

  return buildRecap(report, trends);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recap 9:16 Canvas 2D renderer (A/B/C styles & whitelist)', () => {
  it.each(recapPosterStyles.map((item) => item.id))(
    'renders style %s at 1080×1920 with whitelisted text only and releases canvas memory',
    async (style: RecapPosterStyle) => {
      const recap = makeYearRecap();
      const { captured, fakeElement } = installCanvasMock('light');
      const blob = await renderRecap(recap, fakeElement, { style });

      expect(blob.type).toBe('image/png');
      expect(captured.width).toBe(1080);
      expect(captured.height).toBe(1920);
      expect(captured.hasNaN).toBe(false);
      expect(captured.released).toBe(true);

      const joined = captured.texts.map((entry) => entry.text).join('\n');
      expect(joined).toContain('RunNote');
      expect(joined).toContain('2025 年跑步回顾');
      expect(joined).toContain('956.24');
      expect(joined).toContain('跑步次数');
      expect(joined).toContain('平均配速');

      // Style-specific signature landmarks.
      if (style === 'editorial') {
        expect(joined).toContain('02 · 全年里程地形');
        expect(joined).toContain('RUNNOTE · PERSONAL RECAP');
      } else if (style === 'telemetry') {
        expect(joined).toContain('TOTAL KM');
        expect(joined).toContain('RUNNOTE · TRACK TELEMETRY');
      } else if (style === 'receipt') {
        expect(joined).toContain('02 · PUNCH-CARD RHYTHM');
        expect(joined).toContain('03 · VERIFIED SUMMARY');
        expect(joined).toContain('MILEAGE FINGERPRINT · RUNNOTE');
      }

      // Strict privacy whitelist: zero PII, coordinates, URLs, city names, or wellbeing text.
      expect(joined).not.toMatch(
        /secret-runner|secret_runner|林晨跑|11111111|杭州市|膝盖微酸|avatar|用药记录|http:\/\/|https:\/\//,
      );
    },
  );

  it('draws distinct palettes for light vs dark across all three styles', async () => {
    const recap = makeYearRecap();
    for (const style of recapPosterStyles.map((item) => item.id)) {
      const light = installCanvasMock('light');
      await renderRecap(recap, light.fakeElement, { style });
      const dark = installCanvasMock('dark');
      await renderRecap(recap, dark.fakeElement, { style });
      expect(light.captured.fills).not.toEqual(dark.captured.fills);
    }
  });

  it('renders cutoff, extreme distance shrinking, single-bucket, and missing metrics safely across all styles', async () => {
    const partialExtreme = makeYearRecap({
      year: 2026,
      date_from: '2026-01-01',
      date_to: '2026-01-03',
      is_partial: true,
      cutoff_date: '2026-01-02',
      distance_m: '123456789.000',
      duration_sum_seconds: null,
      known_duration_count: 0,
      missing_duration_count: 2,
      pace_eligible_count: 0,
      pace_eligible_distance_m: '0',
      avg_pace_seconds_per_km: null,
      activity_count: 2,
      activity_days: 2,
    });

    for (const style of recapPosterStyles.map((item) => item.id)) {
      const { captured, fakeElement } = installCanvasMock('dark');
      await renderRecap(partialExtreme, fakeElement, { style });
      expect(captured.hasNaN).toBe(false);
      const joined = captured.texts.map((entry) => entry.text).join('\n');
      expect(joined).toContain('进行中 · 截至 01.02');
      expect(joined).toContain('123,456.79');
      expect(joined).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b/);
      // Verify dynamic shrinking kept the giant number font valid and smaller than base size.
      const distanceEntry = captured.texts.find((entry) => entry.text === '123,456.79');
      expect(distanceEntry).toBeDefined();
      const px = Number(distanceEntry!.font.match(/(\d+)px/)?.[1]);
      expect(px).toBeGreaterThanOrEqual(12);
      expect(px).toBeLessThan(196);
    }
  });

  it('supports scaled lightweight dock previews at 360×640', async () => {
    const recap = makeYearRecap();
    const { captured, fakeElement } = installCanvasMock('light');
    await renderRecap(recap, fakeElement, { style: 'receipt', scale: 1 / 3 });
    expect(captured.width).toBe(360);
    expect(captured.height).toBe(640);
    expect(captured.hasNaN).toBe(false);
    expect(captured.released).toBe(true);
  });
});
