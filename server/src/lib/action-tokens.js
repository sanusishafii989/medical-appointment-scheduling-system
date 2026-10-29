const { createHash, randomBytes } = require('node:crypto');

function createActionToken() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashActionToken(token) };
}

function hashActionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

module.exports = { createActionToken, hashActionToken };
