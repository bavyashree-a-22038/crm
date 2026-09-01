const express = require('express');
const { createCrmService, requireAuthentication } = require('../middleware/auth');
const { ZohoMetadataService } = require('../services/zohoMetadataService');

const router = express.Router();
router.use(requireAuthentication);

router.get('/', async (request, response, next) => {
  try {
    const metadataService = new ZohoMetadataService(createCrmService(request));
    response.json({ modules: await metadataService.getModules() });
  } catch (error) {
    next(error);
  }
});

router.get('/:module/fields', async (request, response, next) => {
  try {
    const metadataService = new ZohoMetadataService(createCrmService(request));
    const moduleMetadata = await metadataService.getModuleMetadata(request.params.module);
    const fields = await metadataService.getModuleFields(request.params.module, moduleMetadata);
    response.json({ fields });
  } catch (error) {
    next(error);
  }
});

router.get('/:module', async (request, response, next) => {
  try {
    const metadataService = new ZohoMetadataService(createCrmService(request));
    response.json({ module: await metadataService.getModuleMetadata(request.params.module) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
