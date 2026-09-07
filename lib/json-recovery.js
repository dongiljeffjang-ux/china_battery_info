// Extract one complete top-level JSON value without confusing braces in strings.
export function parseResponseJson(text) {
  try { return JSON.parse(text); } catch {}
  const candidates = [];
  let start = -1, stack = [], quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (c === '{' || c === '[') { start = i; stack = [c]; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const opening = stack.pop();
      if ((c === '}' && opening !== '{') || (c === ']' && opening !== '[')) throw new Error('INVALID_JSON_OUTPUT');
      if (!stack.length) {
        try { candidates.push(JSON.parse(text.slice(start, i + 1))); } catch { throw new Error('INVALID_JSON_OUTPUT'); }
        start = -1;
      }
    }
  }
  if (start >= 0 || candidates.length !== 1) throw new Error('INVALID_JSON_OUTPUT');
  return candidates[0];
}

// Supports the closed object/array/string/null schemas used by news discovery.
export function validateSearchData(value, schema = {}) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![].concat(schema.type).includes(type)) throw new Error('INVALID_SEARCH_SCHEMA');
  if (schema.enum && !schema.enum.includes(value)) throw new Error('INVALID_SEARCH_SCHEMA');
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error('INVALID_SEARCH_SCHEMA');
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key)) throw new Error('INVALID_SEARCH_SCHEMA');
      validateSearchData(item, schema.properties?.[key] || {});
      if (key === 'url') {
        let url;
        try { url = new URL(String(item)); } catch { throw new Error('INVALID_SOURCE_URL'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_SOURCE_URL');
      }
    }
  }
  if (type === 'array') {
    if (schema.maxItems != null && value.length > schema.maxItems) throw new Error('INVALID_SEARCH_SCHEMA');
    for (const item of value) validateSearchData(item, schema.items || {});
  }
  return value;
}
