import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { LogoMark } from "@/components/voice/icons";
import { STARS_SHADOW } from "@/components/voice/sceneStars";
import { entraConfig } from "@/lib/auth/entra";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  SessionExpired: "Your session expired. Sign in again to keep working on your board.",
  AccessDenied: "Sign-in was cancelled or access wasn't granted.",
  Configuration: "Sign-in isn't set up correctly on the server. Check the Entra ID settings.",
  OAuthCallbackError: "Microsoft couldn't complete the sign-in. Try again.",
};

/** Only same-site paths, so a crafted link can't bounce the user elsewhere after sign-in. */
function safePath(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/signin") ? v : "/voice";
}

/** The front door when Microsoft Entra ID sign-in is on. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackUrl = safePath(params.callbackUrl);
  const configured = !!entraConfig();
  const session = configured ? await auth() : null;
  if (!configured || (session && !session.error)) redirect(callbackUrl);

  const errorKey = Array.isArray(params.error) ? params.error[0] : params.error;
  const error = errorKey ? (ERRORS[errorKey] ?? ERRORS.OAuthCallbackError) : session?.error ? ERRORS.SessionExpired : null;

  return (
    <main className="scene flex min-h-dvh items-center justify-center px-4">
      <div className="bg" />
      <div className="stars" style={{ boxShadow: STARS_SHADOW }} aria-hidden />
      <div className="floor" aria-hidden />
      <div className="vig" aria-hidden />

      <section className="signin panel animate-rise" aria-labelledby="signin-title">
        <div className="brand mb-8">
          <LogoMark size={44} />
          <span className="word">
            <b>DevOps</b>
            <i>Voice</i>
          </span>
        </div>
        <h1 id="signin-title" className="serif text-[44px] leading-[1.05] text-[#f3f7ff]">
          Talk to your board
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#a9bbd8]">
          Sign in with your work account. DevOps Voice works on Azure DevOps as you, with your permissions, and nothing changes on the
          board until you say yes.
        </p>

        {error && (
          <p role="alert" className="signin-error">
            {error}
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
          }}
        >
          <button type="submit" className="msbtn">
            <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </button>
        </form>

        <ul className="signin-points">
          <li>Uses Microsoft Entra ID; your password never touches this app.</li>
          <li>Your Azure DevOps access stays on the server, never in the browser.</li>
          <li>The first time, Microsoft asks you to allow access to Azure DevOps.</li>
        </ul>
      </section>
    </main>
  );
}
