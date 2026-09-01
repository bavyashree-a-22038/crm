const elements = {
  appShell: document.querySelector('.app-shell'),
  loadingView: document.querySelector('#loading-view'),
  loginView: document.querySelector('#login-view'),
  homeView: document.querySelector('#home-view'),
  moduleView: document.querySelector('#module-view'),
  recordFormView: document.querySelector('#record-form-view'),
  recordDetailView: document.querySelector('#record-detail-view'),
  analyticsView: document.querySelector('#analytics-view'),
  homeNav: document.querySelector('#home-nav'),
  analyticsNav: document.querySelector('#analytics-nav'),
  moduleNavigation: document.querySelector('#module-navigation'),
  modulesToggle: document.querySelector('#modules-toggle'),
  moduleList: document.querySelector('#module-list'),
  moduleSummary: document.querySelector('#module-summary'),
  logoutButton: document.querySelector('#logout-button'),
  loginLink: document.querySelector('#login-link'),
  configMessage: document.querySelector('#config-message'),
  authError: document.querySelector('#auth-error'),
  userSummary: document.querySelector('#user-summary'),
  connectionLabel: document.querySelector('#connection-label'),
  sidebarFoot: document.querySelector('.sidebar-foot')
};

function showOnly(view) {
  [elements.loadingView, elements.loginView, elements.homeView, elements.moduleView,
    elements.recordFormView, elements.recordDetailView, elements.analyticsView]
    .forEach((element) => element.classList.toggle('hidden', element !== view));
}

function setPrimaryNavigation(active) {
  elements.homeNav.classList.toggle('active', active === 'home');
  elements.analyticsNav.classList.toggle('active', active === 'analytics');
}

export function renderAuthState(status) {
  if (status.authenticated) {
    elements.appShell.classList.remove('landing-shell');
    showOnly(elements.homeView);
    elements.logoutButton.classList.remove('hidden');
    elements.connectionLabel.textContent = status.user?.firstName
      || status.user?.email
      || 'Zoho connected';
    elements.userSummary.textContent = status.user?.email || 'Connected to Zoho CRM';
    elements.sidebarFoot.classList.add('connected');
    elements.analyticsNav.classList.remove('hidden');
    setPrimaryNavigation('home');
    return;
  }

  elements.appShell.classList.add('landing-shell');
  showOnly(elements.loginView);
  elements.logoutButton.classList.add('hidden');
  elements.userSummary.textContent = '';
  elements.connectionLabel.textContent = 'Not connected';
  elements.sidebarFoot.classList.remove('connected');
  elements.moduleNavigation.classList.add('hidden');
  elements.analyticsNav.classList.add('hidden');
  elements.loginLink.classList.toggle('hidden', !status.configured);
  elements.configMessage.classList.toggle('hidden', status.configured);
  elements.configMessage.textContent = status.configured
    ? ''
    : 'OAuth is not configured on this server yet.';
}

export function renderAuthError(message) {
  elements.appShell.classList.add('landing-shell');
  showOnly(elements.loginView);
  elements.authError.textContent = message;
  elements.authError.classList.remove('hidden');
}

export function bindLogout(handler) {
  elements.logoutButton.addEventListener('click', handler);
}

export function showHomeView() {
  showOnly(elements.homeView);
  setPrimaryNavigation('home');
}

export function showModuleView() {
  showOnly(elements.moduleView);
  setPrimaryNavigation(null);
}

export function showRecordFormView() {
  showOnly(elements.recordFormView);
  setPrimaryNavigation(null);
}

export function showRecordDetailView() {
  showOnly(elements.recordDetailView);
  setPrimaryNavigation(null);
}

export function showAnalyticsView() {
  showOnly(elements.analyticsView);
  setPrimaryNavigation('analytics');
}

export function confirmDelete(label) {
  const dialog = document.querySelector('#delete-dialog');
  const message = document.querySelector('#delete-message');
  const confirm = document.querySelector('#confirm-delete');
  const cancel = document.querySelector('#cancel-delete');
  const returnFocus = document.activeElement;
  message.textContent = `Delete ${label}? This action cannot be undone.`;
  dialog.showModal();
  cancel.focus();
  return new Promise((resolve) => {
    const finish = (confirmed) => {
      if (dialog.open) dialog.close();
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.removeEventListener('keydown', onDialogKeydown);
      returnFocus?.focus();
      resolve(confirmed);
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onDialogCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onDialogKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    dialog.addEventListener('keydown', onDialogKeydown);
  });
}

export function renderModuleSummary(count, errorMessage = '') {
  elements.moduleNavigation.classList.toggle('hidden', Boolean(errorMessage));
  elements.moduleSummary.textContent = errorMessage
    || 'Live data from Zoho CRM';
}

export function bindModulesToggle() {
  elements.modulesToggle.addEventListener('click', () => {
    const expanded = elements.modulesToggle.getAttribute('aria-expanded') !== 'true';
    setModulesExpanded(expanded);
  });
}

function setModulesExpanded(expanded) {
  elements.modulesToggle.setAttribute('aria-expanded', String(expanded));
  elements.modulesToggle.querySelector('.toggle-mark').textContent = expanded ? '−' : '+';
  elements.moduleList.classList.toggle('hidden', !expanded);
}

export function expandModules() {
  setModulesExpanded(true);
}

export function bindHome(handler) {
  elements.homeNav.addEventListener('click', handler);
}

export function bindAnalytics(handler) {
  elements.analyticsNav.addEventListener('click', handler);
}
