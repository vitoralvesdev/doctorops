import type { NextFunction, Request, Response } from "express";
import { ifaceList } from "./network.js";

export function clientAddress(req: Request): string {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

export function isLocalRequest(req: Request): boolean {
  const ip = clientAddress(req);
  if (ip === "127.0.0.1" || ip === "::1") return true;
  return ifaceList().some((i) => i.ip === ip);
}

export function apiAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();
  if (isLocalRequest(req)) return next();
  res.status(403).json({ ok: false, error: "Acesso restrito ao localhost." });
}
