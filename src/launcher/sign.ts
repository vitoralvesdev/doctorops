import crypto from "node:crypto";
import { readZip, writeZip, type ZipEntry } from "./zip.js";
import { OVERLAY_CERT, OVERLAY_PRIVATE_KEY } from "./keys.js";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsa: "1.2.840.113549.1.1.1",
};

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function seq(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts));
}

function integer(value: number): Buffer {
  return tlv(0x02, Buffer.from([value]));
}

function oid(value: string): Buffer {
  const parts = value.split(".").map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let v = Math.floor(part / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function pemToDer(pem: string): Buffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

type Tlv = { tag: number; start: number; contentStart: number; end: number };

function readTlv(buf: Buffer, offset: number): Tlv {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let header = 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    len = 0;
    for (let i = 0; i < count; i++) len = (len << 8) | buf[offset + 2 + i];
    header = 2 + count;
  }
  return { tag, start: offset, contentStart: offset + header, end: offset + header + len };
}

function certificateParts(certDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const cert = readTlv(certDer, 0);
  const tbs = readTlv(certDer, cert.contentStart);
  let cursor = tbs.contentStart;
  let element = readTlv(certDer, cursor);
  if (element.tag === 0xa0) {
    cursor = element.end;
    element = readTlv(certDer, cursor);
  }
  const serial = certDer.subarray(element.start, element.end);
  cursor = element.end;
  element = readTlv(certDer, cursor);
  cursor = element.end;
  const issuer = readTlv(certDer, cursor);
  return { issuer: certDer.subarray(issuer.start, issuer.end), serial };
}

const SHA256_ALG = seq(oid(OID.sha256));
const RSA_ALG = seq(oid(OID.rsa), tlv(0x05, Buffer.alloc(0)));

function buildPkcs7(sf: Buffer): Buffer {
  const key = crypto.createPrivateKey(OVERLAY_PRIVATE_KEY);
  const certDer = pemToDer(OVERLAY_CERT);
  const { issuer, serial } = certificateParts(certDer);

  const attrs = set(
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.messageDigest), set(tlv(0x04, crypto.createHash("sha256").update(sf).digest()))),
  );
  const signature = crypto.sign("sha256", attrs, key);
  const signedAttrs = Buffer.from(attrs);
  signedAttrs[0] = 0xa0;

  const signerInfo = seq(
    integer(1),
    seq(issuer, serial),
    SHA256_ALG,
    signedAttrs,
    RSA_ALG,
    tlv(0x04, signature),
  );

  const signedData = seq(
    integer(1),
    set(SHA256_ALG),
    seq(oid(OID.data), tlv(0xa0, tlv(0x04, sf))),
    tlv(0xa0, certDer),
    set(signerInfo),
  );

  return seq(oid(OID.signedData), tlv(0xa0, signedData));
}

function digestBase64(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("base64");
}

function entry(name: string, data: Buffer): ZipEntry {
  return { name, method: 8, crc: 0, compSize: 0, size: 0, data };
}

export function signApk(apk: Buffer): Buffer {
  const entries = readZip(apk).filter(
    (e) => !(e.name.startsWith("META-INF/") && /\.(SF|RSA|DSA|EC|MF)$/i.test(e.name)),
  );

  const manifestSections: string[] = [];
  const sfSections: string[] = [];
  for (const e of entries) {
    const digest = digestBase64(e.data);
    const section = `Name: ${e.name}\r\nSHA-256-Digest: ${digest}\r\n\r\n`;
    manifestSections.push(section);
    sfSections.push(`Name: ${e.name}\r\nSHA-256-Digest: ${digestBase64(Buffer.from(section, "utf8"))}\r\n\r\n`);
  }

  const manifest = Buffer.from(
    `Manifest-Version: 1.0\r\nCreated-By: DoctorOps\r\n\r\n${manifestSections.join("")}`,
    "utf8",
  );
  const sf = Buffer.from(
    `Signature-Version: 1.0\r\nCreated-By: DoctorOps\r\nSHA-256-Digest-Manifest: ${digestBase64(manifest)}\r\n\r\n${sfSections.join("")}`,
    "utf8",
  );
  const rsa = buildPkcs7(sf);

  return writeZip([
    ...entries,
    entry("META-INF/MANIFEST.MF", manifest),
    entry("META-INF/CERT.SF", sf),
    entry("META-INF/CERT.RSA", rsa),
  ]);
}
