'use strict';

const globalObj = typeof window !== 'undefined' ? window : globalThis;

const DEFAULT_PARSER_KEY = Symbol('default-parser');
const cache = new Map();

function getCurrentScriptUrl() {
  if (typeof document === 'undefined') return null;
  if (document.currentScript && document.currentScript.src) return document.currentScript.src;
  const scripts = document.getElementsByTagName('script');
  if (!scripts || !scripts.length) return null;
  const last = scripts[scripts.length - 1];
  return last && last.src ? last.src : null;
}

function normalizeBase(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, url);
    const pieces = parsed.pathname.split('/');
    pieces.pop();
    parsed.pathname = `${pieces.join('/')}/`;
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  } catch (err) {
    const withoutQuery = url.split('#')[0].split('?')[0];
    return withoutQuery.replace(/[^/]*$/, '');
  }
}

function toAbsolute(path, base) {
  if (!path) return path;
  try {
    return new URL(path, base).href;
  } catch (err) {
    if (base && /^https?:/i.test(base)) {
      const b = base.endsWith('/') ? base : `${base}/`;
      return b + path.replace(/^\/+/, '');
    }
    return path;
  }
}

const scriptUrl = getCurrentScriptUrl();
const locationHref = (globalObj && globalObj.location && globalObj.location.href) ? globalObj.location.href : '';
const baseUrl = scriptUrl ? normalizeBase(scriptUrl) : normalizeBase(locationHref);

const defaultPresidentialPath = (() => {
  console.log('scriptUrl:', scriptUrl, 'baseUrl:', baseUrl);
  console.log('toAbsolute test (base):', toAbsolute('presidential_margins.csv', baseUrl));
  console.log('toAbsolute test (script):', toAbsolute('../presidential_margins.csv', scriptUrl));
  if (baseUrl) return toAbsolute('presidential_margins.csv', baseUrl);
  if (scriptUrl) return toAbsolute('../presidential_margins.csv', scriptUrl);
  return '/margin-matters/presidential_margins.csv';
})();

const defaultSenatePath = (() => {
  if (scriptUrl) return toAbsolute('../senate_margins.csv', scriptUrl);
  if (baseUrl) return toAbsolute('senate_margins.csv', baseUrl);
  return 'senate_margins.csv';
})();

function resolvePath(path, fallback) {
  if (!path) return fallback || defaultPresidentialPath;
  const base = scriptUrl || baseUrl || locationHref || undefined;
  return toAbsolute(path, base);
}

function getDefaultParser() {
  const d3 = globalObj && globalObj.d3;
  if (d3 && typeof d3.autoType === 'function') return d3.autoType;
  return undefined;
}

function ensureD3() {
  const d3 = globalObj && globalObj.d3;
  if (!d3 || typeof d3.csv !== 'function') {
    throw new Error('DataLoader requires d3.csv. Make sure D3 is loaded before utils/dataLoader.js');
  }
  return d3;
}

function loadCsv(path, options = {}) {
  const d3 = ensureD3();
  const parser = options.parser === undefined ? getDefaultParser() : options.parser;
  const parserKey = options.parser === undefined ? DEFAULT_PARSER_KEY : options.parser;
  const absPath = resolvePath(path, defaultPresidentialPath);

  let pathCache = cache.get(absPath);
  if (!pathCache) {
    pathCache = new Map();
    cache.set(absPath, pathCache);
  }

  if (!options.force && pathCache.has(parserKey)) {
    return pathCache.get(parserKey);
  }

  const promise = (parser ? d3.csv(absPath, parser) : d3.csv(absPath))
    .then(rows => {
      if (!Array.isArray(rows)) {
        throw new Error(`Unexpected CSV response while loading ${absPath}`);
      }
      return rows;
    })
    .catch(err => {
      pathCache.delete(parserKey);
      if (!pathCache.size) cache.delete(absPath);
      throw err;
    });

  if (!options.force) {
    pathCache.set(parserKey, promise);
  }

  return promise;
}

function loadPresidentialMargins(options = {}) {
  const targetPath = resolvePath(options.path, defaultPresidentialPath);
  console.log('Loading presidential margins from:', targetPath);
  return loadCsv(targetPath, { parser: options.parser, force: options.force });
}

function prefetchPresidentialMargins(options = {}) {
  return loadPresidentialMargins(options).then(rows => rows);
}

function loadSenateMargins(options = {}) {
  const targetPath = resolvePath(options.path, defaultSenatePath);
  return loadCsv(targetPath, { parser: options.parser, force: options.force });
}

function prefetchSenateMargins(options = {}) {
  return loadSenateMargins(options).then(rows => rows);
}

function clearCache(path, parser) {
  if (!path) {
    cache.clear();
    return;
  }
  const absPath = resolvePath(path);
  const pathCache = cache.get(absPath);
  if (!pathCache) return;
  if (parser === undefined) {
    cache.delete(absPath);
    return;
  }
  pathCache.delete(parser);
  if (!pathCache.size) cache.delete(absPath);
}

const api = {
  loadCsv,
  loadPresidentialMargins,
  prefetchPresidentialMargins,
  loadSenateMargins,
  prefetchSenateMargins,
  clearCache,
  resolvePath,
  defaultPath: defaultPresidentialPath,
  defaultPresidentialPath,
  defaultSenatePath
};

if (globalObj && typeof globalObj === 'object') {
  try {
    globalObj.DataLoader = Object.assign({}, globalObj.DataLoader || {}, api);
  } catch (err) {
    // ignore attachment errors in non-window environments
  }
}

export {
  loadCsv,
  loadPresidentialMargins,
  prefetchPresidentialMargins,
  loadSenateMargins,
  prefetchSenateMargins,
  clearCache,
  resolvePath,
  defaultPresidentialPath,
  defaultSenatePath
};

export default api;
