import { apiRequest } from './api.js';

export function getModuleAnalytics(moduleApiName) {
  return apiRequest(`/api/analytics/${encodeURIComponent(moduleApiName)}`);
}

export function renderBars(container, values) {
  container.replaceChildren();
  const maximum = Math.max(...values.map((value) => value.count), 1);
  values.forEach((value) => {
    const row = document.createElement('div');
    row.className = 'analytics-bar-row';

    const label = document.createElement('span');
    label.className = 'analytics-bar-label';
    label.textContent = value.label;

    const track = document.createElement('span');
    track.className = 'analytics-bar-track';
    const fill = document.createElement('span');
    fill.className = 'analytics-bar-fill';
    fill.style.width = `${Math.max((value.count / maximum) * 100, value.count ? 3 : 0)}%`;
    track.append(fill);

    const count = document.createElement('strong');
    count.textContent = value.count.toLocaleString();
    row.append(label, track, count);
    container.append(row);
  });
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export class AnalyticsDashboard {
  constructor(elements, onUnauthorized) {
    this.elements = elements;
    this.onUnauthorized = onUnauthorized;
    this.elements.moduleSelect.addEventListener('change', () => this.load());
    this.elements.refresh.addEventListener('click', () => this.load());
  }

  setModules(modules) {
    const selected = this.elements.moduleSelect.value;
    this.elements.moduleSelect.replaceChildren();
    modules.forEach((module) => {
      const option = document.createElement('option');
      option.value = module.apiName;
      option.textContent = module.pluralLabel || module.apiName;
      this.elements.moduleSelect.append(option);
    });
    if (modules.some((module) => module.apiName === selected)) {
      this.elements.moduleSelect.value = selected;
    }
    this.elements.empty.classList.toggle('hidden', modules.length > 0);
  }

  async load() {
    const moduleApiName = this.elements.moduleSelect.value;
    if (!moduleApiName) return;
    this.elements.status.textContent = 'Calculating live analytics...';
    this.elements.status.classList.remove('error');
    this.elements.content.classList.add('hidden');
    this.elements.refresh.disabled = true;
    try {
      this.render(await getModuleAnalytics(moduleApiName));
    } catch (error) {
      if (error.status === 401) return this.onUnauthorized();
      this.elements.status.textContent = error.message;
      this.elements.status.classList.add('error');
    } finally {
      this.elements.refresh.disabled = false;
    }
  }

  render(payload) {
    const { metrics, sample } = payload;
    this.elements.title.textContent = `${payload.module.pluralLabel || payload.module.apiName} analytics`;
    this.elements.sampledRecords.textContent = metrics.sampledRecords.toLocaleString();
    this.elements.recentRecords.textContent = metrics.recentRecords.toLocaleString();
    this.elements.completeness.textContent = `${metrics.completeness}%`;
    this.elements.populatedRecords.textContent = metrics.populatedRecords.toLocaleString();
    this.elements.status.textContent = sample.partial
      ? `Based on the first ${sample.records.toLocaleString()} records. More records exist in Zoho.`
      : `Based on all ${sample.records.toLocaleString()} available records.`;
    renderBars(this.elements.creationTrend, payload.creationTrend);

    const numeric = payload.numericSummary;
    this.elements.numericPanel.classList.toggle('hidden', !numeric);
    if (numeric) {
      this.elements.numericTitle.textContent = `${numeric.field} summary`;
      this.elements.numericTotal.textContent = formatNumber(numeric.total);
      this.elements.numericAverage.textContent = formatNumber(numeric.average);
      this.elements.numericRange.textContent = `${formatNumber(numeric.minimum)} – ${formatNumber(numeric.maximum)}`;
    }

    const distribution = payload.picklistDistribution;
    this.elements.picklistPanel.classList.toggle('hidden', !distribution);
    if (distribution) {
      this.elements.picklistTitle.textContent = `${distribution.field} distribution`;
      renderBars(this.elements.picklistDistribution, distribution.values);
    }
    this.elements.content.classList.remove('hidden');
  }
}