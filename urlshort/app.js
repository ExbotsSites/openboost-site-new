(() => {
  'use strict';

  const API_URL = '/api/links';
  const form = document.getElementById('shorten-form');
  const destination = document.getElementById('destination');
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

  function setStatus(message, tone) {
    status.textContent = message;
    status.classList.toggle('is-error', tone === 'error');
    status.classList.toggle('is-success', tone === 'success');
  }

  function validDestination(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.setAttribute('aria-busy', String(loading));
    submitLabel.textContent = loading ? 'Creating…' : 'Create short link';
  }

  function getTurnstileToken() {
    const field = form.querySelector('[name="cf-turnstile-response"]');
    return field ? field.value : '';
  }

  function resetTurnstile() {
    if (window.turnstile) {
      try {
        window.turnstile.reset();
      } catch {
        // ignore
      }
    }
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const url = destination.value.trim();
    if (!validDestination(url)) {
      setStatus('Enter a full http or https URL.', 'error');
      destination.focus();
      return;
    }

    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      setStatus('Complete the captcha first.', 'error');
      return;
    }

    setLoading(true);
    setStatus('Creating your short link…');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, turnstileToken })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (response.status === 503) {
          throw new Error('The shortener is not configured on the server yet.');
        }
        if (response.status === 429) {
          throw new Error('Too many links created. Try again in a minute.');
        }
        throw new Error(data.error || 'Could not create the short link.');
      }

      showResult(data);
      setStatus('Short link created.', 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create the short link.', 'error');
    } finally {
      setLoading(false);
      resetTurnstile();
    }
  });

  copyButton.addEventListener('click', copyLink);
  copyButton.disabled = true;
})();
