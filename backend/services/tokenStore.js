const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');

async function createSessionStore(redisUrl) {
  if (!redisUrl) {
    return {
      store: new session.MemoryStore(),
      close: async () => {}
    };
  }

  const client = createClient({ url: redisUrl });
  client.on('error', (error) => {
    console.error('Redis session error:', error.message);
  });
  await client.connect();

  return {
    store: new RedisStore({ client, prefix: 'mini-crm:sess:' }),
    close: () => client.quit()
  };
}

module.exports = { createSessionStore };
