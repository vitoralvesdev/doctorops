import type { Hint } from "./types.js";

export const PROBE_PORTS = [5555, 6466, 8008, 8009, 9080, 8080, 80, 5000, 7000, 62078] as const;

export const DEEP_PORTS = [
  5555, 5037, 6466, 6467, 8008, 8009, 80, 8080, 8081, 8082, 8443, 443, 9080, 8888, 9000, 9009, 9090, 9999,
  22, 23, 2323, 21, 139, 445, 7547, 19999, 9527, 7000, 7001, 5000, 5001, 62078, 49152, 49153, 49154,
];

export const PORT_LABELS: Record<number, string> = {
  5555: "ADB",
  5037: "ADB Server",
  6466: "Android TV Remote",
  6467: "Android TV Remote v2",
  8008: "Google Cast HTTP",
  8009: "Google Cast TLS",
  9080: "TV Web Panel",
  80: "HTTP",
  443: "HTTPS",
  8080: "HTTP alt",
  8081: "HTTP alt",
  8082: "HTTP alt",
  8443: "HTTPS alt",
  8888: "HTTP alt",
  9000: "HTTP alt",
  9009: "HTTP alt",
  9090: "HTTP alt",
  9999: "Vendor",
  22: "SSH",
  23: "Telnet",
  2323: "Telnet alt",
  21: "FTP",
  139: "NetBIOS",
  445: "SMB",
  7547: "TR-069",
  19999: "Vendor",
  9527: "Vendor",
  5000: "AirPlay/RAOP",
  5001: "AirPlay alt",
  7000: "AirPlay RTSP",
  7001: "AirPlay",
  62078: "Apple Lockdown",
  49152: "Apple Continuity",
  49153: "Apple Continuity",
  49154: "Apple Continuity",
};


export function hintsForPort(port: number): Hint[] {
  switch (port) {
    case 5555:
      return ["android"];
    case 6466:
    case 8008:
    case 8009:
      return ["android-tv"];
    case 62078:
      return ["apple"];
    case 5000:
    case 7000:
      return ["airplay"];
    default:
      return [];
  }
}
