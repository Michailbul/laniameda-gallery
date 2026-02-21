import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const authorizationUrl = await getSignInUrl({
    redirectUri: `${origin}/callback`,
  });
  return redirect(authorizationUrl);
}
