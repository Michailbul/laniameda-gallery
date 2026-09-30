// Generates the RS256 key pair that lets trusted code prove who it acts for.
//
//   CONVEX_AUTH_PRIVATE_KEY -> Vercel env + the repo's .env.local (scripts)
//   CONVEX_AUTH_JWKS        -> Convex env:
//     CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex env set CONVEX_AUTH_JWKS '<json>'
//
// Prints to stdout only; nothing is written or uploaded.
import { generateKeyPairSync } from "node:crypto";
import { publicJwksFromPrivateKey } from "../lib/convex-auth";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

console.log(`CONVEX_AUTH_PRIVATE_KEY="${pem.trim().replace(/\n/g, "\\n")}"`);
console.log(`CONVEX_AUTH_JWKS='${JSON.stringify(publicJwksFromPrivateKey(pem))}'`);
