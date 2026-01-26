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

export function initVerticalResize() {
  const handle = document.querySelector('.vertical-resize-handle');
  const viewer = document.querySelector('.viewer');
  const viewerTop = document.querySelector('.viewer-top');

  if (!handle || !viewer || !viewerTop) return;

  const MIN_HEIGHT_PERCENT = 20;
  const MAX_HEIGHT_PERCENT = 80;

  const savedHeight = localStorage.getItem('viewerTopHeight');
  if (savedHeight) {
    const height = parseInt(savedHeight, 10);
    if (height >= MIN_HEIGHT_PERCENT && height <= MAX_HEIGHT_PERCENT) {
      document.documentElement.style.setProperty('--viewer-top-height', `${height}%`);
    }
  }

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;
  let viewerHeight = 0;

  function getStartHeight() {
    const computedStyle = getComputedStyle(document.documentElement);
    const heightStr = computedStyle.getPropertyValue('--viewer-top-height').trim();
    return parseInt(heightStr, 10) || 60;
  }

  function onMouseDown(e) {
    isResizing = true;
    startY = e.clientY;
    startHeight = getStartHeight();
    viewerHeight = viewer.offsetHeight;

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isResizing) return;

    const delta = e.clientY - startY;
    const deltaPercent = (delta / viewerHeight) * 100;
    let newHeight = startHeight + deltaPercent;

    newHeight = Math.max(MIN_HEIGHT_PERCENT, Math.min(MAX_HEIGHT_PERCENT, newHeight));

    document.documentElement.style.setProperty('--viewer-top-height', `${newHeight}%`);
  }

  function onMouseUp() {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    const finalHeight = getStartHeight();
    localStorage.setItem('viewerTopHeight', finalHeight.toString());

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', onMouseDown);
}
