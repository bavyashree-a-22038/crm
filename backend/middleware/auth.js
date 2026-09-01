const { ZohoCrmService } = require('../services/zohoCrmService');

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function requireAuthentication(request, response, next) {
  if (!request.session.oauth?.accessToken) {
    const error = new Error('Authentication is required.');
    error.name = 'AuthenticationError';
    error.code = 'AUTHENTICATION_REQUIRED';
    error.status = 401;
    return next(error);
  }
  next();
}

function createCrmService(request) {
  return new ZohoCrmService(request.session.oauth, async (tokens) => {
    if (tokens) {
      request.session.oauth = tokens;
    } else {
      delete request.session.oauth;
    }
    await saveSession(request);
  });
}

module.exports = { createCrmService, requireAuthentication };
