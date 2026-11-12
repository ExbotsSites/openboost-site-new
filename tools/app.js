(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const tabs = [...document.querySelectorAll('.tool-tab')];
  const panels = [...document.querySelectorAll('.tool-panel')];
  const tablist = document.querySelector('.tool-nav');

  function setStatus(id, text, tone = '') {
    const el = $(id);
    el.textContent = text;
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function activateTool(tool, moveFocus = false) {
    tabs.forEach(tab => {
      const selected = tab.dataset.tool === tool;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });

    panels.forEach(panel => {
      panel.hidden = panel.id !== `panel-${tool}`;
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTool(tab.dataset.tool));
  });

  tablist.addEventListener('keydown', event => {
    const current = event.target.closest('.tool-tab');
    if (!current) return;

    const index = tabs.indexOf(current);
    let nextIndex = index;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    activateTool(tabs[nextIndex].dataset.tool, true);
  });

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

  document.querySelectorAll('[data-copy]').forEach(button => {
    const original = button.textContent;
    let restoreTimer;

    button.addEventListener('click', async () => {
      const target = $(button.dataset.copy);
      if (!target) return;

      const text = 'value' in target ? target.value : target.textContent;
      if (!text.trim()) {
        button.textContent = 'Nothing to copy';
      } else {
        try {
          await copyText(text);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Copy failed';
        }
      }

      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        button.textContent = original;
      }, 1400);
    });
  });

  function jsonParse(raw) {
    try {
      return { value: JSON.parse(raw) };
    } catch (error) {
      return { error };
    }
  }

  $('json-format').addEventListener('click', () => {
    const input = $('json-input');
    const raw = input.value.trim();
    if (!raw) {
      setStatus('json-status', 'Paste JSON first.', 'error');
      input.focus();
      return;
    }

    const result = jsonParse(raw);
    if (result.error) {
      setStatus('json-status', `Invalid JSON. ${result.error.message}`, 'error');
      return;
    }

    input.value = JSON.stringify(result.value, null, 2);
    setStatus('json-status', 'Valid JSON. Formatted with two-space indentation.', 'good');
  });

  $('json-minify').addEventListener('click', () => {
    const input = $('json-input');
    const raw = input.value.trim();
    if (!raw) {
      setStatus('json-status', 'Paste JSON first.', 'error');
      input.focus();
      return;
    }

    const result = jsonParse(raw);
    if (result.error) {
      setStatus('json-status', `Invalid JSON. ${result.error.message}`, 'error');
      return;
    }

    input.value = JSON.stringify(result.value);
    setStatus('json-status', 'Valid JSON. Minified.', 'good');
  });

  $('json-sample').addEventListener('click', () => {
    $('json-input').value = JSON.stringify({
      name: 'Axyy',
      tools: ['json', 'base64', 'url', 'hash', 'time'],
      local: true,
      nested: { ok: true }
    }, null, 2);
    setStatus('json-status', 'Sample loaded.', 'good');
  });

  $('json-clear').addEventListener('click', () => {
    $('json-input').value = '';
    setStatus('json-status', 'Ready.');
    $('json-input').focus();
  });

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64(text) {
    const normalized = text
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/=+$/, '');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  $('base64-run').addEventListener('click', () => {
    const input = $('base64-input');
    const output = $('base64-output');
    const mode = $('base64-mode').value;

    if (!input.value.trim()) {
      setStatus('base64-status', 'Paste a value first.', 'error');
      input.focus();
      return;
    }

    try {
      output.value = mode === 'encode'
        ? encodeBase64(input.value)
        : decodeBase64(input.value);
      setStatus('base64-status', mode === 'encode' ? 'Encoded as UTF-8 Base64.' : 'Decoded as UTF-8 text.', 'good');
    } catch {
      output.value = '';
      setStatus('base64-status', 'That is not valid Base64.', 'error');
    }
  });

  $('base64-swap').addEventListener('click', () => {
    const input = $('base64-input');
    const output = $('base64-output');
    if (!output.value) {
      setStatus('base64-status', 'Run the tool first, then swap.', 'error');
      return;
    }

    input.value = output.value;
    output.value = '';
    $('base64-mode').value = $('base64-mode').value === 'encode' ? 'decode' : 'encode';
    setStatus('base64-status', 'Output moved to input; mode reversed.', 'good');
    input.focus();
  });

  $('base64-clear').addEventListener('click', () => {
    $('base64-input').value = '';
    $('base64-output').value = '';
    setStatus('base64-status', 'Ready.');
    $('base64-input').focus();
  });

  $('url-run').addEventListener('click', () => {
    const input = $('url-input');
    const output = $('url-output');
    const mode = $('url-mode').value;

    if (!input.value.trim()) {
      setStatus('url-status', 'Paste a value first.', 'error');
      input.focus();
      return;
    }

    try {
      output.value = mode === 'encode'
        ? encodeURIComponent(input.value)
        : decodeURIComponent(input.value);
      setStatus('url-status', mode === 'encode' ? 'Encoded as a URL component.' : 'Decoded successfully.', 'good');
    } catch {
      output.value = '';
      setStatus('url-status', 'That contains an invalid percent escape.', 'error');
    }
  });

  $('url-clear').addEventListener('click', () => {
    $('url-input').value = '';
    $('url-output').value = '';
    setStatus('url-status', 'Ready.');
    $('url-input').focus();
  });

  function toHex(buffer) {
    return [...new Uint8Array(buffer)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  $('hash-run').addEventListener('click', async () => {
    const input = $('hash-input');
    const output = $('hash-output');
    const button = $('hash-run');
    const algorithm = $('hash-algorithm').value;

    if (!window.crypto || !window.crypto.subtle) {
      setStatus('hash-status', 'Web Crypto is not available in this browser.', 'error');
      return;
    }

    button.disabled = true;
    setStatus('hash-status', `Hashing with ${algorithm}…`);
    try {
      const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input.value));
      output.value = toHex(digest);
      setStatus('hash-status', `${algorithm} digest ready.`, 'good');
    } catch {
      output.value = '';
      setStatus('hash-status', 'The digest could not be created.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('hash-clear').addEventListener('click', () => {
    $('hash-input').value = '';
    $('hash-output').value = '';
    setStatus('hash-status', 'Ready.');
    $('hash-input').focus();
  });

  function parseTimestamp(value) {
    const text = value.trim();
    if (!text) return null;

    if (/^-?\d+(?:\.\d+)?$/.test(text)) {
      const number = Number(text);
      if (!Number.isFinite(number)) return null;
      const milliseconds = Math.abs(number) < 1e11 ? number * 1000 : number;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function renderTimestamp() {
    const input = $('time-input');
    const output = $('time-output');
    const date = parseTimestamp(input.value);

    if (!date) {
      output.textContent = 'That value is not a valid timestamp or date.';
      setStatus('time-status', 'Try Unix seconds, milliseconds, or an ISO date.', 'error');
      return;
    }

    const unixSeconds = Math.floor(date.getTime() / 1000);
    const unixMilliseconds = date.getTime();
    const local = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'long'
    }).format(date);

    output.textContent = [
      `Unix seconds      ${unixSeconds}`,
      `Unix milliseconds ${unixMilliseconds}`,
      `ISO 8601          ${date.toISOString()}`,
      `Local             ${local}`
    ].join('\n');
    setStatus('time-status', 'Converted.', 'good');
  }

  $('time-convert').addEventListener('click', renderTimestamp);
  $('time-now').addEventListener('click', () => {
    $('time-input').value = String(Math.floor(Date.now() / 1000));
    renderTimestamp();
  });

  $('time-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      renderTimestamp();
    }
  });

  activateTool('json');
})();
