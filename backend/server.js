if (process.env.NODE_ENV !== 'test') require('dotenv').config();

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { config, validateRuntimeConfig } = require('./config');
const authRoutes = require('./routes/auth');
const analyticsRoutes = require('./routes/analytics');
const moduleRoutes = require('./routes/modules');
const recordRoutes = require('./routes/records');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createSessionStore } = require('./services/tokenStore');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requireSameOrigin(request, response, next) {
  if (SAFE_METHODS.has(request.method) || !request.get('origin')) return next();

  let origin;
  try {
    origin = new URL(request.get('origin')).origin;
  } catch {
    return response.status(403).json({
      error: 'Cross-origin requests are not allowed.',
      code: 'ORIGIN_NOT_ALLOWED'
    });
  }

  const expectedOrigin = `${request.protocol}://${request.get('host')}`;
  if (origin !== expectedOrigin) {
    return response.status(403).json({
      error: 'Cross-origin requests are not allowed.',
      code: 'ORIGIN_NOT_ALLOWED'
    });
  }
  next();
}

async function createApp() {
  validateRuntimeConfig();
  const sessionStore = await createSessionStore(config.redisUrl);
  const app = express();

  if (config.trustProxy || config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requireSameOrigin);
  app.use(session({
    name: 'mini_crm_session',
    secret: config.sessionSecret,
    store: sessionStore.store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  app.get('/api/health', (request, response) => {
    response.json({ status: 'ok' });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/modules', moduleRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api', notFoundHandler);

  const frontendPath = path.join(__dirname, '..', 'frontend');
  app.use(express.static(frontendPath, { extensions: ['html'] }));
  app.get('*splat', (request, response) => {
    response.sendFile(path.join(frontendPath, 'index.html'));
  });

  app.use(errorHandler);
  app.locals.closeResources = sessionStore.close;
  return app;
}

async function start() {
  const app = await createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Mini CRM listening on port ${config.port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await app.locals.closeResources();
      process.exit(0);
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp, requireSameOrigin };
