(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Header gets one tone step after the first scroll, not glass or a shadow.
  const header = $('.site-header');
  if (header) {
    const setHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
    window.addEventListener('scroll', setHeader, { passive: true });
    setHeader();
  }

  // The mobile menu is a native details element, so it still works without this file.
  const menu = $('.mobile-menu');
  if (menu) {
    all('a', menu).forEach((link) => link.addEventListener('click', () => { menu.open = false; }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }

  // Copy the source commands, with a plain fallback for browsers without the async clipboard.
  const copyButton = $('#copy-code');
  const codeBlock = $('#code-block');
  const copyStatus = $('#copy-status');
  if (copyButton && codeBlock) {
    copyButton.addEventListener('click', async () => {
      const text = codeBlock.textContent;
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { copied = document.execCommand('copy'); } catch { copied = false; }
        area.remove();
      }
      if (copyStatus) copyStatus.textContent = copied ? 'Copied to the clipboard.' : 'Copy failed. Select the commands and copy them.';
      copyButton.textContent = copied ? 'Copied' : 'Copy';
      window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 2200);
    });
  }

  // Latest release, with a static fallback to the releases page.
  const REPO = 'ExbotsSites/OpenBoost';
  const latestRelease = `https://github.com/${REPO}/releases/latest`;
  const versionLabels = all('[data-version]');
  const setupLink = $('#dl-setup');
  const portableLink = $('#dl-portable');
  const setupLabel = $('#setup-label');
  const portableLabel = $('#portable-label');
  const releaseNote = $('#release-note');

  const useFallback = () => {
    versionLabels.forEach((node) => { node.textContent = 'latest'; });
    if (setupLink) setupLink.href = latestRelease;
    if (portableLink) portableLink.href = latestRelease;
    if (releaseNote) releaseNote.textContent = 'Could not load the release list. Both buttons open the latest GitHub release; everything runs locally.';
  };

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('No release')))
    .then((release) => {
      const version = String(release.tag_name || '').replace(/^v/, '') || 'latest';
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const setup = assets.find((asset) => /-setup\.exe$/i.test(asset.name)) || assets.find((asset) => /setup.*\.exe$/i.test(asset.name));
      const portable = assets.find((asset) => /-portable\.exe$/i.test(asset.name)) || assets.find((asset) => /\.exe$/i.test(asset.name) && asset !== setup);

      versionLabels.forEach((node) => { node.textContent = `v${version}`; });
      if (setup && setupLink) {
        setupLink.href = setup.browser_download_url;
        if (setupLabel) setupLabel.textContent = `Download installer v${version}`;
      }
      if (portable && portableLink) {
        portableLink.href = portable.browser_download_url;
        if (portableLabel) portableLabel.textContent = `Download portable v${version}`;
      }
      if (releaseNote) releaseNote.textContent = `Latest release: v${version}. Builds are unsigned; check the SHA-256 on the release page. The download runs locally.`;
    })
    .catch(useFallback);

  // The benchmark comparison is the one live thing on the page.
  const compare = $('[data-compare]');
  if (compare) {
    const range = $('#compare-range');
    const rows = all('.metric', compare);
    let auto = !reduceMotion.matches;

    const format = (value, decimals) => Number(value).toFixed(decimals);

    const update = (progress) => {
      const t = Math.max(0, Math.min(1, progress));
      compare.style.setProperty('--t', t.toFixed(4));
      if (range) {
        range.value = String(Math.round(t * 100));
        range.setAttribute('aria-valuetext', t < 0.02 ? 'Before' : t > 0.98 ? 'After' : 'Comparing before and after');
      }

      for (const row of rows) {
        const before = parseFloat(row.dataset.before);
        const after = parseFloat(row.dataset.after);
        const decimals = Number(row.dataset.decimals) || 0;
        const max = Number(row.dataset.max) || Math.max(before, after);
        const value = before + ((after - before) * t);
        const now = $('[data-now]', row);
        const fill = $('.metric-track i', row);
        const delta = $('[data-delta]', row);

        if (now) now.textContent = format(value, decimals);
        if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, value / max)).toFixed(4)})`;
        if (!delta) continue;

        if (t < 0.02) {
          delta.textContent = 'Baseline';
          delta.className = 'metric-delta';
          continue;
        }

        const pct = ((after - before) / Math.abs(before)) * 100;
        const better = row.dataset.good === 'up' ? after >= before : after <= before;
        if (Math.abs(pct) < 0.5) {
          delta.textContent = 'No change';
          delta.className = 'metric-delta';
        } else {
          delta.textContent = `${Math.abs(pct).toFixed(1)}% ${better ? 'faster' : 'slower'}`;
          delta.className = `metric-delta ${better ? 'is-good' : 'is-worse'}`;
        }
      }
    };

    update(0);

    if (range) {
      range.addEventListener('input', () => {
        auto = false;
        update(Number(range.value) / 100);
      });
    }

    if (reduceMotion.matches) {
      update(1);
    } else if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (!auto) return;
        const start = performance.now();
        const duration = 1500;
        const step = (now) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          update(eased);
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, { threshold: 0.35 });
      observer.observe(compare);
    } else {
      update(1);
    }
  }

  // Section reveals happen only when the observer can actually finish them.
  const revealElements = all('[data-reveal]');
  all('[data-stagger]').forEach((parent) => {
    [...parent.children].forEach((child, index) => child.style.setProperty('--i', index));
  });

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-in'));
  } else {
    document.documentElement.classList.add('reveal-ready');
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    revealElements.forEach((element) => revealObserver.observe(element));
  }
})();
