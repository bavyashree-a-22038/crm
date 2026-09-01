const express = require('express');
const { createCrmService, requireAuthentication } = require('../middleware/auth');
const { ZohoAnalyticsService } = require('../services/zohoAnalyticsService');
const { ZohoMetadataService } = require('../services/zohoMetadataService');

const router = express.Router();
router.use(requireAuthentication);

router.get('/:module', async (request, response, next) => {
  try {
    const crmService = createCrmService(request);
    const analyticsService = new ZohoAnalyticsService(
      crmService,
      new ZohoMetadataService(crmService)
    );
    response.json(await analyticsService.getModuleAnalytics(request.params.module));
  } catch (error) {
    next(error);
  }
});

module.exports = router;