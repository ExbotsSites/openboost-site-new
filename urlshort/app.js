(() => {
  'use strict';

  const API_URL = '/api/links';
  const ADMIN_STORAGE_KEY = 'axy-shortener-admin';
  const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
  const RESERVED_SLUGS = new Set();

  const form = document.getElementById('shorten-form');
  const destination = document.getElementById('destination');
  const slug = document.getElementById('slug');
  const customWrap = document.getElementById('custom-wrap');
  const adminKey = document.getElementById('admin-key');
  const submitButton = document.getElementById('submit-button');
  const submitLabel = document.getElementById('submit-label');
  const status = document.getElementById('form-status');
  const resultCard = document.getElementById('result-card');
  const resultEmpty = document.getElementById('result-empty');
  const resultBody = document.getElementById('result-body');
  const shortUrl = document.getElementById('short-url');
  const resultDestination = document.getElementById('result-destination');
  const copyButton = document.getElementById('copy-button');
  const openLink = document.getElementById('open-link');
  const modeOptions = Array.from(document.querySelectorAll('.mode-option'));

  function getMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : 'random';
  }

  function setStatus(message, tone) {
    status.textContent = message;
    status.classList.toggle('is-error', tone === 'error');
    status.classList.toggle('is-success', tone === 'success');
  }

  function updateMode() {
    const mode = getMode();
    const custom = mode === 'custom';

    customWrap.hidden = !custom;
    slug.required = custom;
    slug.disabled = !custom;

    modeOptions.forEach((option) => {
      const input = option.querySelector('input');
      option.classList.toggle('is-selected', Boolean(input && input.checked));
    });

    if (custom) slug.focus();
  }

  function validDestination(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function validSlug(value) {
    return SLUG_PATTERN.test(value) && !RESERVED_SLUGS.has(value);
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.setAttribute('aria-busy', String(loading));
    submitLabel.textContent = loading ? 'Creating…' : 'Create short link';
  }

  function showResult(data) {
    const link = data.shortUrl || `${window.location.origin}/s/${data.slug}`;
    resultEmpty.hidden = true;
    resultBody.hidden = false;
    shortUrl.href = link;
    shortUrl.textContent = link.replace(/^https?:\/\//, '');
    resultDestination.textContent = `Opens to ${data.url}`;
    openLink.href = link;
    resultCard.classList.add('has-result');
    copyButton.textContent = 'Copy link';
    copyButton.disabled = false;
  }

  async function copyLink() {
    const text = shortUrl.href;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copied';
      window.setTimeout(() => {
        copyButton.textContent = 'Copy link';
      }, 1800);
    } catch {
      setStatus('Copy failed. Select the short link and copy it manually.', 'error');
    }
  }

  modeOptions.forEach((option) => {
    const input = option.querySelector('input');
    if (input) input.addEventListener('change', updateMode);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const url = destination.value.trim();
    const mode = getMode();
    const key = adminKey.value.trim();
    let customSlug = slug.value.trim().toLowerCase();

    if (!validDestination(url)) {
      setStatus('Enter a full http or https URL.', 'error');
      destination.focus();
      return;
    }

    if (!key) {
      setStatus('Enter your admin key.', 'error');
      adminKey.focus();
      return;
    }

    if (mode === 'custom') {
      if (!validSlug(customSlug)) {
        setStatus('Use 2–32 lowercase letters, numbers or hyphens.', 'error');
        slug.focus();
        return;
      }
      slug.value = customSlug;
    }

    setLoading(true);
    setStatus('Creating your short link…');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          url,
          mode,
          slug: mode === 'custom' ? customSlug : undefined
        })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('That admin key is not valid.');
        }
        if (response.status === 503) {
          throw new Error('The shortener is not configured on the server yet.');
        }
        if (response.status === 409) {
          throw new Error('That custom code is already taken. Pick another.');
        }
        throw new Error(data.error || 'Could not create the short link.');
      }

      window.sessionStorage.setItem(ADMIN_STORAGE_KEY, key);
      showResult(data);
      setStatus('Short link created.', 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create the short link.', 'error');
    } finally {
      setLoading(false);
    }
  });

  copyButton.addEventListener('click', copyLink);
  copyButton.disabled = true;

  try {
    const savedKey = window.sessionStorage.getItem(ADMIN_STORAGE_KEY);
    if (savedKey) adminKey.value = savedKey;
  } catch {
    // Session storage can be unavailable in strict browser modes.
  }

  updateMode();
})();
