'use strict';

function parseDbf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) throw new Error('File is too short to be a DBF table.');
  const version = buffer[0];
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  if (headerLength < 33 || headerLength > buffer.length || recordLength < 1) throw new Error('The DBF header has invalid lengths.');
  const fields = [];
  for (let p = 32; p < headerLength - 1 && buffer[p] !== 0x0d; p += 32) {
    if (p + 32 > buffer.length) throw new Error('The field table is truncated.');
    let end = p;
    while (end < p + 11 && buffer[end]) end++;
    const name = buffer.toString('ascii', p, end).trim();
    const type = String.fromCharCode(buffer[p + 11]);
    const length = buffer[p + 16];
    const decimals = buffer[p + 17];
    if (!name || !length) throw new Error('The DBF field table contains an invalid field.');
    fields.push({ name, type, length, decimals });
  }
  const rows = [];
  let offset = headerLength;
  const max = Math.min(records, Math.floor((buffer.length - headerLength) / recordLength));
  for (let i = 0; i < max; i++, offset += recordLength) {
    const deleted = buffer[offset] === 0x2a;
    const row = { _deleted: deleted };
    let col = offset + 1;
    for (const field of fields) {
      row[field.name] = buffer.toString('latin1', col, col + field.length).trimEnd();
      col += field.length;
    }
    rows.push(row);
  }
  return { version, records, fields, rows, truncated: rows.length !== records, headerLength, recordLength };
}

module.exports = { parseDbf };
