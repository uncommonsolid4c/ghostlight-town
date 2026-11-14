/**
 * Ghostlight Town — Plot manifest validation and HTML desk-note sanitization.
 * Zero dependencies, fail-closed.
 */

export const MAX_MANIFEST_BYTES = 16 * 1024;
export const MAX_HTML_BYTES = 32 * 1024;
export const MAX_SIGNPOST_CHARS = 120;
export const MAX_PROPS = 12;

export const VALID_COTTAGES = new Set(['gable', 'cabin', 'tower']);
export const VALID_PROP_KINDS = new Set([
  'desk',
  'bookshelf',
  'rug',
  'tea_kettle',
  'typewriter',
  'cat',
  'poster_frame',
]);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_MANIFEST_KEYS = new Set(['cottage', 'wall', 'roof', 'trim', 'signpost_text', 'props']);
const ALLOWED_PROP_KEYS = new Set(['kind', 'x', 'y', 'z', 'rot_y', 'color']);

const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base', 'title'];
const URI_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background', 'cite', 'data']);

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  tab: '\t',
  newline: '\n',
  colon: ':',
};

/**
 * Validate a 3D plot manifest object.
 * Returns `{ ok: true, manifest }` or `{ ok: false, error, ...details }`.
 */
export function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: 'invalid_manifest' };
  }

  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      return { ok: false, error: 'unknown_manifest_key', key };
    }
  }

  const serialized = JSON.stringify(manifest);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) {
    return { ok: false, error: 'manifest_too_large', max: MAX_MANIFEST_BYTES };
  }

  if (!VALID_COTTAGES.has(manifest.cottage)) {
    return { ok: false, error: 'invalid_cottage' };
  }

  for (const field of ['wall', 'roof', 'trim']) {
    if (typeof manifest[field] !== 'string' || !HEX_COLOR_RE.test(manifest[field])) {
      return { ok: false, error: 'invalid_color', field };
    }
  }

  const signpostText = manifest.signpost_text === undefined ? '' : manifest.signpost_text;
  if (typeof signpostText !== 'string' || signpostText.length > MAX_SIGNPOST_CHARS) {
    return { ok: false, error: 'invalid_signpost_text', max: MAX_SIGNPOST_CHARS };
  }

  const rawProps = manifest.props === undefined ? [] : manifest.props;
  if (!Array.isArray(rawProps)) {
    return { ok: false, error: 'invalid_props' };
  }
  if (rawProps.length > MAX_PROPS) {
    return { ok: false, error: 'too_many_props', max: MAX_PROPS };
  }

  const normalizedProps = [];
  for (let i = 0; i < rawProps.length; i++) {
    const p = rawProps[i];
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, error: 'invalid_prop', index: i };
    }
    for (const key of Object.keys(p)) {
      if (!ALLOWED_PROP_KEYS.has(key)) {
        return { ok: false, error: 'unknown_prop_key', key, index: i };
      }
    }
    if (!VALID_PROP_KINDS.has(p.kind)) {
      return { ok: false, error: 'invalid_prop_kind', index: i };
    }
    for (const axis of ['x', 'y', 'z']) {
      if (typeof p[axis] !== 'number' || !Number.isFinite(p[axis]) || p[axis] < -12 || p[axis] > 12) {
        return { ok: false, error: 'prop_coord_out_of_range', axis, index: i };
      }
    }
    if (typeof p.rot_y !== 'number' || !Number.isFinite(p.rot_y) || p.rot_y < 0 || p.rot_y >= 360) {
      return { ok: false, error: 'invalid_prop_rotation', index: i };
    }
    if (p.color !== undefined && (typeof p.color !== 'string' || !HEX_COLOR_RE.test(p.color))) {
      return { ok: false, error: 'invalid_prop_color', index: i };
    }

    const propObj = {
      kind: p.kind,
      x: p.x,
      y: p.y,
      z: p.z,
      rot_y: p.rot_y,
    };
    if (p.color !== undefined) {
      propObj.color = p.color;
    }
    normalizedProps.push(propObj);
  }

  return {
    ok: true,
    manifest: {
      cottage: manifest.cottage,
      wall: manifest.wall,
      roof: manifest.roof,
      trim: manifest.trim,
      signpost_text: signpostText,
      props: normalizedProps,
    },
  };
}

/**
 * Decode numeric (decimal/hex, with or without trailing semicolon) and common named HTML entities.
 */
export function decodeHtmlEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);?/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }
    const lower = entity.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match;
  });
}

function checkUnsafeCss(rawCss) {
  const decoded = decodeHtmlEntities(rawCss);
  // Strip CSS comments and all ASCII whitespace/control chars so obfuscated url( / expression( is caught.
  const stripped = decoded
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\x00-\x20\x7f]/g, '')
    .toLowerCase();

  if (stripped.includes('expression(')) {
    return 'css_expression';
  }
  if (stripped.includes('url(')) {
    return 'css_url';
  }
  if (stripped.includes('javascript:')) {
    return 'javascript_uri';
  }
  return null;
}

function checkUriValue(rawVal) {
  const decoded = decodeHtmlEntities(rawVal).trim();
  const compact = decoded.replace(/[\x00-\x20\x7f]/g, '').toLowerCase();

  if (compact.startsWith('javascript:')) {
    return 'javascript_uri';
  }
  if (compact.startsWith('vbscript:')) {
    return 'vbscript_uri';
  }
  if (compact.startsWith('data:')) {
    if (!compact.startsWith('data:image/')) {
      return 'disallowed_data_uri';
    }
    return null;
  }
  if (compact.startsWith('//')) {
    return 'external_uri';
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(compact)) {
    return 'external_uri';
  }
  return null;
}

/**
 * Parse attributes from the remainder of a tag after the tag name.
 */
function parseTagAttributes(attrSlice) {
  const attrs = [];
  let i = 0;
  const len = attrSlice.length;

  while (i < len) {
    while (i < len && /[\x00-\x20\x7f/]/.test(attrSlice[i])) i++;
    if (i >= len) break;

    const nameStart = i;
    while (i < len && !/[\x00-\x20\x7f=/>]/.test(attrSlice[i])) i++;
    const name = attrSlice.slice(nameStart, i);
    if (!name) {
      i++;
      continue;
    }

    while (i < len && /[\x00-\x20\x7f]/.test(attrSlice[i])) i++;
    let value = '';
    if (i < len && attrSlice[i] === '=') {
      i++;
      while (i < len && /[\x00-\x20\x7f]/.test(attrSlice[i])) i++;
      if (i < len && (attrSlice[i] === '"' || attrSlice[i] === "'")) {
        const quote = attrSlice[i++];
        const valStart = i;
        while (i < len && attrSlice[i] !== quote) i++;
        value = attrSlice.slice(valStart, i);
        if (i < len) i++;
      } else {
        const valStart = i;
        while (i < len && !/[\x00-\x20\x7f>]/.test(attrSlice[i])) i++;
        value = attrSlice.slice(valStart, i);
      }
    }
    attrs.push({ name, value });
  }

  return attrs;
}

/**
 * Return true iff tag is the exact allowed viewport meta:
 * <meta name="viewport" content="width=device-width, initial-scale=1.0">
 * (attribute names and `name` value case-insensitive; `content` trimmed-exact;
 * attribute order and self-closing `/>` flexible; no extra attributes).
 */
function isAllowedViewportMeta(tagName, attrs) {
  if (tagName !== 'meta' || attrs.length !== 2) return false;
  const map = new Map();
  for (const attr of attrs) {
    const key = attr.name.toLowerCase();
    if (map.has(key)) return false;
    map.set(key, attr.value);
  }
  if (!map.has('name') || !map.has('content')) return false;
  if (map.get('name').trim().toLowerCase() !== 'viewport') return false;
  if (map.get('content').trim() !== 'width=device-width, initial-scale=1.0') return false;
  return true;
}

/**
 * Validate HTML desk-note content. Fail-closed: rejects any forbidden tag,
 * event handler, unsafe CSS, or non-relative/non-image-data URI.
 * Returns `{ ok: true }` or `{ ok: false, error, reason }`.
 */
export function validateHtml(html) {
  if (typeof html !== 'string') {
    return { ok: false, error: 'missing_html' };
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, error: 'html_too_large', max: MAX_HTML_BYTES };
  }

  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // Skip HTML comments
    if (html.startsWith('<!--', lt)) {
      const endComment = html.indexOf('-->', lt + 4);
      i = endComment === -1 ? len : endComment + 3;
      continue;
    }

    // Find matching '>' respecting quotes inside the tag
    let j = lt + 1;
    let quote = null;
    while (j < len) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }

    const rawTagInner = html.slice(lt + 1, j);
    const afterSlash = rawTagInner.replace(/^[\x00-\x20\x7f/]+/, '');
    const isClosing = /^[\x00-\x20\x7f]*\//.test(rawTagInner);

    // Extract normal tag name and attribute slice
    const match = afterSlash.match(/^([^\x00-\x20\x7f/>]+)([\s\S]*)$/);
    const tagName = match ? match[1].toLowerCase() : '';
    const attrs = match ? parseTagAttributes(match[2]) : [];

    // Check collapsed prefix before '=' or '/' so obfuscations like <scr\tipt> are caught
    const beforeEq = afterSlash.split(/[=/]/, 1)[0];
    const collapsedPrefix = beforeEq.replace(/[\x00-\x20\x7f]/g, '').toLowerCase();
    for (const forbidden of FORBIDDEN_TAGS) {
      if (collapsedPrefix.startsWith(forbidden)) {
        if (forbidden === 'meta' && !isClosing && isAllowedViewportMeta(tagName, attrs)) {
          continue;
        }
        return { ok: false, error: 'unsafe_html', reason: `forbidden_tag:${forbidden}` };
      }
    }

    if (match) {

      for (const attr of attrs) {
        const attrName = attr.name.replace(/[\x00-\x20\x7f]/g, '').toLowerCase();
        if (attrName.startsWith('on')) {
          return { ok: false, error: 'unsafe_html', reason: `forbidden_attr:${attrName}` };
        }
        if (attrName === 'style') {
          const cssErr = checkUnsafeCss(attr.value);
          if (cssErr) {
            return { ok: false, error: 'unsafe_html', reason: cssErr };
          }
        }
        if (URI_ATTRS.has(attrName)) {
          const uriErr = checkUriValue(attr.value);
          if (uriErr) {
            return { ok: false, error: 'unsafe_html', reason: uriErr };
          }
        }
      }

      if (tagName === 'style' && !rawTagInner.trimStart().startsWith('/')) {
        const closeIdx = html.slice(j + 1).search(/<\/style\b/i);
        const cssBody = closeIdx === -1 ? html.slice(j + 1) : html.slice(j + 1, j + 1 + closeIdx);
        const cssErr = checkUnsafeCss(cssBody);
        if (cssErr) {
          return { ok: false, error: 'unsafe_html', reason: cssErr };
        }
      }
    }

    i = j < len ? j + 1 : len;
  }

  return { ok: true };
}
