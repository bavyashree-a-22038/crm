import { getCurrentUser, logout } from './auth.js';
import { AnalyticsDashboard, getModuleAnalytics, renderBars } from './analytics.js';
import { getModuleFields, getModuleMetadata, getModules, ModuleNavigation } from './modules.js';
import { RecordForm } from './recordForm.js';
import { RecordDetails } from './recordDetails.js';
import { getRecord, RecordsController } from './records.js';
import {
  bindHome,
  bindAnalytics,
  bindModulesToggle,
  bindLogout,
  confirmDelete,
  expandModules,
  renderAuthError,
  renderAuthState,
  renderModuleSummary,
  showHomeView,
  showAnalyticsView,
  showModuleView,
  showRecordDetailView,
  showRecordFormView
} from './ui.js';

const errorMessages = {
  access_denied: 'Zoho access was not granted. You can try again when ready.'
};

const moduleNavigation = new ModuleNavigation(
  document.querySelector('#module-list'),
  selectModule
);
const recordsController = new RecordsController({
  moduleTitle: document.querySelector('#module-title'),
  recordCount: document.querySelector('#record-count'),
  searchForm: document.querySelector('#search-form'),
  searchInput: document.querySelector('#search-input'),
  clearSearch: document.querySelector('#clear-search'),
  status: document.querySelector('#records-status'),
  tableWrap: document.querySelector('#table-wrap'),
  head: document.querySelector('#records-head'),
  body: document.querySelector('#records-body'),
  pagination: document.querySelector('#pagination'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageLabel: document.querySelector('#page-label'),
  createButton: document.querySelector('#create-record')
}, () => renderAuthState({ authenticated: false, configured: true }), {
  onOpen: openDetails,
  onCreate: openCreate,
  onEdit: openEdit,
  onDelete: removeRecord
});
const recordForm = new RecordForm({
  form: document.querySelector('#record-form'),
  title: document.querySelector('#record-form-title'),
  fields: document.querySelector('#record-form-fields'),
  error: document.querySelector('#record-form-error'),
  save: document.querySelector('#save-record'),
  cancel: document.querySelector('#cancel-record')
}, {
  onSave: saveRecord,
  onCancel: showModuleView
});
const recordDetails = new RecordDetails({
  title: document.querySelector('#record-detail-title'),
  status: document.querySelector('#record-detail-status'),
  fields: document.querySelector('#record-detail-fields'),
  edit: document.querySelector('#edit-detail-record'),
  close: document.querySelector('#close-record-detail')
}, {
  onClose: showModuleView,
  onEdit: openEdit
});
const analyticsDashboard = new AnalyticsDashboard({
  moduleSelect: document.querySelector('#analytics-module'),
  refresh: document.querySelector('#refresh-analytics'),
  title: document.querySelector('#analytics-title'),
  empty: document.querySelector('#analytics-empty'),
  status: document.querySelector('#analytics-status'),
  content: document.querySelector('#analytics-content'),
  sampledRecords: document.querySelector('#analytics-records'),
  recentRecords: document.querySelector('#analytics-recent-records'),
  completeness: document.querySelector('#analytics-completeness'),
  populatedRecords: document.querySelector('#analytics-populated-records'),
  creationTrend: document.querySelector('#creation-trend'),
  numericPanel: document.querySelector('#numeric-panel'),
  numericTitle: document.querySelector('#numeric-title'),
  numericTotal: document.querySelector('#numeric-total'),
  numericAverage: document.querySelector('#numeric-average'),
  numericRange: document.querySelector('#numeric-range'),
  picklistPanel: document.querySelector('#picklist-panel'),
  picklistTitle: document.querySelector('#picklist-title'),
  picklistDistribution: document.querySelector('#picklist-distribution')
}, () => renderAuthState({ authenticated: false, configured: true }));

function recordLabel(record) {
  const displayField = recordsController.fields.find((field) => field.displayField);
  return displayField && record[displayField.apiName]
    ? String(record[displayField.apiName])
    : 'this record';
}

function openCreate(module, fields) {
  showRecordFormView();
  recordForm.open(module, fields);
}

async function openDetails(module, record) {
  showRecordDetailView();
  recordDetails.setLoading(module);
  try {
    recordDetails.render(await getRecord(module.apiName, record.id));
  } catch (error) {
    if (error.status === 401) return renderAuthState({ authenticated: false, configured: true });
    recordDetails.showError(error.message);
  }
}

async function openEdit(module, record) {
  showRecordFormView();
  recordForm.setLoading(module);
  try {
    const payload = await getRecord(module.apiName, record.id);
    recordForm.open(payload.module, payload.fields, payload.record);
  } catch (error) {
    if (error.status === 401) return renderAuthState({ authenticated: false, configured: true });
    recordForm.showError(error.message);
  }
}

async function saveRecord({ mode, module, recordId, data }) {
  await recordsController.saveMutation(
    mode,
    recordId,
    data,
    `${module.singularLabel || 'Record'} ${mode === 'create' ? 'created' : 'updated'}.`
  );
  showModuleView();
}

async function removeRecord(module, record) {
  if (!await confirmDelete(recordLabel(record))) return;
  recordsController.showStatus('Deleting record...');
  try {
    await recordsController.deleteMutation(record.id, `${module.singularLabel || 'Record'} deleted.`);
  } catch (error) {
    if (error.status === 401) return renderAuthState({ authenticated: false, configured: true });
    recordsController.showStatus(error.message, true);
  }
}

async function loadModules() {
  try {
    const payload = await getModules();
    moduleNavigation.render(payload.modules);
    analyticsDashboard.setModules(payload.modules);
    renderModuleSummary(payload.modules.length);
    loadHomeAnalytics(payload.modules[0]);
  } catch (error) {
    if (error.status === 401) {
      renderAuthState({ authenticated: false, configured: true });
      return;
    }
    renderModuleSummary(0, error.message);
  }
}

async function loadHomeAnalytics(module) {
  if (!module) return;
  const elements = {
    records: document.querySelector('#home-record-count'),
    recent: document.querySelector('#home-recent-count'),
    completeness: document.querySelector('#home-completeness'),
    populated: document.querySelector('#home-populated-count'),
    summary: document.querySelector('#module-summary'),
    creationTrend: document.querySelector('#home-creation-trend'),
    categoryPanel: document.querySelector('#home-category-panel'),
    categoryTitle: document.querySelector('#home-category-title'),
    categoryDistribution: document.querySelector('#home-category-distribution')
  };
  try {
    const payload = await getModuleAnalytics(module.apiName);
    elements.records.textContent = payload.metrics.sampledRecords.toLocaleString();
    elements.recent.textContent = payload.metrics.recentRecords.toLocaleString();
    elements.completeness.textContent = `${payload.metrics.completeness}%`;
    elements.populated.textContent = payload.metrics.populatedRecords.toLocaleString();
    elements.summary.textContent = `${payload.module.pluralLabel || payload.module.apiName} snapshot`;
    renderBars(elements.creationTrend, payload.creationTrend);
    const distribution = payload.picklistDistribution;
    elements.categoryPanel.classList.toggle('hidden', !distribution);
    if (distribution) {
      elements.categoryTitle.textContent = `${distribution.field} distribution`;
      renderBars(elements.categoryDistribution, distribution.values);
    }
  } catch (error) {
    if (error.status === 401) return renderAuthState({ authenticated: false, configured: true });
    elements.summary.textContent = 'CRM snapshot unavailable';
  }
}

async function selectModule(module) {
  expandModules();
  moduleNavigation.setActive(module.apiName);
  showModuleView();
  try {
    const [metadataPayload, fieldsPayload] = await Promise.all([
      getModuleMetadata(module.apiName),
      getModuleFields(module.apiName)
    ]);
    await recordsController.selectModule(metadataPayload.module, fieldsPayload.fields);
  } catch (error) {
    if (error.status === 401) {
      renderAuthState({ authenticated: false, configured: true });
      return;
    }
    recordsController.showStatus(error.message, true);
  }
}

async function loadSession() {
  try {
    const status = await getCurrentUser();
    renderAuthState(status);
    if (status.authenticated) await loadModules();
  } catch (error) {
    renderAuthError(error.message);
  }
}

bindLogout(async () => {
  try {
    await logout();
    await loadSession();
  } catch (error) {
    renderAuthError(error.message);
  }
});

bindHome(() => {
  moduleNavigation.setActive(null);
  showHomeView();
});

bindModulesToggle();

bindAnalytics(() => {
  moduleNavigation.setActive(null);
  showAnalyticsView();
  analyticsDashboard.load();
});

const authError = new URLSearchParams(window.location.search).get('auth_error');
if (authError) {
  window.history.replaceState({}, '', '/');
  renderAuthError(errorMessages[authError] || 'Zoho sign-in could not be completed.');
} else {
  loadSession();
}
