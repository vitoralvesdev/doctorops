export type OverlayPatch = {
  targetIds: number[];
  hiddenTiles: Set<number>;
  nextFocusUp?: number;
};

const ATTR_ID = 0x010100d0;
const ATTR_FOCUSABLE = 0x010100da;
const ATTR_FOCUSABLE_TOUCH = 0x010100db;
const ATTR_NEXT_FOCUS_UP = 0x010100e3;
const ATTR_WIDTH = 0x010100f4;
const ATTR_HEIGHT = 0x010100f5;

type AttrRef = { resId: number; dataOffset: number };

type ElementRef = { attrs: AttrRef[] };

function readResourceMap(buf: Buffer, start: number, headerSize: number, size: number): number[] {
  const count = Math.floor((size - headerSize) / 4);
  const map: number[] = [];
  for (let i = 0; i < count; i++) map.push(buf.readUInt32LE(start + headerSize + i * 4));
  return map;
}

function parseElements(buf: Buffer): ElementRef[] {
  if (buf.readUInt16LE(0) !== 0x0003) throw new Error("XML binário inválido: cabeçalho inesperado.");
  const end = buf.length;
  let offset = buf.readUInt16LE(2);
  let resourceMap: number[] = [];
  const elements: ElementRef[] = [];

  while (offset + 8 <= end) {
    const type = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const size = buf.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) break;

    if (type === 0x0180) {
      resourceMap = readResourceMap(buf, offset, headerSize, size);
    } else if (type === 0x0102) {
      const attrStart = buf.readUInt16LE(offset + 24);
      const attrSize = buf.readUInt16LE(offset + 26);
      const attrCount = buf.readUInt16LE(offset + 28);
      const attrs: AttrRef[] = [];
      const base = offset + headerSize + attrStart;
      for (let i = 0; i < attrCount; i++) {
        const at = base + i * attrSize;
        if (at + 20 > offset + size) break;
        const nameIndex = buf.readUInt32LE(at + 4);
        const resId = nameIndex < resourceMap.length ? resourceMap[nameIndex] : 0;
        attrs.push({ resId, dataOffset: at + 16 });
      }
      elements.push({ attrs });
    }
    offset += size;
  }
  return elements;
}

function setData(buf: Buffer, offset: number, type: number, data: number): void {
  buf.writeUInt8(type, offset - 1);
  buf.writeUInt32LE(data >>> 0, offset);
}

export function patchOverlayLayout(buf: Buffer, patch: OverlayPatch): Buffer {
  const out = Buffer.from(buf);
  const elements = parseElements(out);
  let idIndex = 0;

  for (const element of elements) {
    const idAttr = element.attrs.find((a) => a.resId === ATTR_ID);
    if (!idAttr) continue;

    if (idIndex < patch.targetIds.length) setData(out, idAttr.dataOffset, 0x01, patch.targetIds[idIndex]);

    if (patch.nextFocusUp !== undefined) {
      const next = element.attrs.find((a) => a.resId === ATTR_NEXT_FOCUS_UP);
      if (next) setData(out, next.dataOffset, 0x01, patch.nextFocusUp);
    }

    const tile = (idIndex - 1) / 2;
    if (Number.isInteger(tile) && tile >= 0 && patch.hiddenTiles.has(tile)) {
      for (const attr of element.attrs) {
        if (attr.resId === ATTR_WIDTH || attr.resId === ATTR_HEIGHT) setData(out, attr.dataOffset, 0x05, 0);
        if (attr.resId === ATTR_FOCUSABLE || attr.resId === ATTR_FOCUSABLE_TOUCH) setData(out, attr.dataOffset, 0x12, 0);
      }
    }

    idIndex++;
  }

  if (idIndex !== patch.targetIds.length) {
    throw new Error(`Layout do overlay com ${idIndex} IDs, esperado ${patch.targetIds.length}.`);
  }
  return out;
}

export function patchApkLayout(
  entry: Buffer,
  patch: OverlayPatch,
): Buffer {
  return patchOverlayLayout(entry, patch);
}
