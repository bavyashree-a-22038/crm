function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return value.name || value.display_value || value.id || 'Not set';
  return String(value);
}

function groupFields(fields) {
  const ordered = [...fields].sort((left, right) => (
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
  ));
  const highlights = ordered.filter((field) => field.displayField).slice(0, 1);
  ordered.filter((field) => !field.readOnly && !highlights.includes(field)).slice(0, 5)
    .forEach((field) => highlights.push(field));
  const system = ordered.filter((field) => field.readOnly && !highlights.includes(field));
  const details = ordered.filter((field) => !highlights.includes(field) && !system.includes(field));
  return [
    { title: 'Highlights', fields: highlights, className: 'highlights' },
    { title: 'Record information', fields: details, className: '' },
    { title: 'System information', fields: system, className: 'system' }
  ].filter((section) => section.fields.length);
}

function createField(field, record) {
  const group = document.createElement('div');
  group.className = 'record-detail-field';
  const term = document.createElement('dt');
  term.textContent = field.label;
  const value = document.createElement('dd');
  value.textContent = displayValue(record[field.apiName]);
  value.classList.toggle('empty', value.textContent === 'Not set');
  group.append(term, value);
  return group;
}

export class RecordDetails {
  constructor(elements, handlers) {
    this.elements = elements;
    this.handlers = handlers;
    this.payload = null;
    this.elements.close.addEventListener('click', () => this.handlers.onClose());
    this.elements.edit.addEventListener('click', () => {
      if (this.payload) this.handlers.onEdit(this.payload.module, this.payload.record);
    });
  }

  setLoading(module) {
    this.payload = null;
    this.elements.title.textContent = `Loading ${module.singularLabel || 'record'}...`;
    this.elements.status.textContent = 'Retrieving record details...';
    this.elements.status.classList.remove('error');
    this.elements.fields.replaceChildren();
    this.elements.edit.classList.add('hidden');
  }

  showError(message) {
    this.elements.status.textContent = message;
    this.elements.status.classList.add('error');
  }

  render(payload) {
    this.payload = payload;
    const displayField = payload.fields.find((field) => field.displayField);
    this.elements.title.textContent = displayField && payload.record[displayField.apiName]
      ? String(payload.record[displayField.apiName])
      : payload.module.singularLabel || 'Record';
    this.elements.status.textContent = '';
    this.elements.status.classList.remove('error');
    this.elements.fields.replaceChildren();
    groupFields(payload.fields).forEach((section) => {
      const container = document.createElement('section');
      container.className = `record-detail-section ${section.className}`.trim();
      const heading = document.createElement('h2');
      heading.textContent = section.title;
      const fields = document.createElement('dl');
      fields.className = 'record-detail-fields';
      section.fields.forEach((field) => fields.append(createField(field, payload.record)));
      container.append(heading, fields);
      this.elements.fields.append(container);
    });
    this.elements.edit.classList.toggle('hidden', !payload.module.permissions.edit);
  }
}