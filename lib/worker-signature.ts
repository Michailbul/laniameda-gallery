import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "v1";

export const createWorkerSignature = ({
  secret,
  body,
  timestamp,
}: {
  secret: string;
  body: string;
  timestamp: string;
}) => {
  const payload = `${timestamp}.${body}`;
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `${SIGNATURE_PREFIX}:${digest}`;
};

export const verifyWorkerSignature = ({
  secret,
  body,
  timestamp,
  signature,
  maxSkewSeconds = 300,
}: {
  secret: string;
  body: string;
  timestamp: string;
  signature: string;
  maxSkewSeconds?: number;
}) => {
  if (!signature.startsWith(`${SIGNATURE_PREFIX}:`)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  if (Math.abs(now - ts) > maxSkewSeconds) {
    return false;
  }

  const expected = createWorkerSignature({ secret, body, timestamp });
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
};
