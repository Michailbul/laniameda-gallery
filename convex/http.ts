import { httpRouter } from "convex/server";
import { privateMediaHttp } from "./inspirationPrivate";

// HTTP routes. One so far: private inspiration originals, reached only by
// the Next.js route /api/inspiration/media/<id> with a short-lived token.
const http = httpRouter();

http.route({ path: "/inspiration/private-media", method: "GET", handler: privateMediaHttp });

export default http;
