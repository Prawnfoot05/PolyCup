import { createHash } from 'node:crypto';
const hash = data => createHash('sha256').update(data).digest('hex');
export function unpack(buffer) {
  const headerSize = buffer.readUInt32LE(4), jsonSize = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(0) !== 4 || jsonSize > headerSize || headerSize > buffer.length) throw new Error('Invalid ASAR header.');
  const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8')), files = new Map();
  function walk(entry, prefix = '') {
    for (const [name, child] of Object.entries(entry.files)) {
      const key = prefix + name;
      if (child.files) walk(child, key + '/');
      else {
        if (child.unpacked || child.link) throw new Error('This installer requires a self-contained ASAR.');
        const start = 8 + headerSize + Number(child.offset), end = start + child.size;
        if (start < 8 + headerSize || end > buffer.length) throw new Error('Invalid ASAR entry.');
        files.set(key, Buffer.from(buffer.subarray(start, end)));
      }
    }
  }
  walk(header); return files;
}
export function pack(files) {
  const header = { files: {} }; let offset = 0; const data = [];
  for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (name.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe archive path.');
    const bytes = Buffer.from(content), parts = name.split('/'); let entry = header;
    for (const part of parts.slice(0, -1)) entry = entry.files[part] ??= { files: {} };
    const blocks = []; for (let i = 0; i < bytes.length; i += 4194304) blocks.push(hash(bytes.subarray(i, i + 4194304)));
    entry.files[parts.at(-1)] = { size: bytes.length, offset: String(offset),
      integrity: { algorithm: 'SHA256', hash: hash(bytes), blockSize: 4194304, blocks } };
    offset += bytes.length; data.push(bytes);
  }
  const json = Buffer.from(JSON.stringify(header)), payloadSize = (4 + json.length + 3) & ~3;
  const pickle = Buffer.alloc(4 + payloadSize); pickle.writeUInt32LE(payloadSize, 0); pickle.writeUInt32LE(json.length, 4); json.copy(pickle, 8);
  const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([size, pickle, ...data]);
}
