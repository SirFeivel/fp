// Main navigation tabs (Setup / Planning / Commercial)
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

  // Load saved tab or default to 'setup'
  const savedTab = localStorage.getItem('activeMainTab') || 'setup';
  const validTabs = Array.from(tabButtons).map(btn => btn.dataset.mainTab);

  // Handle migration from old tab names
  let finalTab = savedTab;
  if (!validTabs.includes(savedTab)) {
    // Map old tab names to new ones
    if (savedTab === 'room' || savedTab === 'project') {
      finalTab = 'setup';
    } else if (savedTab === 'tiles' || savedTab === 'exclusions' || savedTab === 'plan') {
      finalTab = 'planning';
    } else if (savedTab === 'commercial') {
      finalTab = 'commercial';
    } else if (savedTab === 'export') {
      finalTab = 'export';
    } else {
      finalTab = 'setup';
    }
  }

  switchMainTab(finalTab);
}

// Legacy function - kept for compatibility but now a no-op
export function initTabs() {
  // Old sidebar tabs are removed in the new UX
  // This function is kept to prevent import errors
}
