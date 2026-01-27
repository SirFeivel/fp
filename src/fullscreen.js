export function initFullscreen(dragController, onShow) {
  const btnFullscreen = document.getElementById('btnFullscreen');

  if (!btnFullscreen) return;

  btnFullscreen.addEventListener('click', () => {
    showFullscreen();
  });

  function showFullscreen() {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    const toolbarOriginal = document.querySelector('.plan-toolbar');
    const toolbarHtml = toolbarOriginal ? toolbarOriginal.innerHTML : '';

    overlay.innerHTML = `
      <div class="fullscreen-header">
        <button id="btnExitFullscreen" class="btn small" title="Exit Fullscreen">✕</button>
      </div>
      <div class="fullscreen-content">
        <div class="plan-toolbar">${toolbarHtml}</div>
        <svg id="planSvgFullscreen" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    `;

    document.body.appendChild(overlay);

    if (onShow) onShow();

    const btnExit = document.getElementById('btnExitFullscreen');
    const closeFullscreen = () => {
      document.body.removeChild(overlay);
    };

    btnExit.addEventListener('click', closeFullscreen);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeFullscreen();
      }
    });

    document.addEventListener('keydown', function handleEscape(e) {
      if (e.key === 'Escape') {
        if (document.body.contains(overlay)) {
          closeFullscreen();
        }
        document.removeEventListener('keydown', handleEscape);
      }
    });
  }
}
