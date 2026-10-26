// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CameraSheet from '../CameraSheet';

afterEach(cleanup);

describe('CameraSheet', () => {
  const props = (o = {}) => ({ open: true, title: 'Site photo', onClose: vi.fn(), videoRef: { current: null }, ready: true, onShutter: vi.fn(), ...o });

  it('renders nothing while closed', () => {
    render(<CameraSheet {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('covers the screen with the live view, a shutter and a close button', () => {
    const p = props({ hint: 'GPS ±8 m' });
    render(<CameraSheet {...p} />);
    const dialog = screen.getByRole('dialog', { name: 'Site photo' });
    expect(dialog.querySelector('video')).toBeTruthy();
    expect(dialog.parentElement.className).toMatch(/fixed inset-0/);
    expect(screen.getByText('GPS ±8 m')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Take photo'));
    expect(p.onShutter).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Close camera'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the error and blocks the shutter when asked', () => {
    render(<CameraSheet {...props({ error: 'Camera permission denied.', shutterDisabled: true })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/permission/);
    expect(screen.getByLabelText('Take photo').disabled).toBe(true);
  });
});
