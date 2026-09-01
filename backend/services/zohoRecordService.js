const { assertModuleApiName } = require('./zohoMetadataService');
const { getSafeZohoMessage } = require('./zohoCrmService');
const RECORD_ID = /^\d{5,30}$/;

function validationError(message, code, fieldErrors) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.code = code;
  error.status = 400;
  if (fieldErrors) error.fieldErrors = fieldErrors;
  return error;
}

function assertRecordId(recordId) {
  if (!RECORD_ID.test(String(recordId || ''))) {
    throw validationError('The record ID is invalid.', 'INVALID_RECORD_ID');
  }
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function validateFieldValue(field, value) {
  if (isBlank(value)) return null;
  const type = field.dataType;
  if (['integer', 'number', 'bigint', 'currency', 'decimal', 'double'].includes(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a valid number.';
  } else if (['boolean', 'checkbox'].includes(type)) {
    if (typeof value !== 'boolean') return 'Choose a valid boolean value.';
  } else if (type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter a valid date.';
  } else if (type === 'datetime') {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'Enter a valid date and time.';
  } else if (type === 'multiselectpicklist') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return 'Choose valid picklist values.';
  } else if (type === 'lookup') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !RECORD_ID.test(String(value.id || ''))) {
      return 'Enter a valid related record ID.';
    }
  } else if (typeof value !== 'string') {
    return 'Enter a valid text value.';
  }
  if (typeof value === 'string' && field.maxLength && value.length > field.maxLength) {
    return `Use no more than ${field.maxLength} characters.`;
  }
  if (field.picklistOptions.length) {
    const allowed = new Set(field.picklistOptions.map((option) => option.value));
    const values = Array.isArray(value) ? value : [value];
    if (values.some((entry) => !allowed.has(entry))) return 'Choose a valid picklist value.';
  }
  return null;
}

function validateRecordInput(input, fields, operation) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Record data must be a JSON object.', 'INVALID_RECORD_DATA');
  }
  const fieldMap = new Map(fields.map((field) => [field.apiName, field]));
  const fieldErrors = {};
  const result = {};

  for (const [apiName, value] of Object.entries(input)) {
    const field = fieldMap.get(apiName);
    if (!field) {
      fieldErrors[apiName] = 'This field is not available in the module metadata.';
      continue;
    }
    const allowed = operation === 'create' ? field.creatable : field.editable;
    if (!allowed || field.readOnly) {
      fieldErrors[apiName] = 'This field is read-only for this operation.';
      continue;
    }
    if (field.required && isBlank(value)) {
      fieldErrors[apiName] = 'This field is required.';
      continue;
    }
    const valueError = validateFieldValue(field, value);
    if (valueError) fieldErrors[apiName] = valueError;
    else result[apiName] = value;
  }

  if (operation === 'create') {
    fields.filter((field) => field.required && field.creatable).forEach((field) => {
      if (isBlank(input[field.apiName])) fieldErrors[field.apiName] = 'This field is required.';
    });
  }
  if (!Object.keys(result).length && !Object.keys(fieldErrors).length) {
    throw validationError('Provide at least one editable field.', 'EMPTY_RECORD_DATA');
  }
  if (Object.keys(fieldErrors).length) {
    throw validationError('Some record fields are invalid.', 'INVALID_RECORD_FIELDS', fieldErrors);
  }
  return result;
}

function normalizeMutationResult(payload) {
  const result = payload.data?.[0];
  if (!result) return { status: 'success' };
  if (result.status === 'error') {
    const code = result.code || 'ZOHO_VALIDATION_ERROR';
    const status = ['NO_PERMISSION', 'AUTHORIZATION_FAILED'].includes(code) ? 403 : 400;
    const message = getSafeZohoMessage(code, status);
    const error = new Error(message);
    error.name = 'ZohoValidationError';
    error.code = code;
    error.status = status;
    const fieldName = result.details?.api_name;
    if (fieldName) error.fieldErrors = { [fieldName]: message };
    throw error;
  }
  return {
    status: result.status || 'success',
    code: result.code || 'SUCCESS',
    message: result.message || 'The record was saved.',
    id: result.details?.id || null
  };
}

function sanitizeRecord(record, fields) {
  if (!record) return null;
  const result = { id: record.id };
  fields.forEach((field) => {
    if (Object.hasOwn(record, field.apiName)) result[field.apiName] = record[field.apiName];
  });
  return result;
}

function parseInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    const error = new Error(`${name} must be between ${minimum} and ${maximum}.`);
    error.name = 'ValidationError';
    error.code = 'INVALID_PAGINATION';
    error.status = 400;
    throw error;
  }
  return parsed;
}

function normalizeRecordResult(payload) {
  return {
    records: payload.data || [],
    page: {
      page: payload.info?.page || 1,
      perPage: payload.info?.per_page || 0,
      count: payload.info?.count || 0,
      moreRecords: payload.info?.more_records === true,
      nextPageToken: payload.info?.next_page_token || null,
      previousPageToken: payload.info?.previous_page_token || null,
      pageTokenExpiry: payload.info?.page_token_expiry || null
    }
  };
}

class ZohoRecordService {
  constructor(crmService) {
    this.crmService = crmService;
  }

  async getRecords(module, parameters, fields) {
    assertModuleApiName(module);
    const perPage = parseInteger(parameters.perPage, 50, 1, 200, 'per_page');
    const pageToken = parameters.pageToken || '';
    if (pageToken.length > 2048) {
      const error = new Error('The page token is invalid.');
      error.name = 'ValidationError';
      error.code = 'INVALID_PAGE_TOKEN';
      error.status = 400;
      throw error;
    }

    const query = {
      fields: fields.map((field) => field.apiName).slice(0, 50).join(','),
      per_page: perPage
    };
    if (pageToken) {
      query.page_token = pageToken;
    } else {
      query.page = parseInteger(parameters.page, 1, 1, 10, 'page');
    }

    return normalizeRecordResult(await this.crmService.request(encodeURIComponent(module), query));
  }

  async searchRecords(module, parameters) {
    assertModuleApiName(module);
    const word = String(parameters.word || '').trim();
    if (word.length < 2 || word.length > 100) {
      const error = new Error('Search text must contain between 2 and 100 characters.');
      error.name = 'ValidationError';
      error.code = 'INVALID_SEARCH';
      error.status = 400;
      throw error;
    }

    const query = {
      word,
      page: parseInteger(parameters.page, 1, 1, 10, 'page'),
      per_page: parseInteger(parameters.perPage, 50, 1, 200, 'per_page')
    };
    return normalizeRecordResult(await this.crmService.request(`${encodeURIComponent(module)}/search`, query));
  }

  async getRecord(module, recordId, fields) {
    assertModuleApiName(module);
    assertRecordId(recordId);
    const payload = await this.crmService.request(`${encodeURIComponent(module)}/${encodeURIComponent(recordId)}`);
    const record = sanitizeRecord(payload.data?.[0], fields);
    if (!record) {
      const error = new Error('The CRM record was not found.');
      error.name = 'RecordNotFoundError';
      error.code = 'RECORD_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    return record;
  }

  async createRecord(module, input, fields) {
    assertModuleApiName(module);
    const data = validateRecordInput(input, fields, 'create');
    const payload = await this.crmService.request(encodeURIComponent(module), {}, {
      method: 'POST',
      body: { data: [data] }
    });
    return normalizeMutationResult(payload);
  }

  async updateRecord(module, recordId, input, fields) {
    assertModuleApiName(module);
    assertRecordId(recordId);
    const data = validateRecordInput(input, fields, 'update');
    const payload = await this.crmService.request(`${encodeURIComponent(module)}/${encodeURIComponent(recordId)}`, {}, {
      method: 'PUT',
      body: { data: [data] }
    });
    return normalizeMutationResult(payload);
  }

  async deleteRecord(module, recordId) {
    assertModuleApiName(module);
    assertRecordId(recordId);
    return normalizeMutationResult(await this.crmService.request(
      `${encodeURIComponent(module)}/${encodeURIComponent(recordId)}`,
      {},
      { method: 'DELETE' }
    ));
  }
}

module.exports = {
  ZohoRecordService,
  assertRecordId,
  normalizeMutationResult,
  normalizeRecordResult,
  parseInteger,
  sanitizeRecord,
  validateRecordInput
};
