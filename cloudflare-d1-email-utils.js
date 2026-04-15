(function cloudflareD1EmailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.CloudflareD1EmailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createCloudflareD1EmailUtils() {
  function normalizeCloudflareD1Domain(rawValue = '') {
    let value = String(rawValue || '').trim().toLowerCase();
    if (!value) return '';
    value = value.replace(/^@+/, '');
    value = value.replace(/^https?:\/\//, '');
    value = value.replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
      return '';
    }
    return value;
  }

  function normalizeCloudflareD1Domains(values) {
    const domains = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeCloudflareD1Domain(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      domains.push(normalized);
    }
    return domains;
  }

  function normalizeCloudflareD1Node(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        accountId: '',
        databaseId: '',
        apiToken: '',
        domain: '',
        domains: [],
      };
    }

    const domains = normalizeCloudflareD1Domains([
      ...(Array.isArray(input.domains) ? input.domains : []),
      input.domain,
      input.customDomain,
    ]);

    const domain = normalizeCloudflareD1Domain(input.domain || input.customDomain || domains[0] || '');
    if (domain && !domains.includes(domain)) {
      domains.unshift(domain);
    }

    return {
      id: String(input.id || '').trim(),
      accountId: String(input.accountId || input.account_id || '').trim(),
      databaseId: String(input.databaseId || input.database_id || '').trim(),
      apiToken: String(input.apiToken || input.api_token || '').trim(),
      domain,
      domains,
    };
  }

  function normalizeCloudflareD1Nodes(values) {
    const nodes = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeCloudflareD1Node(value);
      const key = `${normalized.accountId}::${normalized.databaseId}::${normalized.domain}`;
      if (!normalized.accountId || !normalized.databaseId || !normalized.apiToken || !normalized.domain || seen.has(key)) {
        continue;
      }
      seen.add(key);
      nodes.push(normalized);
    }
    return nodes;
  }

  function buildCloudflareD1QueryRequest(node = {}, sql = '', params = []) {
    const normalizedNode = normalizeCloudflareD1Node(node);
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(normalizedNode.accountId)}/d1/database/${encodeURIComponent(normalizedNode.databaseId)}/query`,
      headers: {
        Authorization: `Bearer ${normalizedNode.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        sql: String(sql || ''),
        params: Array.isArray(params) ? params : [],
      },
    };
  }

  function getCloudflareD1ResultRows(payload = {}) {
    const result = payload?.result;
    if (Array.isArray(result)) {
      for (const item of result) {
        if (Array.isArray(item?.results)) {
          return item.results;
        }
      }
      return [];
    }

    if (result && typeof result === 'object' && Array.isArray(result.results)) {
      return result.results;
    }

    return [];
  }

  function extractCloudflareD1VerificationRows(payload = {}) {
    return getCloudflareD1ResultRows(payload)
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        code: String(row.code || '').trim(),
        receivedAt: row.received_at ?? row.receivedAt ?? row.created_at ?? row.createdAt ?? '',
      }));
  }

  return {
    buildCloudflareD1QueryRequest,
    extractCloudflareD1VerificationRows,
    normalizeCloudflareD1Domain,
    normalizeCloudflareD1Domains,
    normalizeCloudflareD1Node,
    normalizeCloudflareD1Nodes,
  };
});
