const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCloudflareD1QueryRequest,
  extractCloudflareD1VerificationRows,
  normalizeCloudflareD1Domain,
  normalizeCloudflareD1Domains,
  normalizeCloudflareD1Node,
  normalizeCloudflareD1Nodes,
} = require('../cloudflare-d1-email-utils.js');

test('normalizeCloudflareD1Domain and domains sanitize values', () => {
  assert.equal(normalizeCloudflareD1Domain('@Mail.Example.com'), 'mail.example.com');
  assert.equal(normalizeCloudflareD1Domain('bad-value'), '');
  assert.deepEqual(
    normalizeCloudflareD1Domains(['mail.example.com', 'MAIL.EXAMPLE.COM', 'bad-value']),
    ['mail.example.com']
  );
});

test('normalizeCloudflareD1Node supports runner-style keys', () => {
  assert.deepEqual(
    normalizeCloudflareD1Node({
      account_id: 'acc-1',
      database_id: 'db-1',
      api_token: 'token-1',
      customDomain: '@Mail.Example.com',
    }),
    {
      id: '',
      accountId: 'acc-1',
      databaseId: 'db-1',
      apiToken: 'token-1',
      domain: 'mail.example.com',
      domains: ['mail.example.com'],
    }
  );
});

test('normalizeCloudflareD1Nodes removes incomplete and duplicate nodes', () => {
  assert.deepEqual(
    normalizeCloudflareD1Nodes([
      { accountId: 'acc-1', databaseId: 'db-1', apiToken: 'token-1', domain: 'mail.example.com' },
      { accountId: 'acc-1', databaseId: 'db-1', apiToken: 'token-2', domain: 'mail.example.com' },
      { accountId: 'acc-2', databaseId: 'db-2', apiToken: '', domain: 'mail2.example.com' },
      { accountId: 'acc-3', databaseId: 'db-3', apiToken: 'token-3', domain: 'mail3.example.com' },
    ]),
    [
      {
        id: '',
        accountId: 'acc-1',
        databaseId: 'db-1',
        apiToken: 'token-1',
        domain: 'mail.example.com',
        domains: ['mail.example.com'],
      },
      {
        id: '',
        accountId: 'acc-3',
        databaseId: 'db-3',
        apiToken: 'token-3',
        domain: 'mail3.example.com',
        domains: ['mail3.example.com'],
      },
    ]
  );
});

test('buildCloudflareD1QueryRequest builds Cloudflare API payload', () => {
  assert.deepEqual(
    buildCloudflareD1QueryRequest(
      {
        accountId: 'acc-1',
        databaseId: 'db-1',
        apiToken: 'token-1',
      },
      'SELECT code FROM codes WHERE email = ?',
      ['demo@example.com']
    ),
    {
      url: 'https://api.cloudflare.com/client/v4/accounts/acc-1/d1/database/db-1/query',
      headers: {
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        sql: 'SELECT code FROM codes WHERE email = ?',
        params: ['demo@example.com'],
      },
    }
  );
});

test('extractCloudflareD1VerificationRows reads Cloudflare array result shape', () => {
  assert.deepEqual(
    extractCloudflareD1VerificationRows({
      result: [
        {
          results: [
            { code: '123456', received_at: '2026-04-15T10:00:00.000Z' },
            { code: '654321', received_at: '2026-04-15T09:59:00.000Z' },
          ],
        },
      ],
    }),
    [
      { code: '123456', receivedAt: '2026-04-15T10:00:00.000Z' },
      { code: '654321', receivedAt: '2026-04-15T09:59:00.000Z' },
    ]
  );
});
