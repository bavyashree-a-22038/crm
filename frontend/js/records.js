import { apiRequest } from './api.js';

export function getRecord(moduleApiName, recordId, request = apiRequest) {
  return request(`/api/records/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}`);
}

export function createRecord(moduleApiName, data, request = apiRequest) {
  return request(`/api/records/${encodeURIComponent(moduleApiName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
}

export function updateRecord(moduleApiName, recordId, data, request = apiRequest) {
  return request(`/api/records/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
}

export function deleteRecord(moduleApiName, recordId, request = apiRequest) {
  return request(`/api/records/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE'
  });
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return value.name || value.display_value || value.id || '-';
  return String(value);
}

export class RecordsController {
  constructor(elements, onUnauthorized, actions = {}, request = apiRequest) {
    this.elements = elements;
    this.onUnauthorized = onUnauthorized;
    this.actions = actions;
    this.request = request;
    this.module = null;
    this.fields = [];
    this.formFields = [];
    this.page = 1;
    this.pageToken = '';
    this.history = [];
    this.searchWord = '';
    this.resultPage = null;
    this.bindEvents();
  }

  bindEvents() {
    this.elements.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const word = this.elements.searchInput.value.trim();
      if (word.length < 2) {
        this.showStatus('Enter at least two characters to search.', true);
        return;
      }
      this.searchWord = word;
      this.page = 1;
      this.pageToken = '';
      this.history = [];
      this.load();
    });
    this.elements.clearSearch.addEventListener('click', () => {
      this.elements.searchInput.value = '';
      this.searchWord = '';
      this.page = 1;
      this.pageToken = '';
      this.history = [];
      this.load();
    });
    this.elements.previousPage.addEventListener('click', () => this.previous());
    this.elements.nextPage.addEventListener('click', () => this.next());
    this.elements.createButton.addEventListener('click', () => this.actions.onCreate?.(this.module, this.formFields));
  }

  async selectModule(module, fields) {
    this.module = module;
    this.fields = fields;
    this.formFields = fields;
    this.page = 1;
    this.pageToken = '';
    this.history = [];
    this.searchWord = '';
    this.elements.searchInput.value = '';
    this.elements.clearSearch.classList.add('hidden');
    this.elements.searchForm.classList.toggle('hidden', !module.globalSearchSupported);
    this.elements.moduleTitle.textContent = module.pluralLabel || module.apiName;
    this.elements.createButton.classList.toggle('hidden', !module.permissions.create);
    await this.load();
  }

  getRequestPath() {
    const modulePath = encodeURIComponent(this.module.apiName);
    const query = new URLSearchParams({ per_page: this.searchWord ? '200' : '50' });
    if (this.searchWord) {
      query.set('word', this.searchWord);
      query.set('page', String(this.page));
      return `/api/records/${modulePath}/search?${query}`;
    }
    if (this.pageToken) query.set('page_token', this.pageToken);
    else query.set('page', String(this.page));
    return `/api/records/${modulePath}?${query}`;
  }

  async load() {
    this.setLoading();
    try {
      const payload = await this.request(this.getRequestPath());
      this.fields = payload.fields?.length ? payload.fields : this.fields;
      this.resultPage = payload.page;
      this.render(payload.records || []);
    } catch (error) {
      if (error.status === 401) {
        this.onUnauthorized();
        return;
      }
      this.showStatus(error.message, true);
      this.elements.tableWrap.classList.add('hidden');
      this.elements.pagination.classList.add('hidden');
    }
  }

  setLoading() {
    this.showStatus('Loading records...');
    this.elements.tableWrap.classList.add('hidden');
    this.elements.pagination.classList.add('hidden');
    this.elements.recordCount.textContent = '';
  }

  showStatus(message, isError = false) {
    this.elements.status.textContent = message;
    this.elements.status.classList.toggle('error', isError);
  }

  render(records) {
    this.elements.head.replaceChildren();
    this.elements.body.replaceChildren();
    this.fields.forEach((field) => {
      const heading = document.createElement('th');
      heading.scope = 'col';
      heading.textContent = field.label;
      this.elements.head.append(heading);
    });
    if (this.module.permissions.edit || this.module.permissions.delete) {
      const actionsHeading = document.createElement('th');
      actionsHeading.scope = 'col';
      actionsHeading.textContent = 'Actions';
      actionsHeading.className = 'actions-column';
      this.elements.head.append(actionsHeading);
    }

    records.forEach((record) => {
      const row = document.createElement('tr');
      row.className = 'record-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.setAttribute('aria-label', `Open ${this.module.singularLabel || 'record'} details`);
      const openRecord = () => this.actions.onOpen?.(this.module, record);
      row.addEventListener('click', openRecord);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRecord();
        }
      });
      this.fields.forEach((field) => {
        const cell = document.createElement('td');
        const value = displayValue(record[field.apiName]);
        cell.textContent = value;
        cell.title = value;
        row.append(cell);
      });
      if (this.module.permissions.edit || this.module.permissions.delete) {
        const actions = document.createElement('td');
        actions.className = 'row-actions';
        actions.addEventListener('click', (event) => event.stopPropagation());
        actions.addEventListener('keydown', (event) => event.stopPropagation());
        if (this.module.permissions.edit) {
          const edit = document.createElement('button');
          edit.className = 'text-button';
          edit.type = 'button';
          edit.textContent = 'Edit';
          edit.addEventListener('click', () => this.actions.onEdit?.(this.module, record));
          actions.append(edit);
        }
        if (this.module.permissions.delete) {
          const remove = document.createElement('button');
          remove.className = 'text-button danger';
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', () => this.actions.onDelete?.(this.module, record));
          actions.append(remove);
        }
        row.append(actions);
      }
      this.elements.body.append(row);
    });

    const count = this.resultPage?.count ?? records.length;
    this.elements.recordCount.textContent = `${count} record${count === 1 ? '' : 's'} on this page`;
    this.elements.clearSearch.classList.toggle('hidden', !this.searchWord);
    this.elements.pageLabel.textContent = `Page ${this.resultPage?.page || this.page}`;

    if (!records.length) {
      this.showStatus(this.searchWord ? 'No matching records.' : 'No records in this module.');
      this.elements.tableWrap.classList.add('hidden');
    } else {
      this.showStatus('');
      this.elements.tableWrap.classList.remove('hidden');
    }
    this.renderPagination();
  }

  renderPagination() {
    const hasPrevious = this.history.length > 0 || (!this.pageToken && this.page > 1);
    const canUseNextPage = !this.pageToken && this.page < 10;
    const hasNext = this.resultPage?.moreRecords && (canUseNextPage || this.resultPage.nextPageToken);
    this.elements.previousPage.disabled = !hasPrevious;
    this.elements.nextPage.disabled = !hasNext;
    this.elements.pagination.classList.toggle('hidden', !hasPrevious && !hasNext);
  }

  next() {
    if (!this.resultPage?.moreRecords) return;
    this.history.push({ page: this.page, pageToken: this.pageToken });
    if (!this.searchWord && (this.pageToken || this.page >= 10)) {
      this.pageToken = this.resultPage.nextPageToken || '';
    } else {
      this.page += 1;
    }
    this.load();
  }

  previous() {
    const previous = this.history.pop();
    if (previous) {
      this.page = previous.page;
      this.pageToken = previous.pageToken;
    } else if (this.page > 1) {
      this.page -= 1;
    }
    this.load();
  }

  async refreshAfterMutation(message) {
    await this.load();
    this.showStatus(message);
  }

  async saveMutation(mode, recordId, data, message) {
    if (mode === 'create') await createRecord(this.module.apiName, data, this.request);
    else await updateRecord(this.module.apiName, recordId, data, this.request);
    await this.refreshAfterMutation(message);
  }

  async deleteMutation(recordId, message) {
    await deleteRecord(this.module.apiName, recordId, this.request);
    await this.refreshAfterMutation(message);
  }
}
