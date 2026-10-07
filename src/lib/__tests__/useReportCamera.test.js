// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { describeCameraError, useReportCamera } from '../useReportCamera';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, getTracks: () => [track] };
}

function stubCamera(getUserMedia) {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

/** Let the camera's async start finish. */
const flush = () => act(async () => {});

let urlCounter;
beforeEach(() => {
  urlCounter = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++urlCounter}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  delete navigator.mediaDevices;
});

describe('describeCameraError', () => {
  it('distinguishes a refused permission from other failures', () => {
    expect(describeCameraError({ name: 'NotAllowedError' })).toMatch(/permission denied/i);
    expect(describeCameraError({ name: 'NotFoundError', message: 'no camera' })).toBe('Camera error: no camera');
  });
});

describe('useReportCamera: running the camera', () => {
  it('does nothing until the reporting step is active', async () => {
    const getUserMedia = stubCamera(vi.fn(async () => fakeStream()));
    renderHook(() => useReportCamera({ gps: null, active: false }));
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('starts the rear camera when the step becomes active', async () => {
    const getUserMedia = stubCamera(vi.fn(async () => fakeStream()));
    const { rerender } = renderHook(({ active }) => useReportCamera({ gps: null, active }), {
      initialProps: { active: false },
    });
    rerender({ active: true });
    await flush();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { facingMode: 'environment' }, audio: false });
  });

  it('releases the camera when the step is left', async () => {
    const stream = fakeStream();
    stubCamera(vi.fn(async () => stream));
    const { rerender } = renderHook(({ active }) => useReportCamera({ gps: null, active }), {
      initialProps: { active: true },
    });
    await flush();

    rerender({ active: false });

    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('releases the camera when the form is closed mid-report', async () => {
    const stream = fakeStream();
    stubCamera(vi.fn(async () => stream));
    const { unmount } = renderHook(() => useReportCamera({ gps: null, active: true }));
    await flush();

    unmount();

    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('releases a camera that finished starting after the user had already left', async () => {
    const stream = fakeStream();
    let grant;
    stubCamera(vi.fn(() => new Promise((resolve) => { grant = () => resolve(stream); })));
    const { rerender, result } = renderHook(({ active }) => useReportCamera({ gps: null, active }), {
      initialProps: { active: true },
    });

    rerender({ active: false }); // leave while the browser is still asking for permission
    await act(async () => { grant(); });

    expect(stream.track.stop).toHaveBeenCalled();
    expect(result.current.camReady).toBe(false);
  });

  it('shows a clear message when the camera permission is refused', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    stubCamera(vi.fn(async () => { throw err; }));
    const { result } = renderHook(() => useReportCamera({ gps: null, active: true }));
    await flush();

    expect(result.current.camError).toMatch(/permission denied/i);
  });
});

describe('useReportCamera: taking and retaking the photo', () => {
  function setupCapture(result, ctx) {
    result.current.videoRef.current = { videoWidth: 640, videoHeight: 480 };
    result.current.canvasRef.current = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (done) => done(new Blob(['jpeg'], { type: 'image/jpeg' })),
    };
  }
  const fakeCtx = () => ({
    drawImage: vi.fn(),
    measureText: () => ({ width: 100 }),
    fillRect: vi.fn(),
    fillText: vi.fn(),
  });

  it('captures a stamped photo and turns the camera off', async () => {
    const stream = fakeStream();
    stubCamera(vi.fn(async () => stream));
    const ctx = fakeCtx();
    const gps = { lat: 10, lng: 122, accuracy: 6 };
    const { result } = renderHook(() => useReportCamera({ gps, active: true }));
    await flush();
    setupCapture(result, ctx);

    act(() => result.current.capturePhoto());

    expect(result.current.photoBlob).toBeInstanceOf(Blob);
    expect(result.current.photoPreview).toBe('blob:preview-1');
    expect(result.current.photoTs).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ctx.drawImage).toHaveBeenCalled();
    const stamped = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(stamped.some((line) => line.startsWith('GPS: 10.000000, 122.000000'))).toBe(true);
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('retake opens exactly one new camera and frees the old preview', async () => {
    const getUserMedia = stubCamera(vi.fn(async () => fakeStream()));
    const { result } = renderHook(() => useReportCamera({ gps: null, active: true }));
    await flush();
    setupCapture(result, fakeCtx());
    act(() => result.current.capturePhoto());
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => result.current.retakePhoto());
    await flush();

    // Previously the camera was requested twice here and the first stream was never stopped.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(result.current.photoBlob).toBeNull();
    expect(result.current.photoPreview).toBeNull();
  });

  it('does nothing if the camera is not on screen yet', () => {
    stubCamera(vi.fn(async () => fakeStream()));
    const { result } = renderHook(() => useReportCamera({ gps: null, active: false }));
    act(() => result.current.capturePhoto());
    expect(result.current.photoBlob).toBeNull();
  });

  it('resetPhoto discards the photo, its preview and its timestamp', async () => {
    stubCamera(vi.fn(async () => fakeStream()));
    const { result } = renderHook(() => useReportCamera({ gps: null, active: true }));
    await flush();
    setupCapture(result, fakeCtx());
    act(() => result.current.capturePhoto());

    act(() => result.current.resetPhoto());

    expect(result.current.photoBlob).toBeNull();
    expect(result.current.photoTs).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('frees the preview image when the form closes', async () => {
    stubCamera(vi.fn(async () => fakeStream()));
    const { result, unmount } = renderHook(() => useReportCamera({ gps: null, active: true }));
    await flush();
    setupCapture(result, fakeCtx());
    act(() => result.current.capturePhoto());

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
});
