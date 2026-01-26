export function initResize() {
  const handle = document.querySelector('.resize-handle');
  const layout = document.querySelector('.layout');

  if (!handle || !layout) return;

  const MIN_WIDTH = 280;
  const MAX_WIDTH = 800;

  const savedWidth = localStorage.getItem('panelWidth');
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
      document.documentElement.style.setProperty('--panel-width', `${width}px`);
    }
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  function getStartWidth() {
    const computedStyle = getComputedStyle(document.documentElement);
    const widthStr = computedStyle.getPropertyValue('--panel-width').trim();
    return parseInt(widthStr, 10) || 420;
  }

  function onMouseDown(e) {
    isResizing = true;
    startX = e.clientX;
    startWidth = getStartWidth();

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isResizing) return;

    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;

    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

    document.documentElement.style.setProperty('--panel-width', `${newWidth}px`);
  }

  function onMouseUp() {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    const finalWidth = getStartWidth();
    localStorage.setItem('panelWidth', finalWidth.toString());

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', onMouseDown);
}
