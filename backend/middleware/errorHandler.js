function notFoundHandler(request, response) {
  response.status(404).json({ error: 'Route not found.' });
}

function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error('Request failed:', {
      name: error.name || 'Error',
      code: error.code || 'INTERNAL_ERROR',
      status,
      upstreamStatus: error.statusCode,
      message: error.message
    });
  }

  const payload = {
    error: status >= 500 ? 'The server could not complete the request.' : error.message,
    code: error.code || error.name || 'Error'
  };
  if (status < 500 && error.fieldErrors) payload.fieldErrors = error.fieldErrors;
  response.status(status).json(payload);
}

module.exports = { errorHandler, notFoundHandler };
