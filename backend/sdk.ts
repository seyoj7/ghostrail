import "server-only";

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function toDosDateTime(d = new Date()) {
  const time =
    (((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>>
      0) &
    0xffff;
  const date =
    ((((d.getFullYear() - 1980) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate()) >>>
      0) &
    0xffff;
  return { time, date };
}

interface SdkFileEntry {
  fullPath: string;
  zipPath: string;
}

/** Recursively collect all files in the ghostrail_sdk directory (ignoring cache/temp files). */
function collectSdkFiles(rootDir: string, basePrefix = "ghostrail_sdk/"): SdkFileEntry[] {
  const files: SdkFileEntry[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "__pycache__" ||
          entry.name === ".git" ||
          entry.name === "node_modules"
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".pyc") || entry.name === ".DS_Store") continue;
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        files.push({ fullPath, zipPath: `${basePrefix}${relPath}` });
      }
    }
  }

  walk(rootDir);
  return files;
}

/** Generate a clean zip buffer containing only the ghostrail_sdk folder. */
export function generateSdkZip(): Buffer {
  const rootDir = path.resolve(process.cwd(), "ghostrail_sdk");
  const files = collectSdkFiles(rootDir);

  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;
  const dos = toDosDateTime();

  for (const file of files) {
    const uncompressedData = fs.readFileSync(file.fullPath);
    const compressedData = zlib.deflateRawSync(uncompressedData);
    const crc = zlib.crc32(uncompressedData) >>> 0;
    const fileNameBuf = Buffer.from(file.zipPath, "utf8");

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8
    localHeader.writeUInt16LE(8, 8); // compression: deflate
    localHeader.writeUInt16LE(dos.time, 10);
    localHeader.writeUInt16LE(dos.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(uncompressedData.length, 22);
    localHeader.writeUInt16LE(fileNameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field len

    const localChunk = Buffer.concat([localHeader, fileNameBuf, compressedData]);
    localHeaders.push(localChunk);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dos.time, 12);
    centralHeader.writeUInt16LE(dos.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(uncompressedData.length, 24);
    centralHeader.writeUInt16LE(fileNameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attr
    const extAttr = (0o100644 << 16) >>> 0;
    centralHeader.writeUInt32LE(extAttr, 38); // external attr
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralHeaders.push(Buffer.concat([centralHeader, fileNameBuf]));
    offset += localChunk.length;
  }

  const centralDirData = Buffer.concat(centralHeaders);
  const centralDirOffset = offset;
  const centralDirSize = centralDirData.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk num
  eocd.writeUInt16LE(0, 6); // disk start
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localHeaders, centralDirData, eocd]);
}

