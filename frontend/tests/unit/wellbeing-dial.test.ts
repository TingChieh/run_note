import { describe, expect, it } from 'vitest';
import { arcPath, fractionAt, parseDuration, pointAt, valueAt } from '../../src/lib/components/wellbeing-dial-math';

describe('round slider geometry', () => {
  it('starts at the lower left, passes the top at half way and ends at the lower right', () => {
    const [x0, y0] = pointAt(40, 0), [xm, ym] = pointAt(40, 0.5), [x1, y1] = pointAt(40, 1);
    expect(x0).toBeCloseTo(50 - 40 * Math.SQRT1_2, 3); expect(y0).toBeCloseTo(50 + 40 * Math.SQRT1_2, 3);
    expect(xm).toBeCloseTo(50, 3); expect(ym).toBeCloseTo(10, 3);
    expect(x1).toBeCloseTo(50 + 40 * Math.SQRT1_2, 3); expect(y1).toBeCloseTo(50 + 40 * Math.SQRT1_2, 3);
  });
  it('draws arcs with the right large-arc flag', () => {
    expect(arcPath(40, 0.5)).toContain(' 0 0 1 '); // 135°: the short way
    expect(arcPath(40, 1)).toContain(' 0 1 1 '); // 270°: the long way
  });
  it('maps a pointer offset to a fraction, snapping the opening to the nearer end', () => {
    expect(fractionAt(0, -10, 0)).toBeCloseTo(0.5, 6); // straight up
    expect(fractionAt(10, 0, 0)).toBeCloseTo(225 / 270, 6); // right
    expect(fractionAt(-10, 0, 0)).toBeCloseTo(45 / 270, 6); // left
    expect(fractionAt(0.5, 10, 0.2)).toBe(0); // straight down, was near the start
    expect(fractionAt(-0.5, 10, 0.9)).toBe(1); // straight down, was near the end
  });
  it('rounds to the grid and stays inside the range', () => {
    expect(valueAt(0.5, 0, 10, 1)).toBe(5);
    expect(valueAt(0.5, 0, 59, 1)).toBe(30);
    expect(valueAt(1, 0, 10, 1)).toBe(10);
    expect(valueAt(0, 0, 10, 1)).toBe(0);
    expect(valueAt(0.37, 0, 100, 5)).toBe(35);
  });
});

describe('typed sleep durations', () => {
  it('understands h:mm, decimal hours and words, exact to the minute', () => {
    expect(parseDuration('7:25')).toBe(7.42);
    expect(parseDuration('7：25')).toBe(7.42);
    expect(parseDuration(' 7 : 05 ')).toBe(7.08);
    expect(parseDuration('7.5')).toBe(7.5);
    expect(parseDuration('7')).toBe(7);
    expect(parseDuration('7h25m')).toBe(7.42);
    expect(parseDuration('7时25分')).toBe(7.42);
    expect(parseDuration('7小时30分钟')).toBe(7.5);
    expect(parseDuration('7小时')).toBe(7);
    expect(parseDuration('0:45')).toBe(0.75);
    expect(parseDuration('24:00')).toBe(24);
  });
  it('round-trips every whole minute through the stored two decimals', () => {
    for (let minutes = 0; minutes <= 1440; minutes++) {
      const typed = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
      expect(Math.round(parseDuration(typed)! * 60)).toBe(minutes);
    }
  });
  it('refuses what it cannot read or what is not a duration of a day', () => {
    for (const bad of ['', 'abc', '7:60', '25:00', '24:01', '7:5:3', '-1', '7,5', '1e3', '7.555.1', '7h61m']) expect(parseDuration(bad), bad).toBeNull();
  });
});
