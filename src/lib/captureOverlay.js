/**
 * The timestamp / GPS strip burned into every report photo, so the picture itself
 * carries when and where it was taken. Pure helpers so they can be tested without a
 * real camera or canvas.
 */

export function captureOverlayLines(now, gps) {
  const timestamp = now.toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const position = gps
    ? `GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy || 0)}m)`
    : '';
  return [timestamp, position].filter(Boolean);
}

/** Paint the overlay strip into the bottom-left corner of an already-drawn frame. */
export function paintCaptureOverlay(ctx, canvas, lines) {
  const fontSize = Math.max(14, Math.floor(canvas.width / 50));
  const lineH = fontSize + 4;
  const padding = 8;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textBaseline = 'bottom';
  const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const stripH = lines.length * lineH + padding * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, canvas.height - stripH, maxW + padding * 2, stripH);
  ctx.fillStyle = '#ffffff';
  lines.forEach((line, i) => ctx.fillText(line, padding, canvas.height - stripH + padding + (i + 1) * lineH));
}
