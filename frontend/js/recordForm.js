export function controlValue(field, record) {
  const value = record?.[field.apiName];
  if (field.inputType === 'lookup') return value?.id || '';
  if (field.inputType === 'datetime-local' && typeof value === 'string') return value.slice(0, 16);
  if (value && typeof value === 'object') {
    return value.name || value.display_value || value.id || '';
  }
  return value ?? '';
}

function createSelect(field, multiple) {
  const select = document.createElement('select');
  select.multiple = multiple;
  if (!multiple) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Select an option';
    select.append(emptyOption);
  }
  field.picklistOptions.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  });
  return select;
}

function createControl(field) {
  if (field.inputType === 'textarea') return document.createElement('textarea');
  if (field.inputType === 'select') return createSelect(field, false);
  if (field.inputType === 'multiselect') return createSelect(field, true);
  const input = document.createElement('input');
  input.type = field.inputType === 'lookup' || field.inputType === 'readonly'
    ? 'text'
    : field.inputType;
  if (field.inputType === 'number') {
    input.step = field.decimalPlaces === 0 ? '1' : 'any';
  }
  if (field.inputType === 'lookup') input.placeholder = 'Related record ID';
  return input;
}

export class RecordForm {
  constructor(elements, handlers) {
    this.elements = elements;
    this.handlers = handlers;
    this.fields = [];
    this.module = null;
    this.recordId = null;
    this.mode = 'create';
    this.saving = false;
    this.elements.form.addEventListener('submit', (event) => this.submit(event));
    this.elements.cancel.addEventListener('click', () => {
      this.handlers.onCancel();
      this.returnFocus?.focus();
    });
  }

  open(module, fields, record = null) {
    if (!this.returnFocus || !record) this.returnFocus = document.activeElement;
    this.module = module;
    this.fields = fields;
    this.recordId = record?.id || null;
    this.mode = record ? 'edit' : 'create';
    this.elements.title.textContent = `${record ? 'Edit' : 'New'} ${module.singularLabel || 'record'}`;
    this.elements.error.textContent = '';
    this.elements.error.classList.add('hidden');
    this.elements.fields.replaceChildren();

    fields
      .filter((field) => this.mode === 'edit' || field.creatable || field.required)
      .forEach((field) => this.renderField(field, record));
    this.initialValues = this.readValues();
    this.setSaving(false);
    this.elements.fields.querySelector(':is(input, textarea, select):not(:disabled)')?.focus();
  }

  setLoading(module) {
    this.returnFocus = document.activeElement;
    this.module = module;
    this.elements.title.textContent = `Loading ${module.singularLabel || 'record'}...`;
    this.elements.fields.replaceChildren();
    this.elements.error.classList.add('hidden');
    this.elements.save.disabled = true;
  }

  renderField(field, record) {
    const group = document.createElement('div');
    group.className = 'form-field';
    group.dataset.field = field.apiName;
    const label = document.createElement('label');
    const control = createControl(field);
    const controlId = `record-field-${field.id || field.apiName}`;
    const canEdit = this.mode === 'create' ? field.creatable : field.editable;

    label.htmlFor = controlId;
    label.textContent = field.label;
    if (field.required && canEdit) {
      const required = document.createElement('span');
      required.className = 'required-mark';
      required.textContent = 'Required';
      label.append(required);
    }
    control.id = controlId;
    control.name = field.apiName;
    control.disabled = !canEdit || field.readOnly;
    control.required = field.required && canEdit;
    if (field.maxLength && 'maxLength' in control) control.maxLength = field.maxLength;

    const value = controlValue(field, record);
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else if (control.multiple && Array.isArray(value)) {
      Array.from(control.options).forEach((option) => { option.selected = value.includes(option.value); });
    } else control.value = value;

    const error = document.createElement('p');
    error.className = 'field-error hidden';
    error.id = `${controlId}-error`;
    control.setAttribute('aria-describedby', error.id);
    group.append(label, control, error);
    this.elements.fields.append(group);
  }

  readValues() {
    const values = {};
    this.fields.forEach((field) => {
      const control = this.elements.form.elements.namedItem(field.apiName);
      if (!control || control.disabled) return;
      if (control.type === 'checkbox') values[field.apiName] = control.checked;
      else if (control.multiple) values[field.apiName] = Array.from(control.selectedOptions, (option) => option.value);
      else if (field.inputType === 'number') values[field.apiName] = control.value === '' ? null : Number(control.value);
      else if (field.inputType === 'lookup') values[field.apiName] = control.value ? { id: control.value.trim() } : null;
      else if (field.inputType === 'datetime-local') values[field.apiName] = control.value ? new Date(control.value).toISOString() : null;
      else values[field.apiName] = control.value === '' ? null : control.value;
    });
    return values;
  }

  getValues() {
    const values = this.readValues();
    if (this.mode === 'create') {
      return Object.fromEntries(Object.entries(values).filter(([, value]) => (
        value !== null && (!Array.isArray(value) || value.length > 0)
      )));
    }
    return Object.fromEntries(Object.entries(values).filter(([apiName, value]) => (
      JSON.stringify(value) !== JSON.stringify(this.initialValues[apiName])
    )));
  }

  showError(message, fieldErrors = {}) {
    this.elements.error.textContent = message;
    this.elements.error.classList.remove('hidden');
    this.elements.fields.querySelectorAll('.field-error').forEach((element) => {
      element.textContent = '';
      element.classList.add('hidden');
      element.previousElementSibling?.removeAttribute('aria-invalid');
    });
    let firstInvalidControl = null;
    Object.entries(fieldErrors).forEach(([apiName, fieldMessage]) => {
      const group = Array.from(this.elements.fields.children)
        .find((element) => element.dataset.field === apiName);
      const error = group?.querySelector('.field-error');
      if (error) {
        error.textContent = fieldMessage;
        error.classList.remove('hidden');
        const control = error.previousElementSibling;
        control?.setAttribute('aria-invalid', 'true');
        firstInvalidControl ||= control;
      }
    });
    if (message) (firstInvalidControl || this.elements.error).focus();
  }

  setSaving(saving) {
    this.saving = saving;
    this.elements.save.disabled = saving;
    this.elements.cancel.disabled = saving;
    this.elements.save.textContent = saving ? 'Saving...' : 'Save';
  }

  async submit(event) {
    event.preventDefault();
    if (this.saving || !this.elements.form.reportValidity()) return;
    const data = this.getValues();
    if (this.mode === 'edit' && !Object.keys(data).length) {
      this.showError('Change at least one field before saving.');
      return;
    }
    this.setSaving(true);
    this.showError('', {});
    this.elements.error.classList.add('hidden');
    try {
      await this.handlers.onSave({
        mode: this.mode,
        module: this.module,
        recordId: this.recordId,
        data
      });
    } catch (error) {
      this.showError(error.message, error.payload?.fieldErrors || {});
    } finally {
      this.setSaving(false);
    }
  }
}