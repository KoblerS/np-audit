'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Marshaller } = require('./base');

const SNYK_CONFIG_FILE = '.config/configstore/snyk.json';

class CveMarshaller extends Marshaller {
  constructor() {
    super('known-vulnerability', 'Known vulnerability check (Snyk / OSV.dev)');
  }

  async checkPackage(pkg, config) {
    if (!pkg.name || !pkg.version) return null;

    try {
      const token = this.getSnykToken();
      const timeout = Math.min(config.timeout || 10000, 10000);
      const result = token
        ? await this.querySnyk(pkg.name, pkg.version, token, timeout)
        : await this.queryOsv(pkg.name, pkg.version, timeout);

      if (result.issuesCount === 0) return null;

      if (result.isMalicious) {
        return {
          name: this.name,
          score: 80,
          detail: `Malicious package detected — ${result.issuesCount} advisory(ies) found`,
        };
      }

      // Non-malicious CVEs are informational (WARN, never BLOCK)
      let score = 4;
      if (result.issuesCount >= 10) score = 6;
      else if (result.issuesCount >= 5) score = 5;

      const source = token ? 'Snyk' : 'OSV.dev';
      return {
        name: this.name,
        score,
        detail: `${result.issuesCount} known vulnerability(ies) via ${source}`,
      };
    } catch {
      return null;
    }
  }

  getSnykToken() {
    const token = process.env.SNYK_API_TOKEN || process.env.SNYK_TOKEN;
    if (token) return token;

    try {
      const configPath = path.join(os.homedir(), SNYK_CONFIG_FILE);
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg && cfg.api) return cfg.api;
    } catch {
      // No Snyk config
    }

    return null;
  }

  async querySnyk(packageName, packageVersion, token, timeout) {
    const { fetchJSON } = require('../utils/fetcher');
    const apiUrl = process.env.SNYK_API_URL || process.env.SNYK_API || 'https://snyk.io/api/v1/vuln/npm';
    const url = `${apiUrl}/${encodeURIComponent(packageName + '@' + packageVersion)}`;

    const data = await fetchJSON(url, {
      timeout,
      headers: { Authorization: `token ${token}` },
    });

    if (data && data.vulnerabilities) {
      const isMalicious = data.vulnerabilities.some(v => v.title === 'Malicious Package');
      return { issuesCount: data.vulnerabilities.length, isMalicious };
    }
    return { issuesCount: 0, isMalicious: false };
  }

  async queryOsv(packageName, packageVersion, timeout) {
    const { fetchJSON } = require('../utils/fetcher');
    const url = 'https://api.osv.dev/v1/query';

    const body = JSON.stringify({
      version: packageVersion,
      package: { name: packageName, ecosystem: 'npm' },
    });

    const data = await fetchJSON(url, {
      timeout,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (data && data.vulns && data.vulns.length > 0) {
      const isMalicious = data.vulns.some(vuln => {
        const ds = vuln.database_specific;
        if (ds && ds['malicious-packages-origins'] && Array.isArray(ds['malicious-packages-origins'])) {
          return true;
        }
        if (typeof vuln.summary === 'string' && vuln.summary.toLowerCase().startsWith('malicious')) {
          return true;
        }
        return false;
      });
      return { issuesCount: data.vulns.length, isMalicious };
    }
    return { issuesCount: 0, isMalicious: false };
  }
}

module.exports = new CveMarshaller();
