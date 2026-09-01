const express = require('express');
const { createCrmService, requireAuthentication } = require('../middleware/auth');
const { ZohoMetadataService, selectTableFields } = require('../services/zohoMetadataService');
const { ZohoRecordService } = require('../services/zohoRecordService');

const router = express.Router();
router.use(requireAuthentication);

async function createModuleContext(request) {
  const crmService = createCrmService(request);
  const metadataService = new ZohoMetadataService(crmService);
  const moduleMetadata = await metadataService.getModuleMetadata(request.params.module);
  const fields = await metadataService.getModuleFields(request.params.module, moduleMetadata);
  const tableFields = selectTableFields(fields);

  return {
    moduleMetadata,
    fields,
    tableFields,
    recordService: new ZohoRecordService(crmService)
  };
}

function assertModulePermission(moduleMetadata, permission) {
  if (!moduleMetadata.permissions[permission]) {
    const error = new Error(`This module does not support ${permission} operations for the current user.`);
    error.name = 'ModulePermissionError';
    error.code = 'MODULE_OPERATION_NOT_ALLOWED';
    error.status = 403;
    throw error;
  }
}

router.get('/:module/search', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    if (!context.moduleMetadata.globalSearchSupported) {
      const error = new Error('Global search is not supported for this module.');
      error.name = 'SearchNotSupportedError';
      error.code = 'SEARCH_NOT_SUPPORTED';
      error.status = 400;
      throw error;
    }

    const result = await context.recordService.searchRecords(request.params.module, {
      word: request.query.word,
      page: request.query.page,
      perPage: request.query.per_page
    });
    response.json({
      module: context.moduleMetadata,
      fields: context.tableFields,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:module/:recordId', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    const record = await context.recordService.getRecord(
      request.params.module,
      request.params.recordId,
      context.fields
    );
    response.json({ module: context.moduleMetadata, fields: context.fields, record });
  } catch (error) {
    next(error);
  }
});

router.post('/:module', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    assertModulePermission(context.moduleMetadata, 'create');
    const result = await context.recordService.createRecord(
      request.params.module,
      request.body?.data,
      context.fields
    );
    response.status(201).json({ result });
  } catch (error) {
    next(error);
  }
});

router.put('/:module/:recordId', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    assertModulePermission(context.moduleMetadata, 'edit');
    const result = await context.recordService.updateRecord(
      request.params.module,
      request.params.recordId,
      request.body?.data,
      context.fields
    );
    response.json({ result });
  } catch (error) {
    next(error);
  }
});

router.delete('/:module/:recordId', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    assertModulePermission(context.moduleMetadata, 'delete');
    const result = await context.recordService.deleteRecord(request.params.module, request.params.recordId);
    response.json({ result });
  } catch (error) {
    next(error);
  }
});

router.get('/:module', async (request, response, next) => {
  try {
    const context = await createModuleContext(request);
    if (!context.tableFields.length) {
      const error = new Error('This module has no visible fields that can be displayed.');
      error.name = 'ModuleAccessError';
      error.code = 'NO_VISIBLE_FIELDS';
      error.status = 403;
      throw error;
    }
    const result = await context.recordService.getRecords(request.params.module, {
      page: request.query.page,
      perPage: request.query.per_page,
      pageToken: request.query.page_token
    }, context.tableFields);
    response.json({
      module: context.moduleMetadata,
      fields: context.tableFields,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
