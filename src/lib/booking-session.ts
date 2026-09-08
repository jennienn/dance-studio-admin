import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const LOCAL_BOOKING_SESSION_SECRET = "dance-studio-local-booking-session-only";

const secret = () => {
  const configuredSecret = process.env.BOOKING_SESSION_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  return process.env.NODE_ENV === "development" ? LOCAL_BOOKING_SESSION_SECRET : "";
};
export function createBookingToken(memberId: number, cycleId: string) {
  if (!secret()) throw new Error("BOOKING_SESSION_SECRET 환경변수가 필요합니다.");
  const payload = Buffer.from(JSON.stringify({ memberId, cycleId, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function readBookingToken(token?: string) {
  if (!token || !secret()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      memberId: number;
      cycleId: string;
      exp: number;
    };
    return Number.isInteger(value.memberId) && typeof value.cycleId === "string" && value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}
