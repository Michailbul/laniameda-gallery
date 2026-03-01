const clientId = process.env.WORKOS_CLIENT_ID;

const providers: Array<{
  type: string;
  issuer: string;
  algorithm: string;
  applicationID?: string;
  jwks: string;
}> = [];

if (clientId) {
  providers.push(
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      applicationID: clientId,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  );
}

const authConfig = { providers };

export default authConfig;
