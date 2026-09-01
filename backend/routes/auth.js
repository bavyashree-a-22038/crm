const crypto = require('node:crypto');
const express = require('express');
const { getMissingZohoConfig } = require('../config');
const { createCrmService } = require('../middleware/auth');
const {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  revokeRefreshToken
} = require('../services/zohoAuthService');

const router = express.Router();
const STATE_TTL_MS = 10 * 60 * 1000;

function equalState(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}

router.get('/status', (request, response) => {
  response.json({
    authenticated: Boolean(request.session.oauth?.accessToken),
    configured: getMissingZohoConfig().length === 0
  });
});

router.get('/me', async (request, response, next) => {
  try {
    const authenticated = Boolean(request.session.oauth?.accessToken);
    if (!authenticated) {
      return response.json({
        authenticated: false,
        configured: getMissingZohoConfig().length === 0,
        user: null
      });
    }

    const payload = await createCrmService(request).request('users', { type: 'CurrentUser' });
    const user = payload.users?.[0];
    if (!user) {
      const error = new Error('Zoho did not return the authenticated CRM user.');
      error.status = 502;
      throw error;
    }

    response.json({
      authenticated: true,
      configured: true,
      user: {
        id: user.id,
        zohoUserId: user.zuid,
        fullName: user.full_name,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        status: user.status,
        role: user.role ? { id: user.role.id, name: user.role.name } : null,
        profile: user.profile ? { id: user.profile.id, name: user.profile.name } : null,
        locale: user.locale,
        timeZone: user.time_zone
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/login', async (request, response, next) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    const authorizationUrl = createAuthorizationUrl(state);
    request.session.oauthState = { value: state, createdAt: Date.now() };
    await saveSession(request);
    response.redirect(authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/callback', async (request, response, next) => {
  try {
    const storedState = request.session.oauthState;
    delete request.session.oauthState;
    const stateExpired = !storedState?.createdAt
      || Date.now() - storedState.createdAt > STATE_TTL_MS;

    if (stateExpired || !equalState(storedState?.value, request.query.state)) {
      const error = new Error('The OAuth callback state is invalid or expired.');
      error.status = 400;
      throw error;
    }
    if (request.query.error) {
      await saveSession(request);
      return response.redirect('/?auth_error=access_denied');
    }
    if (typeof request.query.code !== 'string' || !request.query.code) {
      const error = new Error('Zoho did not return an authorization code.');
      error.status = 400;
      throw error;
    }

    const tokens = await exchangeAuthorizationCode(
      request.query.code,
      request.query['accounts-server']
    );
    await regenerateSession(request);
    request.session.oauth = tokens;
    await saveSession(request);
    response.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (request, response, next) => {
  try {
    const tokens = request.session.oauth;
    if (tokens) {
      try {
        await revokeRefreshToken(tokens);
      } catch (error) {
        console.error('Zoho token revocation failed:', error.message);
      }
    }
    await destroySession(request);
    response.clearCookie('mini_crm_session');
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
