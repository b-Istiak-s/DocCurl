const textEncoder = new TextEncoder();

let crcTable = null;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(bytes) {
  const table = getCrcTable();
  let value = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    value = table[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function createLocalHeader(nameBytes, contentBytes, checksum) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, 0);
  writeUint32(view, 14, checksum);
  writeUint32(view, 18, contentBytes.length);
  writeUint32(view, 22, contentBytes.length);
  writeUint16(view, 26, nameBytes.length);
  writeUint16(view, 28, 0);
  header.set(nameBytes, 30);

  return header;
}

function createCentralDirectoryHeader(nameBytes, contentBytes, checksum, localHeaderOffset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, 0);
  writeUint16(view, 14, 0);
  writeUint32(view, 16, checksum);
  writeUint32(view, 20, contentBytes.length);
  writeUint32(view, 24, contentBytes.length);
  writeUint16(view, 28, nameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, localHeaderOffset);
  header.set(nameBytes, 46);

  return header;
}

function createEndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);

  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralDirectorySize);
  writeUint32(view, 16, centralDirectoryOffset);
  writeUint16(view, 20, 0);

  return record;
}

export function encodeText(value) {
  return textEncoder.encode(String(value ?? ""));
}

export function createZipArchive(files) {
  const localChunks = [];
  const centralDirectoryChunks = [];
  let currentOffset = 0;
  let entryCount = 0;

  Object.entries(files || {}).forEach(([name, content]) => {
    const nameBytes = encodeText(name);
    const contentBytes = content instanceof Uint8Array ? content : encodeText(content);
    const checksum = crc32(contentBytes);
    const localHeader = createLocalHeader(nameBytes, contentBytes, checksum);
    const centralHeader = createCentralDirectoryHeader(
      nameBytes,
      contentBytes,
      checksum,
      currentOffset,
    );

    localChunks.push(localHeader, contentBytes);
    currentOffset += localHeader.length + contentBytes.length;
    centralDirectoryChunks.push(centralHeader);
    entryCount += 1;
  });

  const centralDirectory = concatChunks(centralDirectoryChunks);
  const endRecord = createEndOfCentralDirectory(
    entryCount,
    centralDirectory.length,
    currentOffset,
  );

  return concatChunks([...localChunks, centralDirectory, endRecord]);
}
