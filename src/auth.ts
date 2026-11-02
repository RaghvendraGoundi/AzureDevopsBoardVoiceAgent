import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { entraConfig, issuerFor, needsRefresh, refreshAdoTokens, SIGN_IN_SCOPES, type AdoTokens } from "@/lib/auth/entra";

/**
 * Sign-in with Microsoft Entra ID (Auth.js). The user consents once to
 * Azure DevOps access; their tokens live only in the encrypted session
 * cookie and are never sent to the browser's JavaScript. The board reads
 * them on the server (see src/lib/devops/azure/auth.ts).
 *
 * Sign-in is switched on by AUTH_MICROSOFT_ENTRA_ID_TENANT_ID, _ID and
 * _SECRET (plus AUTH_SECRET); without them the app runs as before.
 */

declare module "next-auth" {
  interface Session {
    /** Set when the Azure DevOps token couldn't be refreshed: sign in again. */
    error?: "RefreshFailed";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    ado?: AdoTokens;
    /** Entra object id and tenant: the user's stable identity. */
    oid?: string;
    tid?: string;
    error?: "RefreshFailed";
  }
}

const cfg = entraConfig();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: cfg
    ? [
        MicrosoftEntraID({
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          issuer: issuerFor(cfg),
          authorization: { params: { scope: SIGN_IN_SCOPES } },
          // The built-in profile also fetches a photo from Microsoft Graph, which this
          // Azure DevOps token can't do; the ID token already has what we need.
          profile: (p) => ({ id: String(p.oid ?? p.sub), name: p.name, email: p.email ?? p.preferred_username ?? null, image: null }),
        }),
      ]
    : [],
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token && account.refresh_token) {
        return {
          ...token,
          ado: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: (account.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
          },
          oid: (profile?.oid as string | undefined) ?? token.sub,
          tid: (profile?.tid as string | undefined) ?? cfg?.tenantId,
          error: undefined,
        };
      }
      // Keep the cookie's token fresh whenever the session is read (middleware, sign-in page).
      if (cfg && token.ado && needsRefresh(token.ado)) {
        try {
          return { ...token, ado: await refreshAdoTokens(cfg, token.ado.refreshToken), error: undefined };
        } catch (err) {
          console.warn("[auth] Azure DevOps token refresh failed:", err instanceof Error ? err.message : err);
          return { ...token, error: "RefreshFailed" };
        }
      }
      return token;
    },
    // Only the name, email and an error flag reach the browser; never the tokens.
    session({ session, token }) {
      if (token.error) session.error = token.error;
      return session;
    },
  },
});
