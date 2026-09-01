import { apiRequest } from './api.js';

export function getModules() {
  return apiRequest('/api/modules');
}

export function getModuleMetadata(moduleApiName) {
  return apiRequest(`/api/modules/${encodeURIComponent(moduleApiName)}`);
}

export function getModuleFields(moduleApiName) {
  return apiRequest(`/api/modules/${encodeURIComponent(moduleApiName)}/fields`);
}

export class ModuleNavigation {
  constructor(container, onSelect) {
    this.container = container;
    this.onSelect = onSelect;
    this.activeModule = null;
  }

  render(modules) {
    this.container.replaceChildren();
    modules.forEach((module) => {
      const button = document.createElement('button');
      button.className = 'module-button';
      button.type = 'button';
      button.textContent = module.pluralLabel || module.apiName;
      button.title = module.pluralLabel || module.apiName;
      button.dataset.module = module.apiName;
      button.addEventListener('click', () => this.onSelect(module));
      this.container.append(button);
    });
  }

  setActive(moduleApiName) {
    this.activeModule = moduleApiName;
    this.container.querySelectorAll('.module-button').forEach((button) => {
      button.classList.toggle('active', button.dataset.module === moduleApiName);
      if (button.dataset.module === moduleApiName) button.scrollIntoView?.({ block: 'nearest' });
    });
  }
}
