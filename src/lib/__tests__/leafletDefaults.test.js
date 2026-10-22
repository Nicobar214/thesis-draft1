// @vitest-environment jsdom
import { it, expect } from 'vitest';
import L from 'leaflet';
import '../leafletDefaults';

function makeMap(opts) {
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  return { div, map: L.map(div, { center: [10.7, 122.5], zoom: 12, ...opts }) };
}
const wheel = (div, deltaY, deltaMode = 0) => div.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

it('zooms with the wheel only: full amount per notch, on every map, no +/- buttons', async () => {
  // Even a map that asks for wheel zoom off and zoom buttons on.
  const { div, map } = makeMap({ scrollWheelZoom: false, zoomControl: true });
  expect(div.querySelector('.leaflet-control-zoom')).toBeNull();

  wheel(div, -100); wheel(div, -100);           // 2 mouse notches in
  await wait(1200);
  expect(map.getZoom()).toBeCloseTo(13, 1);

  wheel(div, 100); wheel(div, 100); wheel(div, 100); wheel(div, 100);
  await wait(1200);
  expect(map.getZoom()).toBeCloseTo(11, 1);

  wheel(div, -3, 1);                             // Firefox "lines": 3 lines = 48 px
  await wait(1200);
  expect(map.getZoom()).toBeCloseTo(11.24, 1);
});
