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

export function initMainTabs() {
  const tabButtons = document.querySelectorAll('[data-main-tab]');
  const tabPanels = document.querySelectorAll('[data-main-panel]');

  function switchMainTab(targetTab) {
    tabButtons.forEach(btn => {
      if (btn.dataset.mainTab === targetTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabPanels.forEach(panel => {
      if (panel.dataset.mainPanel === targetTab) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    localStorage.setItem('activeMainTab', targetTab);
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchMainTab(btn.dataset.mainTab);
    });
  });

  const savedTab = localStorage.getItem('activeMainTab') || 'plan';
  const validTabs = Array.from(tabButtons).map(btn => btn.dataset.mainTab);
  const finalTab = validTabs.includes(savedTab) ? savedTab : 'plan';

  switchMainTab(finalTab);
}
