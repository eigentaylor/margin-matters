// Dynamically load and inject the site footer
(function () {
  function createFooter(extraNote = '') {
    const extraText = extraNote ? extraNote + ' ' : '';

    const footerHTML = `
      <footer class="center">
        Site by eigentaylor.<br />
        Please report any inaccuracies to me through discord: @eigentaylor.<br />
        Data (possibly incorrectly scraped) from <a href='https://en.wikipedia.org/' target='_blank' rel='noopener noreferrer'>Wikipedia</a>.<br />
        Available under the Creative Commons Attribution-ShareAlike License (CC BY-SA 4.0). ${extraText}<br /><span data-last-updated>Last updated: ...</span><br />
      </footer>
    `;

    return footerHTML;
  }

  function injectFooter() {
    // Find the placeholder element
    const placeholder = document.getElementById('footer-placeholder');
    if (!placeholder) {
      console.warn('Footer placeholder not found');
      return;
    }

    // Check if there's a data attribute for extra notes
    const extraNote = placeholder.getAttribute('data-extra-note') || '';

    // Inject the footer
    placeholder.innerHTML = createFooter(extraNote);

    // Populate [data-last-updated] — last-updated.js may have already run before
    // this element existed, so check the global it stores and fall back to polling.
    const luEl = placeholder.querySelector('[data-last-updated]');
    if (luEl) {
      if (typeof window._lastUpdatedTimestamp === 'string') {
        luEl.textContent = 'Last updated: ' + window._lastUpdatedTimestamp;
      } else {
        let tries = 0;
        const timer = setInterval(function () {
          tries++;
          if (typeof window._lastUpdatedTimestamp === 'string') {
            luEl.textContent = 'Last updated: ' + window._lastUpdatedTimestamp;
            clearInterval(timer);
          } else if (tries >= 20) {
            clearInterval(timer);
          }
        }, 250);
      }
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFooter);
  } else {
    injectFooter();
  }
})();
