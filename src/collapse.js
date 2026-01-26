export function initCollapse() {
  const collapseNav = document.getElementById('collapseNav');
  const collapseInfo = document.getElementById('collapseInfo');
  const panelNav = document.querySelector('.panel-nav');
  const panelInfo = document.querySelector('.panel-info');

  const NAV_COLLAPSED_KEY = 'navCollapsed';
  const INFO_COLLAPSED_KEY = 'infoCollapsed';

  const navCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
  const infoCollapsed = localStorage.getItem(INFO_COLLAPSED_KEY) === 'true';

  if (navCollapsed && panelNav) {
    panelNav.classList.add('collapsed');
  }
  if (infoCollapsed && panelInfo) {
    panelInfo.classList.add('collapsed');
  }

  if (collapseNav && panelNav) {
    collapseNav.addEventListener('click', () => {
      panelNav.classList.toggle('collapsed');
      const isCollapsed = panelNav.classList.contains('collapsed');
      localStorage.setItem(NAV_COLLAPSED_KEY, isCollapsed);
    });
  }

  if (collapseInfo && panelInfo) {
    collapseInfo.addEventListener('click', () => {
      panelInfo.classList.toggle('collapsed');
      const isCollapsed = panelInfo.classList.contains('collapsed');
      localStorage.setItem(INFO_COLLAPSED_KEY, isCollapsed);
    });
  }
}
