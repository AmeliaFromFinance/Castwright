import { describe, expect, it } from 'vitest';
import { rollOffset, rollPlan } from './credits';
import { enterY, ordered, stackEdge, tickerCopies, tickerX } from './order';

describe('list order', () => {
  it('flips newest-first lists for newest at the bottom', () => {
    expect(ordered(['c', 'b', 'a'], true)).toEqual(['c', 'b', 'a']);
    expect(ordered(['c', 'b', 'a'], false)).toEqual(['a', 'b', 'c']);
  });

  it('stacks against the edge new items come in at, unless set', () => {
    expect(stackEdge(false, 'auto')).toBe('bottom');
    expect(stackEdge(true, undefined)).toBe('top');
    expect(stackEdge(false, 'top')).toBe('top');
    expect(stackEdge(true, 'bottom')).toBe('bottom');
  });

  it('slides new items in from their edge', () => {
    expect(enterY('top', 14)).toBe(-14);
    expect(enterY('bottom', 14)).toBe(14);
  });
});

describe('ticker', () => {
  it('moves left or right and wraps after one copy', () => {
    expect(tickerX(0, 100, false)).toBe(-0);
    expect(tickerX(30, 100, false)).toBe(-30);
    expect(tickerX(130, 100, false)).toBe(-30);
    expect(tickerX(0, 100, true)).toBe(-100);
    expect(tickerX(30, 100, true)).toBe(-70);
    expect(tickerX(130, 100, true)).toBe(-70);
  });

  it('draws an extra copy when moving right so the left edge is filled', () => {
    expect(tickerCopies(250, 100, false)).toBe(4);
    expect(tickerCopies(250, 100, true)).toBe(5);
    expect(tickerCopies(250, 0, true)).toBe(1);
  });
});

describe('credits scroll', () => {
  it('scrolling down starts above the box and moves down', () => {
    const up = rollPlan(500, 1200, { speed: 100, fitS: 0, repeat: false });
    const down = rollPlan(500, 1200, { speed: 100, fitS: 0, repeat: false, down: true });
    expect([up.from, up.to]).toEqual([500, -700]);
    expect([down.from, down.to]).toEqual([-1200, 0]);
    expect(down.ms).toBe(12_000);
    expect(rollOffset(down, 6000, false)).toBe(-600);
  });

  it('repeating down rolls leave through the bottom', () => {
    const down = rollPlan(500, 1200, { speed: 100, fitS: 0, repeat: true, down: true });
    expect([down.from, down.to]).toEqual([-1200, 500]);
  });

  it('short credits settle in the middle either way', () => {
    expect(rollPlan(500, 300, { speed: 100, fitS: 0, repeat: false, down: true }).to).toBe(100);
    expect(rollPlan(500, 300, { speed: 100, fitS: 0, repeat: false }).to).toBe(100);
  });
});
