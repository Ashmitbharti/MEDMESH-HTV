// On a wide desktop browser, show MedMesh the way it looks on a phone: a centred phone-width column.
// React Native Web sizes everything from window.visualViewport, so we report the column width instead of the window's.
// Runs before anything else (first import in index.js). Phones and narrow windows are untouched.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.innerWidth > 700) {
  const FRAME = 430;
  const real = window.visualViewport;
  const fake = {
    get width() { return FRAME; },
    get height() { return window.innerHeight; },
    scale: 1,
    addEventListener: (...a) => real?.addEventListener(...a),
    removeEventListener: (...a) => real?.removeEventListener(...a),
  };
  try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake }); } catch { /* keep full width */ }
  const css = document.createElement('style');
  css.textContent = `
    html, body { background: radial-gradient(circle at 50% 30%, #101a33 0%, #02040a 70%) !important; }
    #root { max-width: ${FRAME}px; margin: 0 auto; position: relative; overflow: hidden;
            box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 30px 80px -20px rgba(0,0,0,0.9); }`;
  document.head.appendChild(css);
}
