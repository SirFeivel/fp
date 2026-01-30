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

    const header = document.createElement('div');
    header.className = 'fullscreen-header';
    const exitBtn = document.createElement('button');
    exitBtn.id = 'btnExitFullscreen';
    exitBtn.className = 'btn small';
    exitBtn.title = 'Exit Fullscreen';
    exitBtn.textContent = '✕';
    header.appendChild(exitBtn);

    const content = document.createElement('div');
    content.className = 'fullscreen-content';

    if (toolbarOriginal) {
      const toolbarClone = toolbarOriginal.cloneNode(true);
      content.appendChild(toolbarClone);
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'planSvgFullscreen';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    content.appendChild(svg);

    overlay.replaceChildren(header, content);

    document.body.appendChild(overlay);

    if (onShow) onShow();

    const closeFullscreen = () => {
      document.body.removeChild(overlay);
    };

    exitBtn.addEventListener('click', closeFullscreen);

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
