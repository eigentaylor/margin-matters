'use strict';

// UI for the "Election Night Album" button on sim2028.html: opens a modal,
// runs election-night.js's headless generateElectionNightAlbum() (a full,
// silent replay of the whole night that captures each checkpoint slide plus
// a map/PV-badge snapshot as a PNG - see that function's own comment for the
// pipeline), then renders the results as a grid of thumbnails, each with a
// "Copy" button (so the images can be pasted one at a time into e.g. a
// Discord message, which is the whole point) and a "Download" button.
//
// Self-contained, self-inits on DOMContentLoaded - same shape as
// evBreakdownModal.js.

let listenersBound = false;
let prepPollId = null;
let clipboardSupported = false;

try {
  clipboardSupported = !!(navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem === 'function');
} catch (e) { clipboardSupported = false; }

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

async function copyImageToClipboard(dataUrl, btn) {
  const original = btn.textContent;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    btn.textContent = 'Copied!';
  } catch (e) {
    console.warn('Election night album: copy failed', e);
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
}

function downloadImage(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderAlbumGrid(grid, images) {
  grid.innerHTML = '';
  images.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'en-album-item';

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = item.caption || `Election night image ${index + 1}`;
    card.appendChild(img);

    const caption = document.createElement('div');
    caption.className = 'en-album-caption';
    caption.textContent = item.caption || '';
    card.appendChild(caption);

    const actions = document.createElement('div');
    actions.className = 'en-album-actions';

    if (clipboardSupported) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyImageToClipboard(item.dataUrl, copyBtn));
      actions.appendChild(copyBtn);
    }

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => downloadImage(item.dataUrl, `en-album-${index + 1}-${slugify(item.caption)}.png`));
    actions.appendChild(downloadBtn);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

async function runAlbumGeneration(albumBtn, statusEl, gridEl) {
  gridEl.innerHTML = '';
  statusEl.textContent = 'Generating…';
  albumBtn.disabled = true;

  try {
    if (typeof window.generateElectionNightAlbum !== 'function') {
      statusEl.textContent = 'Election night album isn’t available on this page.';
      return;
    }
    const images = await window.generateElectionNightAlbum(({ index, total }) => {
      statusEl.textContent = `Generating… checkpoint ${index} of ${total}`;
    });
    if (!images) {
      statusEl.textContent = 'Go to election night before generating an album.';
      return;
    }
    if (!images.length) {
      statusEl.textContent = 'Nothing to show yet - no calls in this run.';
      return;
    }
    statusEl.textContent = `${images.length} image${images.length === 1 ? '' : 's'} — click Copy to paste one into Discord, or Download to save it.`;
    renderAlbumGrid(gridEl, images);
  } catch (e) {
    console.error('Election night album generation failed', e);
    statusEl.textContent = 'Something went wrong generating the album.';
  } finally {
    albumBtn.disabled = !(typeof window.isElectionNightPrepared === 'function' && window.isElectionNightPrepared());
  }
}

function startPreparedPolling(albumBtn) {
  if (prepPollId != null) return;
  const check = () => {
    const prepared = typeof window.isElectionNightPrepared === 'function' && window.isElectionNightPrepared();
    // Never re-enable out from under an in-flight generation (which also
    // disables the button itself) - state.generatingAlbum already guards
    // re-entrancy on the election-night.js side, this just keeps the button
    // visually consistent with it.
    if (!albumBtn.dataset.enGenerating) albumBtn.disabled = !prepared;
  };
  check();
  prepPollId = setInterval(check, 400);
}

export function initAlbumModal() {
  if (listenersBound) return;

  const albumBtn = document.getElementById('enAlbumBtn');
  const modal = document.getElementById('enAlbumModal');
  const closeBtn = document.getElementById('enAlbumClose');
  const statusEl = document.getElementById('enAlbumStatus');
  const gridEl = document.getElementById('enAlbumGrid');

  if (!albumBtn || !modal || !statusEl || !gridEl) return;
  listenersBound = true;

  startPreparedPolling(albumBtn);

  albumBtn.addEventListener('click', async () => {
    if (albumBtn.disabled) return;
    modal.style.display = 'flex';
    albumBtn.dataset.enGenerating = '1';
    await runAlbumGeneration(albumBtn, statusEl, gridEl);
    delete albumBtn.dataset.enGenerating;
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') modal.style.display = 'none';
  });
}

function handleDomReady() {
  try { initAlbumModal(); } catch (e) { console.warn(e); }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleDomReady, { once: true });
  } else {
    handleDomReady();
  }
}
