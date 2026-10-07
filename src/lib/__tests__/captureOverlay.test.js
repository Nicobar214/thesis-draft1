import { describe, expect, it, vi } from 'vitest';
import { captureOverlayLines, paintCaptureOverlay } from '../captureOverlay';

describe('captureOverlayLines', () => {
  const now = new Date('2026-03-05T08:09:10');

  it('stamps the time and the GPS position with accuracy', () => {
    const lines = captureOverlayLines(now, { lat: 10.123456789, lng: 122.5, accuracy: 7.6 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/2026/);
    expect(lines[1]).toBe('GPS: 10.123457, 122.500000 (±8m)');
  });

  it('still stamps the time when there is no GPS fix', () => {
    const lines = captureOverlayLines(now, null);
    expect(lines).toHaveLength(1);
  });

  it('treats a missing accuracy as 0', () => {
    expect(captureOverlayLines(now, { lat: 1, lng: 2 })[1]).toMatch(/\(±0m\)$/);
  });
});

describe('paintCaptureOverlay', () => {
  function fakeCtx() {
    return {
      measureText: vi.fn((text) => ({ width: text.length * 10 })),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    };
  }

  it('draws a dark strip along the bottom and writes every line on it', () => {
    const ctx = fakeCtx();
    const canvas = { width: 1280, height: 720 };
    paintCaptureOverlay(ctx, canvas, ['line one', 'second line here']);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    const [x, y, w, h] = ctx.fillRect.mock.calls[0];
    expect(x).toBe(0);
    expect(y + h).toBe(canvas.height); // flush with the bottom edge
    expect(w).toBeGreaterThan('second line here'.length * 10); // wide enough for the longest line
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('scales the text with the photo but never below a readable size', () => {
    const small = fakeCtx();
    paintCaptureOverlay(small, { width: 200, height: 100 }, ['x']);
    expect(small.font).toBe('bold 14px monospace');

    const large = fakeCtx();
    paintCaptureOverlay(large, { width: 2500, height: 1400 }, ['x']);
    expect(large.font).toBe('bold 50px monospace');
  });
});
