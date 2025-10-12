// other-pages.js
// Adds a small dropdown on state and unit pages to quickly jump to another page.
(function(){
  const PAGES = [
    {abbr: 'AL', name: 'Alabama'}, {abbr: 'AK', name: 'Alaska'}, {abbr: 'AZ', name: 'Arizona'}, {abbr: 'AR', name: 'Arkansas'}, {abbr: 'CA', name: 'California'},
    {abbr: 'CO', name: 'Colorado'}, {abbr: 'CT', name: 'Connecticut'}, {abbr: 'DC', name: 'District of Columbia'}, {abbr: 'DE', name: 'Delaware'}, {abbr: 'FL', name: 'Florida'}, {abbr: 'GA', name: 'Georgia'},
    {abbr: 'HI', name: 'Hawaii'}, {abbr: 'ID', name: 'Idaho'}, {abbr: 'IL', name: 'Illinois'}, {abbr: 'IN', name: 'Indiana'}, {abbr: 'IA', name: 'Iowa'}, {abbr: 'KS', name: 'Kansas'},
    {abbr: 'KY', name: 'Kentucky'}, {abbr: 'LA', name: 'Louisiana'}, {abbr: 'ME', name: 'Maine'}, {abbr: 'ME-01', name: "Maine's 1st Congressional District"}, {abbr: 'ME-02', name: "Maine's 2nd Congressional District"},
    {abbr: 'MD', name: 'Maryland'}, {abbr: 'MA', name: 'Massachusetts'}, {abbr: 'MI', name: 'Michigan'}, {abbr: 'MN', name: 'Minnesota'}, {abbr: 'MS', name: 'Mississippi'}, {abbr: 'MO', name: 'Missouri'},
    {abbr: 'MT', name: 'Montana'}, {abbr: 'NE', name: 'Nebraska'}, {abbr: 'NE-01', name: "Nebraska's 1st Congressional District"}, {abbr: 'NE-02', name: "Nebraska's 2nd Congressional District"}, {abbr: 'NE-03', name: "Nebraska's 3rd-Congressional District"},
    {abbr: 'NV', name: 'Nevada'}, {abbr: 'NH', name: 'New Hampshire'}, {abbr: 'NJ', name: 'New Jersey'}, {abbr: 'NM', name: 'New Mexico'}, {abbr: 'NY', name: 'New York'}, {abbr: 'NC', name: 'North Carolina'}, {abbr: 'ND', name: 'North Dakota'},
    {abbr: 'OH', name: 'Ohio'}, {abbr: 'OK', name: 'Oklahoma'}, {abbr: 'OR', name: 'Oregon'}, {abbr: 'PA', name: 'Pennsylvania'}, {abbr: 'RI', name: 'Rhode Island'}, {abbr: 'SC', name: 'South Carolina'},
    {abbr: 'SD', name: 'South Dakota'}, {abbr: 'TN', name: 'Tennessee'}, {abbr: 'TX', name: 'Texas'}, {abbr: 'UT', name: 'Utah'}, {abbr: 'VT', name: 'Vermont'}, {abbr: 'VA', name: 'Virginia'},
    {abbr: 'WA', name: 'Washington'}, {abbr: 'WV', name: 'West Virginia'}, {abbr: 'WI', name: 'Wisconsin'}, {abbr: 'WY', name: 'Wyoming'},
    {abbr: 'NAT', name: 'National'}
  ];

  function createDropDown() {
    // Only run on state/unit pages where the relative paths work
    try {
  const container = document.createElement('div');
  container.id = 'other-pages-container';
  container.setAttribute('aria-hidden', 'false');
  // base desktop style (may be overridden for mobile)
  container.style.position = 'fixed';
  container.style.right = '16px';
  container.style.bottom = '16px';
  // sit above most site chrome but below modal-ish elements
  container.style.zIndex = '99999';
  container.style.background = 'rgba(10,10,10,0.9)';
  container.style.color = 'white';
  container.style.border = '1px solid rgba(255,255,255,0.06)';
  container.style.padding = '8px';
  container.style.borderRadius = '10px';
  container.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
  container.style.fontSize = '0.9rem';
  container.style.backdropFilter = 'blur(4px)';

  const label = document.createElement('label');
  label.style.display = 'block';
  label.style.marginBottom = '6px';
  label.style.fontSize = '0.85rem';
  label.textContent = 'Jump to page:';

      const select = document.createElement('select');
  select.id = 'other-pages-select';
  select.style.minWidth = '180px';
  select.style.padding = '6px';
  select.style.borderRadius = '6px';
  select.style.border = 'none';
  select.style.background = '#fff';
  select.style.color = '#000';

      // sort alphabetically by name
      const sorted = PAGES.slice().sort((a,b)=> a.name.localeCompare(b.name));
      sorted.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.abbr;
        opt.textContent = `${p.name} (${p.abbr})`;
        select.appendChild(opt);
      });

  const go = document.createElement('button');
  go.textContent = 'Go';
  go.className = 'btn';
  go.style.marginLeft = '8px';
  go.style.padding = '6px 10px';
  go.style.borderRadius = '6px';

      const form = document.createElement('div');
      form.style.display = 'flex';
      form.style.alignItems = 'center';

      form.appendChild(select);
      form.appendChild(go);
      container.appendChild(label);
      container.appendChild(form);
      document.body.appendChild(container);

      // -------- Responsive / Mobile behavior --------
      // For small screens we show a compact floating button that toggles an
      // expanded bottom panel. This keeps the UI unobtrusive and touch-friendly.
      const MOBILE_BREAKPOINT = 720; // px
      let isMobileView = window.matchMedia && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
      let expanded = false;

      const mobileToggle = document.createElement('button');
      mobileToggle.id = 'other-pages-mobile-toggle';
      mobileToggle.setAttribute('aria-expanded', 'false');
      mobileToggle.title = 'Jump to another page';
      mobileToggle.style.position = 'fixed';
      mobileToggle.style.right = '14px';
      mobileToggle.style.bottom = '14px';
      mobileToggle.style.width = '44px';
      mobileToggle.style.height = '44px';
      mobileToggle.style.borderRadius = '50%';
      mobileToggle.style.background = 'rgba(10,10,10,0.95)';
      mobileToggle.style.border = '1px solid rgba(255,255,255,0.08)';
      mobileToggle.style.color = '#fff';
      mobileToggle.style.display = 'none';
      mobileToggle.style.alignItems = 'center';
      mobileToggle.style.justifyContent = 'center';
      mobileToggle.style.zIndex = '100000';
      mobileToggle.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
      mobileToggle.style.fontSize = '18px';
      mobileToggle.textContent = '⇄';
      mobileToggle.setAttribute('aria-label', 'Open page jump');
      document.body.appendChild(mobileToggle);

      function applyMobileStyles() {
        // mobile collapsed: hide desktop container, show round toggle
        container.style.right = '';
        container.style.left = '';
        container.style.bottom = '';
        container.style.width = '';
        container.style.borderRadius = '10px';
        container.style.padding = '8px';
        container.style.display = expanded ? 'block' : 'none';
        mobileToggle.style.display = 'flex';
      }

      function applyDesktopStyles() {
        container.style.display = 'block';
        container.style.right = '16px';
        container.style.bottom = '16px';
        container.style.left = '';
        container.style.width = '';
        container.style.borderRadius = '10px';
        container.style.padding = '8px';
        mobileToggle.style.display = 'none';
      }

      function showExpandedPanel() {
        expanded = true;
        mobileToggle.setAttribute('aria-expanded', 'true');
        // make container full-width along the bottom with larger touch targets
        container.style.display = 'block';
        container.style.left = '8px';
        container.style.right = '8px';
        container.style.bottom = '8px';
        container.style.width = 'auto';
        container.style.borderRadius = '12px';
        container.style.padding = '12px';
        container.style.boxSizing = 'border-box';
        container.style.backdropFilter = 'blur(6px)';
        // enlarge select and button for touch
        select.style.minWidth = '100%';
        select.style.padding = '12px';
        go.style.marginLeft = '0';
        go.style.display = 'block';
        go.style.width = '100%';
        go.style.marginTop = '10px';
        go.style.padding = '12px';
        adjustForFooter();
      }

      function hideExpandedPanel() {
        expanded = false;
        mobileToggle.setAttribute('aria-expanded', 'false');
        select.style.minWidth = '180px';
        select.style.padding = '6px';
        go.style.marginLeft = '8px';
        go.style.display = '';
        go.style.width = '';
        go.style.marginTop = '';
        go.style.padding = '6px 10px';
        applyMobileStyles();
        adjustForFooter();
      }

      mobileToggle.addEventListener('click', () => {
        if (!expanded) showExpandedPanel(); else hideExpandedPanel();
      });

      // Click outside to close on mobile
      document.addEventListener('click', (ev) => {
        if (!isMobileView) return;
        if (!expanded) return;
        const tgt = ev.target;
        if (!tgt) return;
        if (tgt === container || container.contains(tgt) || tgt === mobileToggle) return;
        hideExpandedPanel();
      });

      // Update layout when viewport changes
      function updateViewport(e) {
        isMobileView = window.matchMedia && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
        if (isMobileView) {
          applyMobileStyles();
          hideExpandedPanel();
        } else {
          applyDesktopStyles();
        }
      }
      window.addEventListener('orientationchange', updateViewport);
      window.addEventListener('resize', updateViewport);
      updateViewport();

      // helper: move the dropdown above any delta-toggle footer if present
      function adjustForFooter() {
        try {
          const footer = document.querySelector('.delta-toggle-footer');
          // read body padding-bottom in case the page reserves space for the footer
          const bodyPad = parseFloat(getComputedStyle(document.body).paddingBottom || '0') || 0;
          const gap = 24; // visual gap between dropdown and footer
          if (!footer) {
            const bottomOffset = Math.max(16, Math.ceil(bodyPad) + 8);
            container.style.bottom = `${bottomOffset}px`;
            return;
          }
          const rect = footer.getBoundingClientRect();
          // choose an offset large enough to clear either the footer element or the
          // body's reserved padding space (plus a small gap)
          const bottomOffset = Math.max(16, Math.ceil(rect.height) + gap, Math.ceil(bodyPad) + 8);
          container.style.bottom = `${bottomOffset}px`;
        } catch (e) {
          // ignore
        }
      }

      // Observe body for footer insertion (footer is dynamically appended)
      const mo = new MutationObserver((mutations) => {
        adjustForFooter();
      });
      mo.observe(document.body, { childList: true, subtree: true });

      // adjust on load and resize as well
      window.addEventListener('load', adjustForFooter);
      window.addEventListener('resize', adjustForFooter);

      // initial adjust
      adjustForFooter();

      function navigateTo(abbr) {
        if (!abbr) return;
        const up = String(abbr || '').toUpperCase();
        // National
        if (up === 'NAT' || up === 'NATIONAL') {
          window.location.href = '../state/NAT.html';
          return;
        }
        // 2-letter (or an -AL) -> state
        if (/^[A-Z]{2}$/.test(up) || /-AL$/.test(up)) {
          window.location.href = `../state/${up}.html`;
          return;
        }
        // otherwise assume unit
        window.location.href = `../unit/${abbr}.html`;
      }

      go.addEventListener('click', () => navigateTo(select.value));
      select.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') navigateTo(select.value); });
    } catch (err) {
      console.warn('other-pages failed', err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createDropDown);
  else createDropDown();
})();
