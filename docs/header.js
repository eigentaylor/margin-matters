// Dynamically load and inject the site header
(function () {
  function createHeader(isInner = false) {
    const prefix = isInner ? '..' : '.';

    const headerHTML = `
      <div class="card site-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px">
        <button class="header-toggle" id="headerToggle" aria-label="Toggle navigation menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <div class="small-links" id="headerNav">
          <a class="btn" href="${prefix}/index.html">Home</a>
          <a class="btn" href="${prefix}/state-pages.html">State Pages</a>
          <a class="btn" href="${prefix}/paths2028.html">2028 Paths</a>
          <a class="btn" href="${prefix}/sim2028.html">2028 Simulator</a>
          <a class="btn" href="${prefix}/ranker.html">Ranker</a>
          <a class="btn" href="${prefix}/trending-states.html">Trending States</a>
          <a class="btn" href="${prefix}/pca.html">PCA Explorer</a>
          <a class="btn" href="${prefix}/trend-viewer.html">Trend Viewer</a>
          <a class="btn" href="${prefix}/bellwether-explorer.html">Bellwethers</a>
          <a class="btn" href="${prefix}/histograms.html">Histograms</a>
          <a class="btn" href="${prefix}/shift-vectors.html">Shift Vectors</a>
          <a class="btn" href="${prefix}/census.html">Census</a>
          <a class="btn" href="${prefix}/laplace.html">Laplace Rule</a>
          <a class="btn" href="${prefix}/keys.html">13 Keys</a>
          <a class="btn" href="${prefix}/future.html">"""Future"""</a>
          <a class="btn" href="${prefix}/methods.html">Methods</a>
          <a class="btn" href="${prefix}/changelog.html">Changelog</a>
          <a class="btn" href="${prefix}/presidential_margins.html">Data (CSV)</a>
          <a class="btn" href="${prefix}/attributions.html">Attributions</a>
        </div>
      </div>
    `;
    const title_div_HTML = `
      <div style="text-align:center;margin-top:16px;margin-bottom:8px">
        <h1 style="margin:0;font-size:1.5em">Margin Matters</h1>
      </div>
    `;

    return headerHTML + title_div_HTML;
  }

  function injectHeader() {
    // Find the placeholder element
    const placeholder = document.getElementById('header-placeholder');
    if (!placeholder) {
      console.warn('Header placeholder not found');
      return;
    }

    // Determine if this is an inner page (in a subdirectory)
    const isInner = placeholder.getAttribute('data-is-inner') === 'true';

    // Inject the header
    placeholder.innerHTML = createHeader(isInner);

    // Load the header toggle script
    const script = document.createElement('script');
    script.src = isInner ? '../header-toggle.js' : './header-toggle.js';
    placeholder.appendChild(script);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHeader);
  } else {
    injectHeader();
  }
})();
