export function initTabs() {
  const stepButtons = document.querySelectorAll('[data-step]');
  const stagePanels = document.querySelectorAll('[data-stage-panel]');
  const stageTitle = document.getElementById('stageTitle');

  function switchStage(targetStage) {
    stepButtons.forEach(btn => {
      if (btn.dataset.step === targetStage) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    stagePanels.forEach(panel => {
      if (panel.dataset.stagePanel === targetStage) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    if (stageTitle) {
      stageTitle.setAttribute('data-i18n', `stepper.${targetStage}`);
      // Simple fallback if i18n not yet run
      const labels = { setup: 'Setup', planning: 'Planning', commercial: 'Commercial' };
      stageTitle.textContent = labels[targetStage] || targetStage;
    }

    // Auto-switch viewer tab
    const viewerTabs = document.querySelectorAll('[data-main-tab]');
    if (targetStage === 'commercial') {
      const commTab = Array.from(viewerTabs).find(t => t.dataset.mainTab === 'commercial');
      if (commTab) commTab.click();
    } else {
      const planTab = Array.from(viewerTabs).find(t => t.dataset.mainTab === 'plan');
      if (planTab) planTab.click();
    }

    localStorage.setItem('activeStage', targetStage);
    
    // Update body class for conditional styling
    document.body.classList.remove('stage-setup', 'stage-planning', 'stage-commercial');
    document.body.classList.add(`stage-${targetStage}`);

    // Trigger re-render
    document.dispatchEvent(new CustomEvent('fp-stage-changed', { detail: { stage: targetStage } }));
  }

  stepButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchStage(btn.dataset.step);
    });
  });

  const savedStage = localStorage.getItem('activeStage') || 'setup';
  switchStage(savedStage);
}

export function initGlobalMenu() {
  const btn = document.getElementById('btnGlobalMenu');
  const dropdown = document.getElementById('globalDropdown');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('show');
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
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
