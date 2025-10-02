// Dynamically load and inject the site footer
(function() {
  function createFooter(extraNote = '') {
    const extraText = extraNote ? extraNote + ' ' : '';
    
    const footerHTML = `
      <footer>
        Site by eigentaylor.<br />
        Please report any inaccuracies to me through discord: eigentaylor.<br />
        Data (possibly incorrectly scraped) from <a href='https://en.wikipedia.org/' target='_blank' rel='noopener noreferrer'>Wikipedia</a>.<br />
        Available under the Creative Commons Attribution-ShareAlike License (CC BY-SA 4.0). ${extraText}<span data-last-updated>Last updated: ...</span>
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
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFooter);
  } else {
    injectFooter();
  }
})();
