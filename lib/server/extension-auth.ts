import { timingSafeEqual } from "node:crypto";

const readTokenFromRequest = (request: Request) => {
  const direct = request.headers.get("x-extension-token")?.trim();
  if (direct) {
    return direct;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return undefined;
};

export const resolveExtensionOwnerUserId = () => {
  const value = (
    process.env.EXTENSION_OWNER_USER_ID ??
    process.env.KB_OWNER_USER_ID ??
    ""
  ).trim();
  if (!value) {
    throw new Error("Extension owner not configured.");
  }
  return value;
};

export const validateExtensionToken = (request: Request) => {
  const expected = (process.env.EXTENSION_API_TOKEN ?? "").trim();
  if (!expected) {
    return true;
  }

  const received = readTokenFromRequest(request);
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
};
