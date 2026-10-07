// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SEVERITY_TAXONOMY } from '../../../../lib/publicReportStatus';
import SuccessStep from '../SuccessStep';
import LocatingStep from '../LocatingStep';
import PickingStep from '../PickingStep';
import ClassifyStep from '../ClassifyStep';
import ReportingStep from '../ReportingStep';

afterEach(cleanup);

const firstCategory = Object.keys(SEVERITY_TAXONOMY)[0];
const firstProblem = SEVERITY_TAXONOMY[firstCategory].problems[0];

describe('SuccessStep', () => {
  it('tells an online reporter the report was recorded', () => {
    render(<SuccessStep queuedOffline={false} resetAll={() => {}} />);
    expect(screen.getByText(/has been recorded/i)).toBeTruthy();
  });

  it('tells an offline reporter it will sync later', () => {
    render(<SuccessStep queuedOffline resetAll={() => {}} />);
    expect(screen.getByText(/saved offline/i)).toBeTruthy();
  });

  it('starts a new report from the button', () => {
    const resetAll = vi.fn();
    render(<SuccessStep queuedOffline={false} resetAll={resetAll} />);
    fireEvent.click(screen.getByText(/submit another report/i));
    expect(resetAll).toHaveBeenCalledTimes(1);
  });
});

describe('LocatingStep', () => {
  const base = { gpsLoading: false, gpsSlow: false, gps: null, gpsError: null, acquireGps: () => {} };

  it('shows progress while the GPS fix is pending', () => {
    render(<LocatingStep {...base} gpsLoading />);
    expect(screen.getByText(/getting your gps position/i)).toBeTruthy();
  });

  it('only warns about a slow fix once it is slow', () => {
    const { rerender } = render(<LocatingStep {...base} gpsLoading />);
    expect(screen.queryByText(/taking a little longer/i)).toBeNull();
    rerender(<LocatingStep {...base} gpsLoading gpsSlow />);
    expect(screen.getByText(/taking a little longer/i)).toBeTruthy();
  });

  it('confirms the location once found', () => {
    render(<LocatingStep {...base} gps={{ lat: 10, lng: 122, accuracy: 5 }} />);
    expect(screen.getByText('Location found')).toBeTruthy();
  });

  it('explains a permission error and lets the user retry', () => {
    const acquireGps = vi.fn();
    render(<LocatingStep {...base} gpsError="Location permission denied." acquireGps={acquireGps} />);
    expect(screen.getByText('Location permission denied.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try Again'));
    expect(acquireGps).toHaveBeenCalledTimes(1);
  });

  it('offers a manual button when nothing has started', () => {
    render(<LocatingStep {...base} />);
    expect(screen.getByText('Detect My Location')).toBeTruthy();
  });
});

describe('PickingStep', () => {
  const gps = { lat: 10, lng: 122, accuracy: 20 };
  const road = { id: 1, project_name: 'Brgy. Road 1', status: 'On-Going', municipality: 'Leon', start_latitude: 10.0005, start_longitude: 122 };

  const props = (overrides = {}) => ({
    gps,
    allProjects: [road],
    nearby: [road],
    browseAll: false,
    widerSearch: false,
    isOffline: false,
    cachedProjectsMeta: null,
    setWiderSearch: vi.fn(),
    setBrowseAll: vi.fn(),
    setSelProject: vi.fn(),
    setStep: vi.fn(),
    ...overrides,
  });

  it('lists nearby projects and moves to classification when one is chosen', () => {
    const p = props();
    render(<PickingStep {...p} />);
    fireEvent.click(screen.getByText('Brgy. Road 1'));
    expect(p.setSelProject).toHaveBeenCalledWith(road);
    expect(p.setStep).toHaveBeenCalledWith('classify');
  });

  it('offers a wider search when nothing is nearby', () => {
    const p = props({ nearby: [] });
    render(<PickingStep {...p} />);
    expect(screen.getByText(/no projects found within 250m/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/search a wider area/i));
    expect(p.setWiderSearch).toHaveBeenCalledWith(true);
  });

  it('lets the user browse every project as an escape hatch', () => {
    const p = props();
    render(<PickingStep {...p} />);
    fireEvent.click(screen.getByText(/not near a project/i));
    expect(p.setBrowseAll).toHaveBeenCalledWith(true);
  });

  it('warns when GPS accuracy is poor', () => {
    render(<PickingStep {...props({ gps: { ...gps, accuracy: 250 } })} />);
    expect(screen.getByText(/move to open sky/i)).toBeTruthy();
  });

  it('says so when it is using the cached project list offline', () => {
    render(<PickingStep {...props({ isOffline: true })} />);
    expect(screen.getByText(/offline mode/i)).toBeTruthy();
  });
});

describe('ClassifyStep', () => {
  const props = (overrides = {}) => ({
    severityCategory: '',
    specificProblem: '',
    setSeverityCategory: vi.fn(),
    setSpecificProblem: vi.fn(),
    setCategory: vi.fn(),
    setStep: vi.fn(),
    ...overrides,
  });

  it('cannot continue until both a category and a specific problem are chosen', () => {
    const { rerender } = render(<ClassifyStep {...props()} />);
    expect(screen.getByText(/continue to report/i).disabled).toBe(true);

    rerender(<ClassifyStep {...props({ severityCategory: firstCategory })} />);
    expect(screen.getByText(/continue to report/i).disabled).toBe(true);

    rerender(<ClassifyStep {...props({ severityCategory: firstCategory, specificProblem: firstProblem.value })} />);
    expect(screen.getByText(/continue to report/i).disabled).toBe(false);
  });

  it('choosing a category clears any earlier specific problem', () => {
    const [, secondCategory] = Object.keys(SEVERITY_TAXONOMY);
    const p = props({ severityCategory: firstCategory, specificProblem: firstProblem.value });
    render(<ClassifyStep {...p} />);
    fireEvent.click(screen.getByText(SEVERITY_TAXONOMY[secondCategory].label));
    expect(p.setSeverityCategory).toHaveBeenCalledWith(secondCategory);
    expect(p.setSpecificProblem).toHaveBeenCalledWith('');
    expect(p.setCategory).toHaveBeenCalledWith(secondCategory);
  });

  it('does not crash on an unrecognised pre-filled category', () => {
    expect(() => render(<ClassifyStep {...props({ severityCategory: 'not-a-category', specificProblem: 'x' })} />)).not.toThrow();
  });

  it('only offers problems that belong to the chosen category', () => {
    render(<ClassifyStep {...props({ severityCategory: firstCategory })} />);
    SEVERITY_TAXONOMY[firstCategory].problems.forEach((opt) => {
      expect(screen.getByText(opt.label)).toBeTruthy();
    });
  });

  it('continues to the report once classified', () => {
    const p = props({ severityCategory: firstCategory, specificProblem: firstProblem.value });
    render(<ClassifyStep {...p} />);
    fireEvent.click(screen.getByText(/continue to report/i));
    expect(p.setStep).toHaveBeenCalledWith('reporting');
  });

  it('cancelling clears the classification and goes back to the project list', () => {
    const p = props({ severityCategory: firstCategory, specificProblem: firstProblem.value });
    render(<ClassifyStep {...p} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(p.setSeverityCategory).toHaveBeenCalledWith('');
    expect(p.setSpecificProblem).toHaveBeenCalledWith('');
    expect(p.setStep).toHaveBeenCalledWith('picking');
  });
});

describe('ReportingStep', () => {
  const props = (overrides = {}) => ({
    stopCamera: vi.fn(),
    setStep: vi.fn(),
    selProject: { id: 1, project_name: 'Brgy. Road 1', municipality: 'Leon', location: 'Brgy. X' },
    gps: null,
    selProjectRoute: null,
    error: null,
    severityCategory: firstCategory,
    specificProblem: firstProblem.value,
    description: '',
    setDescription: vi.fn(),
    camError: null,
    camReady: true,
    photoPreview: null,
    photoBlob: null,
    videoRef: { current: null },
    canvasRef: { current: null },
    capturePhoto: vi.fn(),
    retakePhoto: vi.fn(),
    fullName: '',
    setFullName: vi.fn(),
    contact: '',
    setContact: vi.fn(),
    handleSubmit: vi.fn(),
    submitting: false,
    ...overrides,
  });

  it('keeps Submit disabled until there is a description and a photo', () => {
    const { rerender } = render(<ReportingStep {...props()} />);
    expect(screen.getByText('Submit Report').closest('button').disabled).toBe(true);

    rerender(<ReportingStep {...props({ description: 'Big hole' })} />);
    expect(screen.getByText('Submit Report').closest('button').disabled).toBe(true);

    rerender(<ReportingStep {...props({ description: 'Big hole', photoBlob: {}, photoPreview: 'blob:x' })} />);
    expect(screen.getByText('Submit Report').closest('button').disabled).toBe(false);
  });

  it('submits when the complete report is sent', () => {
    const p = props({ description: 'Big hole', photoBlob: {}, photoPreview: 'blob:x' });
    render(<ReportingStep {...p} />);
    fireEvent.click(screen.getByText('Submit Report'));
    expect(p.handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows progress and blocks a double submit while sending', () => {
    render(<ReportingStep {...props({ description: 'x', photoBlob: {}, photoPreview: 'blob:x', submitting: true })} />);
    expect(screen.getByText(/submitting/i).closest('button').disabled).toBe(true);
  });

  it('only allows capturing once the camera is ready', () => {
    const { rerender } = render(<ReportingStep {...props({ camReady: false })} />);
    expect(screen.getByText('Capture Photo').closest('button').disabled).toBe(true);
    rerender(<ReportingStep {...props({ camReady: true })} />);
    expect(screen.getByText('Capture Photo').closest('button').disabled).toBe(false);
  });

  it('offers a retake once a photo exists', () => {
    const p = props({ photoBlob: {}, photoPreview: 'blob:x' });
    render(<ReportingStep {...p} />);
    fireEvent.click(screen.getByText('Retake'));
    expect(p.retakePhoto).toHaveBeenCalledTimes(1);
  });

  it('shows submit and camera errors to the user', () => {
    render(<ReportingStep {...props({ error: 'A site photo is required.', camError: 'Camera permission denied.' })} />);
    expect(screen.getByText('A site photo is required.')).toBeTruthy();
    expect(screen.getByText('Camera permission denied.')).toBeTruthy();
  });

  it('turns the camera off when going back', () => {
    const p = props();
    render(<ReportingStep {...p} />);
    fireEvent.click(screen.getByText(/back to project list/i));
    expect(p.stopCamera).toHaveBeenCalledTimes(1);
    expect(p.setStep).toHaveBeenCalledWith('classify');
  });
});
