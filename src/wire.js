// Minimal protobuf wire-format reader.
//
// Zwift serves several endpoints as `application/x-protobuf-lite` without
// publishing schemas. Rather than depend on a protobuf runtime and a guessed
// `.proto`, this decodes the generic wire format: field number + wire type.
// That means a schema change shows up as a visible structural difference
// instead of silently-wrong values.
const WIRE = { 0: 'varint', 1: 'i64', 2: 'len', 5: 'i32' };

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  throw new Error('truncated varint');
}

/** Decode one message level into [{field, type, value}]. */
export function scan(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Number(tag >> 3n);
    const type = WIRE[Number(tag & 7n)];
    if (field === 0) throw new Error('field number 0 — not protobuf');
    if (type === 'varint') { let v; [v, pos] = readVarint(buf, pos); out.push({ field, type, value: v }); }
    else if (type === 'i64') { out.push({ field, type, value: buf.readBigUInt64LE(pos) }); pos += 8; }
    else if (type === 'i32') { out.push({ field, type, value: buf.readUInt32LE(pos) }); pos += 4; }
    else if (type === 'len') {
      let len; [len, pos] = readVarint(buf, pos);
      const n = Number(len);
      if (pos + n > buf.length) throw new Error('length-delimited field overruns buffer');
      out.push({ field, type, value: buf.subarray(pos, pos + n) });
      pos += n;
    } else throw new Error(`unknown wire type at byte ${pos}`);
  }
  return out;
}

/** Convenience: the varint values of a repeated field at this level. */
export function varints(fields, field) {
  return fields.filter((f) => f.field === field && f.type === 'varint').map((f) => Number(f.value));
}

/** Convenience: the sub-messages of a repeated length-delimited field. */
export function messages(fields, field) {
  return fields.filter((f) => f.field === field && f.type === 'len').map((f) => f.value);
}

export function str(fields, field) {
  const f = fields.find((x) => x.field === field && x.type === 'len');
  return f ? f.value.toString('utf8') : null;
}

export function num(fields, field) {
  const f = fields.find((x) => x.field === field && x.type === 'varint');
  return f ? Number(f.value) : null;
}

/**
 * Decode a message into a plain object keyed by field number ("1", "2", …).
 * Repeated fields become arrays. Length-delimited fields that parse as a nested
 * message become objects; otherwise they are returned as a UTF-8 string when
 * printable, else a Buffer. Varints stay Number unless they exceed 2^53, where
 * they become BigInt. This is a faithful, lossless-ish view of an unknown
 * protobuf — no field is named or interpreted.
 */
export function decode(buf, depth = 0, maxDepth = 6) {
  const out = {};
  for (const f of scan(buf)) {
    let value;
    if (f.type === 'varint' || f.type === 'i64') {
      value = f.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(f.value) : f.value;
    } else if (f.type === 'i32') {
      value = f.value;
    } else { // len: strings first (real sub-messages carry low control bytes)
      const str = f.value.toString('utf8');
      const printable = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(str);
      if (printable) {
        value = str;
      } else {
        value = null;
        if (depth < maxDepth && f.value.length) {
          try { value = decode(f.value, depth + 1, maxDepth); } catch { value = null; }
        }
        if (value == null) value = Buffer.from(f.value);
      }
    }
    const key = String(f.field);
    if (key in out) { if (!Array.isArray(out[key])) out[key] = [out[key]]; out[key].push(value); }
    else out[key] = value;
  }
  return out;
}

/** Human-readable structural summary, for diagnosing drift. */
export function describe(buf, depth = 0, maxDepth = 3) {
  const pad = '  '.repeat(depth);
  let fields;
  try { fields = scan(buf); } catch (err) { return `${pad}<not a message: ${err.message}>`; }
  const groups = new Map();
  for (const f of fields) {
    const k = `${f.field}:${f.type}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f.value);
  }
  const lines = [];
  for (const [k, vals] of groups) {
    const [field, type] = k.split(':');
    lines.push(`${pad}field ${field} (${type}) x${vals.length}` +
      (type === 'varint' ? `  e.g. ${vals.slice(0, 8).map(String).join(', ')}` : ''));
    if (type === 'len' && depth < maxDepth) {
      const nested = describe(vals[0], depth + 1, maxDepth);
      lines.push(nested.includes('<not a message')
        ? `${pad}  (${vals[0].length} bytes, likely string: ${JSON.stringify(vals[0].toString('utf8').slice(0, 40))})`
        : nested);
    }
  }
  return lines.join('\n');
}
