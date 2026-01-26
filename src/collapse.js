export function initCollapse() {
  const collapseNav = document.getElementById('collapseNav');
  const collapseInfo = document.getElementById('collapseInfo');
  const panelNav = document.querySelector('.panel-nav');
  const panelInfo = document.querySelector('.panel-info');

  const NAV_COLLAPSED_KEY = 'navCollapsed';
  const INFO_COLLAPSED_KEY = 'infoCollapsed';
  const NAV_WIDTH_KEY = 'panelWidth';
  const INFO_WIDTH_KEY = 'panelWidthRight';

  const COLLAPSED_WIDTH = 48;
  const DEFAULT_WIDTH = 420;

  const navCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
  const infoCollapsed = localStorage.getItem(INFO_COLLAPSED_KEY) === 'true';

  if (navCollapsed && panelNav) {
    panelNav.classList.add('collapsed');
    document.documentElement.style.setProperty('--panel-width', `${COLLAPSED_WIDTH}px`);
  }
  if (infoCollapsed && panelInfo) {
    panelInfo.classList.add('collapsed');
    document.documentElement.style.setProperty('--panel-width-right', `${COLLAPSED_WIDTH}px`);
  }

  if (collapseNav && panelNav) {
    collapseNav.addEventListener('click', () => {
      panelNav.classList.toggle('collapsed');
      const isCollapsed = panelNav.classList.contains('collapsed');
      localStorage.setItem(NAV_COLLAPSED_KEY, isCollapsed);

      if (isCollapsed) {
        document.documentElement.style.setProperty('--panel-width', `${COLLAPSED_WIDTH}px`);
      } else {
        const savedWidth = localStorage.getItem(NAV_WIDTH_KEY);
        const width = savedWidth ? parseInt(savedWidth, 10) : DEFAULT_WIDTH;
        document.documentElement.style.setProperty('--panel-width', `${width}px`);
      }
    });
  }

  if (collapseInfo && panelInfo) {
    collapseInfo.addEventListener('click', () => {
      panelInfo.classList.toggle('collapsed');
      const isCollapsed = panelInfo.classList.contains('collapsed');
      localStorage.setItem(INFO_COLLAPSED_KEY, isCollapsed);

      if (isCollapsed) {
        document.documentElement.style.setProperty('--panel-width-right', `${COLLAPSED_WIDTH}px`);
      } else {
        const savedWidth = localStorage.getItem(INFO_WIDTH_KEY);
        const width = savedWidth ? parseInt(savedWidth, 10) : DEFAULT_WIDTH;
        document.documentElement.style.setProperty('--panel-width-right', `${width}px`);
      }
    });
  }
}
