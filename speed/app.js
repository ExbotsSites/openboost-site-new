(() => {
  'use strict';

  const DOWN = 'https://speed.cloudflare.com/__down';
  const UP = 'https://speed.cloudflare.com/__up';
  const TEST_SECONDS = 6;
  const DOWN_CHUNK = 20 * 1024 * 1024;
  const UP_CHUNK = 6 * 1024 * 1024;
  const GAUGE_MAX = 1000;
  const SERVER_NOTE = 'Iliad and TIM use Ookla endpoints that block browser tests. Add a LibreSpeed-compatible URL to test another network.';

  const servers = [
    { id: 'auto', label: 'Automatic — lowest latency', kind: 'auto' },
    { id: 'cloudflare', label: 'Cloudflare — nearest edge', kind: 'cloudflare', provider: 'Cloudflare', city: 'Nearest edge' },
    {
      id: 'garr-roma',
      label: 'Roma — GARR',
      kind: 'librespeed',
      provider: 'GARR',
      city: 'Roma',
      base: 'https://st-be-rm2.infra.garr.it'
    }
  ];

  const $ = id => document.getElementById(id);
  const el = {
    site: $('site'),
    start: $('start'),
    hint: $('hint'),
    status: $('status'),
    phase: $('phase'),
    metricLabel: $('metric-label'),
    value: $('value'),
    unit: $('unit'),
    fill: $('fill'),
    gauge: $('gauge'),
    download: $('download'),
    upload: $('upload'),
    ping: $('ping'),
    jitter: $('jitter'),
    serverSelect: $('server'),
    serverNote: $('server-note'),
    serverLabel: $('server-label'),
    message: $('message'),
    customForm: $('custom-form'),
    customName: $('custom-name'),
    customUrl: $('custom-url')
  };

  let busy = false;
  let customCount = 0;

  const formatMbps = value => Number.isFinite(value) ? value.toFixed(1) : '—';
  const formatMs = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
  const formatJitter = value => Number.isFinite(value) ? value.toFixed(1) : '—';

  function getServer(id) {
    return servers.find(server => server.id === id) || servers[0];
  }

  function serverLabel(server) {
    if (server.kind === 'auto') return 'Auto server';
    if (server.kind === 'cloudflare') return 'Cloudflare edge';
    return `${server.city} · ${server.provider}`;
  }

  function setStatus(text, state) {
    el.status.textContent = text;
    el.site.dataset.state = state;
  }

  function setMetric(label, value, unit) {
    el.metricLabel.textContent = label;
    el.value.textContent = value;
    el.unit.textContent = unit;
  }

  function setGauge(mbps, text) {
    const clamped = Math.max(0, Math.min(GAUGE_MAX, mbps));
    el.fill.style.width = `${clamped / GAUGE_MAX * 100}%`;
    el.gauge.setAttribute('aria-valuenow', String(Math.round(clamped)));
    el.gauge.setAttribute('aria-valuetext', text || `${Math.round(clamped)} megabits per second`);
  }

  function resetReadout() {
    setMetric('Download', '0.0', 'Mbps');
    setGauge(0, 'Ready');
    el.download.textContent = '—';
    el.upload.textContent = '—';
    el.ping.textContent = '—';
    el.jitter.textContent = '—';
    el.serverLabel.textContent = serverLabel(getServer(el.serverSelect.value));
    el.message.textContent = 'No data is stored by this page.';
    el.phase.textContent = 'Ready when you are';
  }

  function pingUrl(server) {
    if (server.kind === 'librespeed') {
      return `${server.base}/empty.php?cors=true&r=${Math.random()}`;
    }
    return `${DOWN}?bytes=1&r=${Math.random()}`;
  }

  function downloadUrl(server) {
    if (server.kind === 'librespeed') {
      const megabytes = Math.round(DOWN_CHUNK / 1024 / 1024);
      return `${server.base}/garbage.php?ckSize=${megabytes}&cors=true&r=${Math.random()}`;
    }
    return `${DOWN}?bytes=${DOWN_CHUNK}&r=${Math.random()}`;
  }

  function uploadUrl(server) {
    if (server.kind === 'librespeed') {
      return `${server.base}/empty.php?cors=true&r=${Math.random()}`;
    }
    return UP;
  }

  async function fetchWithTimeout(url, timeout = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function quickPing(server) {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const started = performance.now();
      const response = await fetchWithTimeout(pingUrl(server), 4000);
      if (!response.ok) throw new Error(`Server check failed (${response.status}).`);
      await response.arrayBuffer();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  }

  async function resolveServer() {
    if (el.serverSelect.value !== 'auto') return getServer(el.serverSelect.value);

    const candidates = servers.filter(server => server.kind !== 'auto');
    let best = null;

    for (const server of candidates) {
      try {
        const ping = await quickPing(server);
        if (!best || ping < best.ping) best = { server, ping };
      } catch {
        // Try the next public server; a dead host should not block the test.
      }
    }

    if (!best) throw new Error('No speed test server is reachable.');
    el.serverSelect.value = best.server.id;
    return best.server;
  }

  async function measureLatency(server) {
    const samples = [];

    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      const response = await fetchWithTimeout(pingUrl(server));
      if (!response.ok) throw new Error(`Latency check failed (${response.status}).`);

      await response.arrayBuffer();
      samples.push(performance.now() - started);
    }

    // Drop the first sample: it includes the fresh connection setup.
    const useful = samples.slice(1);
    const ping = useful.reduce((sum, value) => sum + value, 0) / useful.length;
    const jitter = useful.slice(1).reduce((sum, value, index) => sum + Math.abs(value - useful[index]), 0) / (useful.length - 1);

    return { ping, jitter, edge: serverLabel(server) };
  }

  async function measureDownload(server) {
    const started = performance.now();
    const end = started + TEST_SECONDS * 1000;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), TEST_SECONDS * 1000 + 150);
    let bytes = 0;
    let lastTime = started;
    let lastBytes = 0;
    let failure = null;

    const timer = setInterval(() => {
      const now = performance.now();
      const instant = (bytes - lastBytes) * 8 / ((now - lastTime) / 1000) / 1e6;
      lastTime = now;
      lastBytes = bytes;
      if (Number.isFinite(instant)) {
        setMetric('Download', formatMbps(instant), 'Mbps');
        setGauge(instant, `${formatMbps(instant)} megabits per second`);
      }
    }, 180);

    const worker = async () => {
      try {
        while (performance.now() < end) {
          const response = await fetch(downloadUrl(server), {
            cache: 'no-store',
            signal: controller.signal
          });
          if (!response.ok) throw new Error(`Download failed (${response.status}).`);
          if (!response.body) throw new Error('Download stream is not available in this browser.');

          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (performance.now() >= end) {
              controller.abort();
              return;
            }
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') failure = failure || error;
      }
    };

    await Promise.all(Array.from({ length: 4 }, worker));
    clearTimeout(deadline);
    clearInterval(timer);
    controller.abort();
    if (failure) throw failure;

    const seconds = Math.max(0.1, Math.min(TEST_SECONDS, (performance.now() - started) / 1000));
    return bytes * 8 / seconds / 1e6;
  }

  function randomBlob(size) {
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 65536) {
      crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, size)));
    }
    return new Blob([bytes], { type: 'application/octet-stream' });
  }

  function uploadOnce(url, blob, controller, onBytes) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let sent = 0;

      xhr.open('POST', url, true);
      xhr.timeout = 20000;
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = event => {
        const delta = event.loaded - sent;
        sent = event.loaded;
        if (delta > 0) onBytes(delta);
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (sent < blob.size) onBytes(blob.size - sent);
          resolve();
        } else {
          reject(new Error(`Upload failed (${xhr.status}).`));
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed. The network may block large requests.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out.'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      controller.signal.addEventListener('abort', () => xhr.abort(), { once: true });

      xhr.send(blob);
    });
  }

  async function measureUpload(server) {
    const started = performance.now();
    const end = started + TEST_SECONDS * 1000;
    const controller = new AbortController();
    const blob = randomBlob(UP_CHUNK);
    const deadline = setTimeout(() => controller.abort(), TEST_SECONDS * 1000);
    const url = uploadUrl(server);
    let bytes = 0;
    let lastTime = started;
    let lastBytes = 0;
    let failure = null;

    const addBytes = delta => {
      bytes += delta;
    };

    const timer = setInterval(() => {
      const now = performance.now();
      const instant = (bytes - lastBytes) * 8 / ((now - lastTime) / 1000) / 1e6;
      lastTime = now;
      lastBytes = bytes;
      if (Number.isFinite(instant)) {
        setMetric('Upload', formatMbps(instant), 'Mbps');
        setGauge(instant, `${formatMbps(instant)} megabits per second`);
      }
    }, 180);

    const worker = async () => {
      while (performance.now() < end) {
        try {
          await uploadOnce(url, blob, controller, addBytes);
        } catch (error) {
          if (error.name === 'AbortError') return;
          failure = failure || error;
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: 3 }, worker));
    clearTimeout(deadline);
    clearInterval(timer);
    controller.abort();
    if (failure) throw failure;

    const seconds = Math.max(0.1, Math.min(TEST_SECONDS, (performance.now() - started) / 1000));
    return bytes * 8 / seconds / 1e6;
  }

  async function runTest() {
    if (busy) return;
    if (navigator.onLine === false) {
      setStatus('Offline', 'error');
      el.phase.textContent = 'You appear to be offline';
      el.message.textContent = 'Reconnect, then try again.';
      return;
    }

    busy = true;
    el.start.disabled = true;
    el.serverSelect.disabled = true;
    el.start.textContent = 'Testing';
    el.hint.textContent = 'Keep this tab open';
    setStatus('Testing', 'running');
    resetReadout();

    const started = performance.now();
    let server = getServer(el.serverSelect.value);

    try {
      if (server.kind === 'auto') {
        el.phase.textContent = 'Finding nearest server';
        server = await resolveServer();
        el.serverLabel.textContent = serverLabel(server);
      }

      el.phase.textContent = 'Checking latency';
      setMetric('Ping', '—', 'ms');
      setGauge(0, 'Checking latency');

      const latency = await measureLatency(server);
      el.ping.textContent = `${formatMs(latency.ping)} ms`;
      el.jitter.textContent = `${formatJitter(latency.jitter)} ms`;
      el.serverLabel.textContent = latency.edge;

      el.phase.textContent = 'Measuring download';
      const download = await measureDownload(server);
      el.download.textContent = `${formatMbps(download)} Mbps`;
      setMetric('Download', formatMbps(download), 'Mbps');
      setGauge(download, `${formatMbps(download)} megabits per second`);

      el.phase.textContent = 'Measuring upload';
      setMetric('Upload', '0.0', 'Mbps');
      const upload = await measureUpload(server);
      el.upload.textContent = `${formatMbps(upload)} Mbps`;

      setMetric('Download', formatMbps(download), 'Mbps');
      setGauge(download, `${formatMbps(download)} megabits per second`);
      el.phase.textContent = 'Test complete';
      setStatus('Complete', 'complete');
      el.hint.textContent = `Done in ${Math.max(1, Math.round((performance.now() - started) / 1000))}s`;
      el.message.textContent = 'Results vary by network, server distance and device.';
    } catch (error) {
      setStatus('Connection issue', 'error');
      el.phase.textContent = 'Could not complete the test';
      el.hint.textContent = 'Try again when online';
      el.message.textContent = error && error.message ? error.message : 'The speed test could not reach the server.';
      setGauge(0, 'Test stopped');
    } finally {
      busy = false;
      el.start.disabled = false;
      el.serverSelect.disabled = false;
      el.start.textContent = 'Test again';
    }
  }

  function addCustomServer(event) {
    event.preventDefault();

    let parsed;
    try {
      parsed = new URL(el.customUrl.value.trim());
    } catch {
      el.serverNote.textContent = 'Enter a full URL, including https://.';
      el.customUrl.focus();
      return;
    }

    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
      el.serverNote.textContent = 'Use an HTTPS URL for a public server.';
      el.customUrl.focus();
      return;
    }

    parsed.search = '';
    parsed.hash = '';
    let base = parsed.href.replace(/\/+$/, '');
    base = base.replace(/\/(?:garbage|empty)\.php$/i, '');
    const name = el.customName.value.trim() || 'Custom server';
    const server = {
      id: `custom-${++customCount}`,
      label: `${name} — LibreSpeed`,
      kind: 'librespeed',
      provider: 'LibreSpeed',
      city: name,
      base
    };

    servers.push(server);
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = server.label;
    el.serverSelect.append(option);
    el.serverSelect.value = server.id;
    el.customForm.reset();
    el.serverNote.textContent = 'Custom server added for this tab. It must expose garbage.php and empty.php with CORS.';
    setStatus('Ready', 'idle');
    el.hint.textContent = 'About 15 seconds';
    resetReadout();
  }

  el.start.addEventListener('click', runTest);
  el.customForm.addEventListener('submit', addCustomServer);

  el.serverSelect.addEventListener('change', () => {
    el.serverNote.textContent = SERVER_NOTE;
    setStatus('Ready', 'idle');
    el.hint.textContent = 'About 15 seconds';
    resetReadout();
  });

  window.addEventListener('offline', () => {
    if (!busy) {
      setStatus('Offline', 'error');
      el.phase.textContent = 'You appear to be offline';
    }
  });

  window.addEventListener('online', () => {
    if (!busy) setStatus('Ready', 'idle');
  });
})();
