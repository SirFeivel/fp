export function initFullscreen() {
  const btnFullscreen = document.getElementById('btnFullscreen');

  if (!btnFullscreen) return;

  btnFullscreen.addEventListener('click', () => {
    showFullscreen();
  });

  function showFullscreen() {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    overlay.innerHTML = `
      <div class="fullscreen-header">
        <button id="btnExitFullscreen" class="btn small" title="Exit Fullscreen">✕</button>
      </div>
      <div class="fullscreen-content">
        <svg id="planSvgFullscreen" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    `;

    document.body.appendChild(overlay);

    const svgOriginal = document.getElementById('planSvg');
    const svgFullscreen = document.getElementById('planSvgFullscreen');

    svgFullscreen.innerHTML = svgOriginal.innerHTML;
    svgFullscreen.setAttribute('viewBox', svgOriginal.getAttribute('viewBox'));
    svgFullscreen.setAttribute('preserveAspectRatio', svgOriginal.getAttribute('preserveAspectRatio'));

    const btnExit = document.getElementById('btnExitFullscreen');
    btnExit.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    document.addEventListener('keydown', function handleEscape(e) {
      if (e.key === 'Escape') {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        document.removeEventListener('keydown', handleEscape);
      }
    });
  }
}
