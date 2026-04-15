const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  return source.slice(start, end);
}

const bundle = [
  extractFunction('getCloudflareD1Config'),
  extractFunction('getCloudflareD1Nodes'),
  extractFunction('pickRandomCloudflareD1Node'),
].join('\n');

const api = new Function(`
function normalizeCloudflareD1Domain(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '');
}
function normalizeCloudflareD1Domains(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeCloudflareD1Domain(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
function normalizeCloudflareD1Node(input = {}) {
  const domain = normalizeCloudflareD1Domain(input.domain || input.customDomain || '');
  return {
    id: String(input.id || '').trim(),
    accountId: String(input.accountId || input.account_id || '').trim(),
    databaseId: String(input.databaseId || input.database_id || '').trim(),
    apiToken: String(input.apiToken || input.api_token || '').trim(),
    domain,
    domains: normalizeCloudflareD1Domains([domain]),
  };
}
function normalizeCloudflareD1Nodes(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeCloudflareD1Node(value);
    const key = normalized.accountId + '::' + normalized.databaseId + '::' + normalized.domain;
    if (!normalized.accountId || !normalized.databaseId || !normalized.apiToken || !normalized.domain || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

${bundle}

return { getCloudflareD1Nodes, pickRandomCloudflareD1Node };
`)();

(() => {
  const nodes = api.getCloudflareD1Nodes({
    cloudflareD1Nodes: [
      { accountId: 'acc-1', databaseId: 'db-1', apiToken: 'token-1', domain: 'mail1.example.com' },
      { accountId: 'acc-2', databaseId: 'db-2', apiToken: 'token-2', domain: 'mail2.example.com' },
    ],
  });
  assert.strictEqual(nodes.length, 2, '应读取多 D1 节点配置');

  const picked = api.pickRandomCloudflareD1Node({
    cloudflareD1Nodes: [
      { accountId: 'acc-1', databaseId: 'db-1', apiToken: 'token-1', domain: 'mail1.example.com' },
      { accountId: 'acc-2', databaseId: 'db-2', apiToken: 'token-2', domain: 'mail2.example.com' },
    ],
  });
  assert.ok(['acc-1', 'acc-2'].includes(picked.accountId), '随机节点应来自节点池');

  const fallbackNodes = api.getCloudflareD1Nodes({
    cloudflareD1AccountId: 'acc-solo',
    cloudflareD1DatabaseId: 'db-solo',
    cloudflareD1ApiToken: 'token-solo',
    cloudflareD1Domain: 'mail-solo.example.com',
  });
  assert.strictEqual(fallbackNodes.length, 1, '无节点数组时应回退到单节点配置');

  console.log('background cloudflare d1 tests passed');
})();
