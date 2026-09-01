const MODULE_API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const TABLE_FIELD_LIMIT = 10;
const COMPLEX_FIELD_TYPES = new Set([
  'fileupload',
  'imageupload',
  'multiselectlookup',
  'multiuserlookup',
  'subform'
]);
const EDITABLE_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'integer',
  'number',
  'bigint',
  'currency',
  'decimal',
  'double',
  'date',
  'datetime',
  'boolean',
  'checkbox',
  'picklist',
  'multiselectpicklist',
  'lookup'
]);

function normalizeDataType(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]/g, '');
}

function getInputType(dataType) {
  if (['integer', 'number', 'bigint', 'currency', 'decimal', 'double'].includes(dataType)) return 'number';
  if (dataType === 'date') return 'date';
  if (dataType === 'datetime') return 'datetime-local';
  if (['boolean', 'checkbox'].includes(dataType)) return 'checkbox';
  if (dataType === 'textarea') return 'textarea';
  if (dataType === 'picklist') return 'select';
  if (dataType === 'multiselectpicklist') return 'multiselect';
  if (dataType === 'lookup') return 'lookup';
  return dataType === 'text' ? 'text' : 'readonly';
}

function assertModuleApiName(module) {
  if (!MODULE_API_NAME.test(module)) {
    const error = new Error('The module API name is invalid.');
    error.name = 'ValidationError';
    error.code = 'INVALID_MODULE';
    error.status = 400;
    throw error;
  }
}

function isAvailableModule(module) {
  return module
    && module.status === 'visible'
    && module.visibility === 1
    && module.visible !== false
    && module.api_supported === true
    && module.viewable === true;
}

function normalizeModule(module) {
  return {
    id: module.id,
    apiName: module.api_name,
    singularLabel: module.singular_label,
    pluralLabel: module.plural_label,
    sequenceNumber: module.sequence_number,
    globalSearchSupported: module.global_search_supported === true,
    permissions: {
      view: module.viewable === true,
      create: module.creatable === true,
      edit: module.editable === true,
      delete: module.deletable === true
    }
  };
}

function normalizeField(field) {
  const dataType = normalizeDataType(field.data_type);
  const readOnly = field.read_only === true
    || field.field_read_only === true
    || field.virtual_field === true;
  const supported = EDITABLE_FIELD_TYPES.has(dataType);
  return {
    id: field.id,
    apiName: field.api_name,
    label: field.field_label || field.display_label || field.api_name,
    dataType,
    jsonType: field.json_type,
    visible: field.visible === true,
    readOnly: readOnly || !supported,
    required: field.system_mandatory === true,
    creatable: supported && !readOnly && field.operation_type?.api_create === true,
    editable: supported && !readOnly && field.operation_type?.api_update === true,
    maxLength: Number.isInteger(field.length) ? field.length : null,
    decimalPlaces: Number.isInteger(field.decimal_place) ? field.decimal_place : null,
    picklistOptions: (field.pick_list_values || [])
      .filter((option) => option.type !== 'unused')
      .map((option) => ({
        id: option.id,
        value: option.actual_value ?? option.display_value,
        label: option.display_value ?? option.actual_value
      }))
      .filter((option) => option.value !== undefined),
    lookup: field.lookup ? {
      moduleApiName: field.lookup.api_name || field.lookup.module?.api_name || null,
      moduleId: field.lookup.id || field.lookup.module?.id || null
    } : null,
    inputType: getInputType(dataType),
    displayField: field.display_field === true,
    searchable: field.searchable === true,
    sortable: field.sortable === true,
    sequence: field.quick_sequence_number,
    restricted: field.private?.restricted === true
  };
}

function selectTableFields(fields) {
  return fields
    .filter((field) => field.visible && !field.restricted && field.apiName)
    .filter((field) => !COMPLEX_FIELD_TYPES.has(String(field.dataType).toLowerCase()))
    .sort((left, right) => {
      if (left.displayField !== right.displayField) return left.displayField ? -1 : 1;
      return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, TABLE_FIELD_LIMIT);
}

class ZohoMetadataService {
  constructor(crmService) {
    this.crmService = crmService;
  }

  async getModules() {
    const payload = await this.crmService.request('settings/modules');
    return (payload.modules || [])
      .filter(isAvailableModule)
      .sort((left, right) => (left.sequence_number ?? Number.MAX_SAFE_INTEGER) - (right.sequence_number ?? Number.MAX_SAFE_INTEGER))
      .map(normalizeModule);
  }

  async getModuleMetadata(module) {
    assertModuleApiName(module);
    const payload = await this.crmService.request(`settings/modules/${encodeURIComponent(module)}`);
    const metadata = payload.modules?.[0];
    if (!isAvailableModule(metadata)) {
      const error = new Error('This module is unavailable or cannot be viewed.');
      error.name = 'ModuleAccessError';
      error.code = 'MODULE_NOT_AVAILABLE';
      error.status = 403;
      throw error;
    }
    return normalizeModule(metadata);
  }

  async getModuleFields(module, moduleMetadata) {
    if (!moduleMetadata) await this.getModuleMetadata(module);
    const payload = await this.crmService.request('settings/fields', { module });
    return (payload.fields || [])
      .map(normalizeField)
      .filter((field) => field.visible && !field.restricted);
  }
}

module.exports = {
  ZohoMetadataService,
  assertModuleApiName,
  isAvailableModule,
  normalizeField,
  selectTableFields
};
