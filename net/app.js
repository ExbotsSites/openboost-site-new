(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const identityStatus = $('identity-status');
  const identityIp = $('identity-ip');
  const identityOrg = $('identity-org');
  const identityAsn = $('identity-asn');
  const identityLocation = $('identity-location');
  const identityTimezone = $('identity-timezone');
  const identitySource = $('identity-source');
  const copyIpButton = $('identity-copy');
  const refreshButton = $('identity-refresh');

  let currentIp = '';

  function setStatus(element, text, tone = '') {
    element.textContent = text;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('Copy failed.');
  }

  async function fetchJson(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Lookup failed (${response.status}).`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function parseAsn(org) {
    const match = String(org || '').match(/\bAS\d+\b/i);
    return match ? match[0].toUpperCase() : '';
  }

  function cleanOrg(org) {
    return String(org || '').replace(/^AS\d+\s+/i, '').trim();
  }

  function place(city, region, country) {
    return [city, region, country].filter(Boolean).join(', ') || 'Unavailable';
  }

  const identitySources = [
    {
      name: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      normalize(data) {
        if (!data || !data.ip) return null;
        return {
          ip: data.ip,
          org: cleanOrg(data.org) || 'Unavailable',
          asn: data.asn || parseAsn(data.org) || 'Unavailable',
          location: place(data.city, data.region, data.country_name || data.country),
          timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unavailable'
        };
      }
    },
    {
      name: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      normalize(data) {
        if (!data || !data.ip) return null;
        return {
          ip: data.ip,
          org: cleanOrg(data.org) || 'Unavailable',
          asn: parseAsn(data.org) || 'Unavailable',
          location: place(data.city, data.region, data.country),
          timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unavailable'
        };
      }
    },
    {
      name: 'ipify.org',
      url: 'https://api.ipify.org?format=json',
      normalize(data) {
        if (!data || !data.ip) return null;
        return {
          ip: data.ip,
          org: 'Unavailable',
          asn: 'Unavailable',
          location: 'Unavailable',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unavailable'
        };
      }
    }
  ];

  function renderIdentity(info, source) {
    currentIp = info.ip;
    identityIp.textContent = info.ip;
    identityIp.classList.toggle('ip--long', info.ip.includes(':') || info.ip.length > 20);
    identityOrg.textContent = info.org;
    identityAsn.textContent = info.asn;
    identityLocation.textContent = info.location;
    identityTimezone.textContent = info.timezone;
    identitySource.textContent = source.name;
    copyIpButton.disabled = false;
    setStatus(identityStatus, `Updated from ${source.name}.`, 'good');
  }

  async function loadIdentity() {
    refreshButton.disabled = true;
    copyIpButton.disabled = true;
    setStatus(identityStatus, 'Reading your address…');

    for (const source of identitySources) {
      try {
        const data = await fetchJson(source.url);
        const info = source.normalize(data);
        if (!info) continue;
        renderIdentity(info, source);
        refreshButton.disabled = false;
        return;
      } catch {
        // Try the next provider; a rate limit should not blank the card.
      }
    }

    identityIp.textContent = '—';
    identityOrg.textContent = 'Unavailable';
    identityAsn.textContent = 'Unavailable';
    identityLocation.textContent = 'Unavailable';
    identityTimezone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unavailable';
    setStatus(identityStatus, 'Could not read your public address. Try Refresh in a moment.', 'error');
    refreshButton.disabled = false;
  }

  copyIpButton.addEventListener('click', async () => {
    if (!currentIp) return;
    const original = copyIpButton.textContent;
    try {
      await copyText(currentIp);
      copyIpButton.textContent = 'Copied';
      setStatus(identityStatus, 'IP copied.', 'good');
    } catch {
      copyIpButton.textContent = 'Copy failed';
    }
    setTimeout(() => {
      copyIpButton.textContent = original;
    }, 1400);
  });

  refreshButton.addEventListener('click', loadIdentity);

  const dnsForm = $('dns-form');
  const dnsName = $('dns-name');
  const dnsType = $('dns-type');
  const dnsStatus = $('dns-status');
  const dnsResults = $('dns-results');
  const dnsCopy = $('dns-copy');

  const dnsNames = {
    1: 'A',
    2: 'NS',
    5: 'CNAME',
    6: 'SOA',
    15: 'MX',
    16: 'TXT',
    28: 'AAAA',
    257: 'CAA'
  };

  let lastAnswers = [];

  function normalizeHost(value) {
    const raw = value.trim();
    if (!raw) return null;

    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      return url.hostname || null;
    } catch {
      return null;
    }
  }

  function showEmpty(text) {
    const item = document.createElement('li');
    item.className = 'dns-empty';
    item.textContent = text;
    dnsResults.replaceChildren(item);
  }

  function renderAnswers(answers) {
    dnsResults.replaceChildren();

    const fragment = document.createDocumentFragment();
    for (const answer of answers) {
      const item = document.createElement('li');
      item.className = 'dns-answer';

      const type = document.createElement('span');
      type.className = 'answer-type';
      type.textContent = dnsNames[answer.type] || `TYPE${answer.type}`;

      const ttl = document.createElement('span');
      ttl.className = 'answer-ttl';
      ttl.textContent = Number.isFinite(answer.TTL) ? `TTL ${answer.TTL}` : '';

      const data = document.createElement('span');
      data.className = 'answer-data';
      data.textContent = answer.data;

      item.append(type, ttl, data);
      fragment.append(item);
    }

    dnsResults.append(fragment);
  }

  async function lookupDns(event) {
    if (event) event.preventDefault();

    const host = normalizeHost(dnsName.value);
    if (!host) {
      showEmpty('Enter a domain such as example.com.');
      setStatus(dnsStatus, 'That does not look like a domain.', 'error');
      dnsName.focus();
      dnsCopy.disabled = true;
      return;
    }

    const type = dnsType.value;
    dnsCopy.disabled = true;
    setStatus(dnsStatus, `Looking up ${host} (${type})…`);
    showEmpty('Looking up records…');

    const endpoints = [
      {
        name: 'Cloudflare',
        url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${encodeURIComponent(type)}`
      },
      {
        name: 'Google',
        url: `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${encodeURIComponent(type)}`
      }
    ];

    let data = null;
    let source = '';

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint.url, {
          cache: 'no-store',
          headers: { Accept: 'application/dns-json' }
        });
        if (!response.ok) continue;
        data = await response.json();
        source = endpoint.name;
        break;
      } catch {
        // Try the second public resolver.
      }
    }

    if (!data) {
      showEmpty('No resolver answered.');
      setStatus(dnsStatus, 'Could not reach a DNS resolver. Try again.', 'error');
      return;
    }

    if (data.Status === 3) {
      showEmpty('That domain does not exist (NXDOMAIN).');
      setStatus(dnsStatus, `No records found for ${host}.`, 'error');
      return;
    }

    if (data.Status !== 0) {
      showEmpty('The resolver returned an error.');
      setStatus(dnsStatus, `Resolver status ${data.Status}.`, 'error');
      return;
    }

    const answers = Array.isArray(data.Answer) ? data.Answer : [];
    lastAnswers = answers;

    if (!answers.length) {
      showEmpty(`No ${type} records returned for this name.`);
      setStatus(dnsStatus, `No ${type} records from ${source}.`, 'good');
      return;
    }

    renderAnswers(answers);
    dnsCopy.disabled = false;
    setStatus(dnsStatus, `${answers.length} answer${answers.length === 1 ? '' : 's'} from ${source}.`, 'good');
  }

  dnsForm.addEventListener('submit', lookupDns);

  document.querySelectorAll('[data-domain]').forEach(button => {
    button.addEventListener('click', () => {
      dnsName.value = button.dataset.domain;
      dnsType.value = button.dataset.type || 'A';
      lookupDns();
    });
  });

  dnsCopy.addEventListener('click', async () => {
    if (!lastAnswers.length) return;
    const original = dnsCopy.textContent;
    const text = lastAnswers
      .map(answer => `${dnsNames[answer.type] || `TYPE${answer.type}`}\t${answer.data}`)
      .join('\n');

    try {
      await copyText(text);
      dnsCopy.textContent = 'Copied';
      setStatus(dnsStatus, 'DNS answers copied.', 'good');
    } catch {
      dnsCopy.textContent = 'Copy failed';
    }
    setTimeout(() => {
      dnsCopy.textContent = original;
    }, 1400);
  });

  loadIdentity();
})();
