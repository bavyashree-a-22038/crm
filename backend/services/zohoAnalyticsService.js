const { ZohoRecordService } = require('./zohoRecordService');

const SAMPLE_SIZE = 200;
const RECORD_FIELD_LIMIT = 50;

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function selectAnalyticsFields(fields) {
  const usableFields = fields.filter((field) => field.apiName);
  const createdTime = usableFields.find((field) => field.apiName === 'Created_Time');
  return [
    ...(createdTime ? [createdTime] : []),
    ...usableFields.filter((field) => field !== createdTime)
  ].slice(0, RECORD_FIELD_LIMIT);
}

function buildCreationTrend(records, now = new Date()) {
  const months = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({
      key: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      count: 0
    });
  }
  const monthMap = new Map(months.map((month) => [month.key, month]));
  records.forEach((record) => {
    if (!record.Created_Time) return;
    const date = new Date(record.Created_Time);
    if (Number.isNaN(date.getTime())) return;
    const month = monthMap.get(date.toISOString().slice(0, 7));
    if (month) month.count += 1;
  });
  return months;
}

function buildPicklistDistribution(fields, records) {
  const candidates = fields
    .filter((field) => ['picklist', 'multiselectpicklist'].includes(field.dataType))
    .map((field) => {
      const counts = new Map();
      records.forEach((record) => {
        const values = Array.isArray(record[field.apiName]) ? record[field.apiName] : [record[field.apiName]];
        values.filter(isPresent).forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
      });
      return { field, counts, populated: [...counts.values()].reduce((total, count) => total + count, 0) };
    })
    .sort((left, right) => right.populated - left.populated)[0];

  if (!candidates || !candidates.populated) return null;
  return {
    field: candidates.field.label,
    values: [...candidates.counts]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6)
  };
}

function buildNumericSummary(fields, records) {
  const candidates = fields
    .filter((field) => ['integer', 'number', 'bigint', 'currency', 'decimal', 'double'].includes(field.dataType))
    .map((field) => ({
      field,
      values: records.map((record) => record[field.apiName])
        .filter((value) => typeof value === 'number' && Number.isFinite(value))
    }))
    .filter((candidate) => candidate.values.length)
    .sort((left, right) => right.values.length - left.values.length);
  const candidate = candidates[0];
  if (!candidate) return null;
  const total = candidate.values.reduce((sum, value) => sum + value, 0);
  return {
    field: candidate.field.label,
    count: candidate.values.length,
    total,
    average: total / candidate.values.length,
    minimum: Math.min(...candidate.values),
    maximum: Math.max(...candidate.values)
  };
}

function countRecentRecords(records, now) {
  const threshold = now.getTime() - (30 * 24 * 60 * 60 * 1000);
  return records.filter((record) => {
    const created = new Date(record.Created_Time).getTime();
    return Number.isFinite(created) && created >= threshold && created <= now.getTime();
  }).length;
}

function summarizeAnalytics(moduleMetadata, fields, records, page, now = new Date()) {
  const sampledFields = selectAnalyticsFields(fields);
  const populatedCells = records.reduce((total, record) => total + sampledFields
    .filter((field) => isPresent(record[field.apiName])).length, 0);
  const possibleCells = records.length * sampledFields.length;
  const populatedRecords = records.filter((record) => sampledFields
    .some((field) => isPresent(record[field.apiName]))).length;

  return {
    module: moduleMetadata,
    generatedAt: now.toISOString(),
    sample: {
      records: records.length,
      limit: SAMPLE_SIZE,
      partial: page.moreRecords,
      fields: sampledFields.length
    },
    metrics: {
      sampledRecords: records.length,
      recentRecords: countRecentRecords(records, now),
      populatedRecords,
      completeness: possibleCells ? Math.round((populatedCells / possibleCells) * 100) : 0
    },
    creationTrend: buildCreationTrend(records, now),
    picklistDistribution: buildPicklistDistribution(sampledFields, records),
    numericSummary: buildNumericSummary(sampledFields, records)
  };
}

class ZohoAnalyticsService {
  constructor(crmService, metadataService) {
    this.metadataService = metadataService;
    this.recordService = new ZohoRecordService(crmService);
  }

  async getModuleAnalytics(module) {
    const moduleMetadata = await this.metadataService.getModuleMetadata(module);
    const fields = await this.metadataService.getModuleFields(module, moduleMetadata);
    const analyticsFields = selectAnalyticsFields(fields);
    if (!analyticsFields.length) {
      return summarizeAnalytics(moduleMetadata, fields, [], { moreRecords: false });
    }
    const result = await this.recordService.getRecords(module, {
      page: 1,
      perPage: SAMPLE_SIZE
    }, analyticsFields);
    return summarizeAnalytics(moduleMetadata, fields, result.records, result.page);
  }
}

module.exports = {
  SAMPLE_SIZE,
  ZohoAnalyticsService,
  buildCreationTrend,
  buildNumericSummary,
  selectAnalyticsFields,
  summarizeAnalytics
};