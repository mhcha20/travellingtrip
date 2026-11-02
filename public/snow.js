// Gentle falling snow on any <canvas class="snow">. Skipped when the viewer prefers reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('canvas.snow').forEach(cv => {
    const ctx = cv.getContext('2d');
    let w, h, flakes = [];
    const dpr = Math.min(2, devicePixelRatio || 1);
    function size() {
      const r = cv.getBoundingClientRect(); w = r.width; h = r.height;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(140, w * h / 4500));
      flakes = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: .6 + Math.random() * 2.4, s: .25 + Math.random() * .9, d: Math.random() * Math.PI * 2 }));
    }
    size(); addEventListener('resize', size);
    (function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.s; f.d += .01; f.x += Math.sin(f.d) * .35;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        ctx.globalAlpha = .45 + f.r / 5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      }
      requestAnimationFrame(tick);
    })();
  });
})();
