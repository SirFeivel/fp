export function initTabs() {
  const tabButtons = document.querySelectorAll('[data-tab]');
  const tabPanels = document.querySelectorAll('[data-tab-panel]');

  function switchTab(targetTab) {
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === targetTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabPanels.forEach(panel => {
      if (panel.dataset.tabPanel === targetTab) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    localStorage.setItem('activeTab', targetTab);
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  let savedTab = localStorage.getItem('activeTab') || 'room';

  if (savedTab === 'advanced') {
    savedTab = 'debug';
  }

  const validTabs = Array.from(tabButtons).map(btn => btn.dataset.tab);
  if (!validTabs.includes(savedTab)) {
    savedTab = 'room';
  }

  switchTab(savedTab);
}
