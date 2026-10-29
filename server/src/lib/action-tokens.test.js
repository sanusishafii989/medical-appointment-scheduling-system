const { createActionToken, hashActionToken } = require('./action-tokens');

describe('appointment action tokens', () => {
  test('creates a random token and a matching SHA-256 hash', () => {
    const { token, tokenHash } = createActionToken();

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toBe(hashActionToken(token));
    expect(tokenHash).not.toBe(token);
  });

  test('creates distinct tokens for separate actions', () => {
    expect(createActionToken().token).not.toBe(createActionToken().token);
  });
});
