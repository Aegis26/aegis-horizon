import { useEffect, useState } from "react";
import { ClerkProvider, SignUp, useAuth, useClerk } from '@clerk/react';
import { useSignIn } from '@clerk/react/legacy';
import { shadcn } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { QueryClientProvider } from "@tanstack/react-query";
import { QueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';

import { Shell } from "@/components/layout/Shell";
import { AuthLayout } from "@/components/auth/AuthLayout";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Accounts from "@/pages/Accounts";
import AccountDetail from "@/pages/AccountDetail";
import Segments from "@/pages/Segments";
import Opportunities from "@/pages/Opportunities";
import Leads from "@/pages/Leads";
import Quotes from "@/pages/Quotes";
import Territories from "@/pages/Territories";
import Forecast from "@/pages/Forecast";
import Automation from "@/pages/Automation";
import Billing from "@/pages/Billing";
import Settings from "@/pages/Settings";
import Communications from "@/pages/Communications";
import Reports from "@/pages/Reports";
import Documents from "@/pages/Documents";
import Signatures from "@/pages/Signatures";
import { Button } from "@/components/ui/button";
import {
  getGetMeQueryKey,
  useGetMe,
  acceptInvitation,
  resolveInvitation,
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { getSafeAuthRedirectUrl, isInvitationAuthRedirect } from "@/lib/auth-redirect";
import { belongsToAuthenticatedUser } from "@/lib/auth-scope";
import { DeleteAccountDangerZone } from "@/components/settings/DeleteAccountDangerZone";
import { WindowAuthProvider, useWindowAuth } from "@/components/auth/WindowAuthProvider";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "hsl(192 100% 42%)",
    colorForeground: "hsl(216 33% 97%)",
    colorMutedForeground: "hsl(218 11% 46%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(232 59% 10%)",
    colorInput: "hsl(231 38% 16%)",
    colorInputForeground: "hsl(216 33% 97%)",
    colorNeutral: "hsl(231 38% 16%)",
    fontFamily: "'Public Sans', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#1A1F3A] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#00B4D8]/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-[#F5F7FA] font-display",
    headerSubtitle: "text-[#6B7280]",
    socialButtonsBlockButtonText: "font-medium text-[#F5F7FA]",
    formFieldLabel: "font-semibold text-[#F5F7FA] font-display",
    footerActionLink: "text-[#00B4D8] hover:text-[#00B4D8]/90 font-medium",
    footerActionText: "text-[#6B7280]",
    dividerText: "text-[#6B7280]",
    identityPreviewEditButton: "text-[#00B4D8] hover:text-[#00B4D8]/90",
    formFieldSuccessText: "text-[#10B981]",
    alertText: "text-[#EF4444]",
    logoBox: "h-12 w-12 mx-auto",
    logoImage: "object-contain",
    socialButtonsBlockButton: "border border-[#00B4D8]/20 hover:bg-[#0A0E27] transition-colors h-11",
    formButtonPrimary: "bg-[#00B4D8] text-[#0A0E27] hover:bg-[#00A0C0] h-11 font-semibold font-display shadow-[0_0_12px_rgba(0,180,216,0.4)]",
    formFieldInput: "flex h-10 w-full rounded-md border border-[#00B4D8]/20 bg-[#0A0E27]/50 px-3 py-2 text-sm placeholder:text-[#F5F7FA]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B4D8] focus-visible:ring-offset-2",
    footerAction: "bg-[#0A0E27]/30 py-4 px-6 mt-4 border-t border-[#00B4D8]/10",
    dividerLine: "bg-[#00B4D8]/10",
    alert: "bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]",
    otpCodeFieldInput: "border-[#00B4D8]/20 border-2 text-lg font-mono focus:border-[#00B4D8]",
    formFieldRow: "space-y-2",
    main: "p-6 sm:p-8",
  },
};

function SignInPage() {
  const [, setLocation] = useLocation();
  const { login } = useWindowAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(email, password, needsMfa ? totp : undefined);
      if (result.ok) {
        setLocation(getAuthRedirectUrl(`${basePath}/dashboard`));
        return;
      }
      setNeedsMfa(result.mfaRequired);
      setError(result.error);
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <AuthLayout>
      <form onSubmit={(event) => void submit(event)} className="w-full space-y-5 rounded-2xl border border-primary/10 bg-card p-8 shadow-xl">
        <div><h1 className="font-display text-2xl font-bold">Welcome back</h1><p className="mt-1 text-sm text-muted-foreground">Sign in to this window.</p></div>
        <label className="block space-y-2 text-sm font-medium">Email<input className="w-full rounded-md border bg-background px-3 py-2" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="block space-y-2 text-sm font-medium">Password<input className="w-full rounded-md border bg-background px-3 py-2" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {needsMfa && <label className="block space-y-2 text-sm font-medium">Authenticator code<input className="w-full rounded-md border bg-background px-3 py-2" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} required /></label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</Button>
        <p className="text-center text-sm"><a className="text-primary hover:underline" href={`${basePath}/forgot-password`}>Forgot password?</a></p>
        <p className="text-center text-sm text-muted-foreground">Need an account? <a className="text-primary hover:underline" href={`${basePath}/sign-up`}>Sign up</a></p>
      </form>
    </AuthLayout>
  );
}

type PasswordResetPhase = "email" | "code" | "password" | "second-factor" | "complete";
type PasswordResetSecondFactor = "totp" | "backup_code" | "email_code";

function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { getToken } = useAuth();
  const { signOut: signOutClerk } = useClerk();
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<PasswordResetPhase>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [secondFactor, setSecondFactor] = useState<PasswordResetSecondFactor>("totp");
  const [secondCode, setSecondCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const genericError = "We could not complete that password reset. Please try again.";

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true); setError(null);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
      setPhase("code");
    } catch {
      // Keep account existence private.
      setError(genericError);
    } finally { setBusy(false); }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true); setError(null);
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
      });
      if (attempt.status !== "needs_new_password") throw new Error();
      setPhase("password");
    } catch {
      setError(genericError);
    } finally { setBusy(false); }
  };

  const finalizeReset = async (sessionId: string) => {
    if (!setActive) throw new Error();
    await setActive({ session: sessionId });
    const token = await getToken();
    const response = await fetch(`${basePath}/api/auth/window/password-reset/revoke`, {
      method: "POST",
      credentials: "omit",
      headers: { authorization: `Bearer ${token ?? ""}` },
    });
    if (!response.ok) throw new Error();
    // This is the temporary reset session only. Do not sign out all Clerk
    // sessions; CRM browser windows have already been revoked server-side.
    await signOutClerk({ sessionId });
    setPhase("complete");
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true); setError(null);
    try {
      const attempt = await signIn.resetPassword({ password, signOutOfOtherSessions: false });
      if (attempt.status === "complete" && attempt.createdSessionId) {
        await finalizeReset(attempt.createdSessionId);
      } else if (attempt.status === "needs_second_factor") {
        const factor = attempt.supportedSecondFactors?.find(
          (item) => item.strategy === "totp" || item.strategy === "backup_code" || item.strategy === "email_code",
        );
        if (!factor) throw new Error();
        if (factor.strategy === "email_code") {
          await attempt.prepareSecondFactor({
            strategy: "email_code",
            emailAddressId: factor.emailAddressId,
          });
        }
        setSecondFactor(factor.strategy);
        setPhase("second-factor");
      } else throw new Error();
    } catch {
      setError(genericError);
    } finally { setBusy(false); }
  };

  const verifySecondFactor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true); setError(null);
    try {
      const attempt = await signIn.attemptSecondFactor({ strategy: secondFactor, code: secondCode });
      if (attempt.status !== "complete" || !attempt.createdSessionId) throw new Error();
      await finalizeReset(attempt.createdSessionId);
    } catch {
      setError(genericError);
    } finally { setBusy(false); }
  };

  if (phase === "complete") {
    return <AuthLayout><div className="w-full space-y-5 rounded-2xl border border-primary/10 bg-card p-8 text-center shadow-xl"><h1 className="font-display text-2xl font-bold">Password updated</h1><p className="text-sm text-muted-foreground">For your security, sign in again to this window.</p><Button className="w-full" onClick={() => window.location.assign(`${basePath}/sign-in`)}>Continue to sign in</Button></div></AuthLayout>;
  }
  const onSubmit = phase === "email" ? requestCode : phase === "code" ? verifyCode : phase === "password" ? savePassword : verifySecondFactor;
  return <AuthLayout><form onSubmit={(event) => void onSubmit(event)} className="w-full space-y-5 rounded-2xl border border-primary/10 bg-card p-8 shadow-xl">
    <div><h1 className="font-display text-2xl font-bold">Reset your password</h1><p className="mt-1 text-sm text-muted-foreground">We will verify your email before changing your password.</p></div>
    {phase === "email" && <label className="block space-y-2 text-sm font-medium">Email<input className="w-full rounded-md border bg-background px-3 py-2" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
    {phase === "code" && <label className="block space-y-2 text-sm font-medium">Email code<input className="w-full rounded-md border bg-background px-3 py-2" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required /></label>}
    {phase === "password" && <label className="block space-y-2 text-sm font-medium">New password<input className="w-full rounded-md border bg-background px-3 py-2" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>}
    {phase === "second-factor" && <><p className="text-sm text-muted-foreground">{secondFactor === "totp" ? "Enter a code from your authenticator app." : secondFactor === "backup_code" ? "Enter one of your recovery codes." : "Enter the verification code sent to your email."}</p><label className="block space-y-2 text-sm font-medium">Verification code<input className="w-full rounded-md border bg-background px-3 py-2" autoComplete="one-time-code" value={secondCode} onChange={(event) => setSecondCode(event.target.value)} required /></label></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={!isLoaded || busy}>{busy ? "Please wait..." : phase === "email" ? "Email reset code" : phase === "code" ? "Verify code" : phase === "password" ? "Update password" : "Verify recovery"}</Button>
    <p className="text-center text-sm"><a className="text-primary hover:underline" href={`${basePath}/sign-in`}>Back to sign in</a></p>
  </form></AuthLayout>;
}

function SignUpPage() {
  let invitationPending = false;
  try {
    invitationPending = Boolean(sessionStorage.getItem(INVITATION_TOKEN_STORAGE_KEY));
  } catch {
    // Clerk's normal signup remains available when session storage is blocked.
  }
  const redirectUrl = getAuthRedirectUrl(
    invitationPending ? `${basePath}/invite` : `${basePath}/dashboard`,
  );
  const invitationRedirect = isInvitationAuthRedirect(redirectUrl, basePath);
  return (
    <AuthLayout>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`}
        forceRedirectUrl={invitationRedirect ? redirectUrl : undefined}
        fallbackRedirectUrl={redirectUrl}
      />
    </AuthLayout>
  );
}

function getAuthRedirectUrl(defaultPath: string): string {
  const requested = new URLSearchParams(window.location.search).get("redirect_url");
  return getSafeAuthRedirectUrl(requested, defaultPath, window.location.origin);
}

const INVITATION_TOKEN_STORAGE_KEY = "aegis_horizon_invitation_token";

interface InvitationTokenState {
  token: string | null;
  error: string | null;
}

function readInvitationToken(): InvitationTokenState {
  let token: string | null = null;
  try {
    const hash = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash);
    token = hashParams.get("token");
    if (token) {
      try {
        sessionStorage.setItem(INVITATION_TOKEN_STORAGE_KEY, token);
      } catch {
        // A wouter navigation to Clerk's sign-in route does not preserve the
        // current fragment. Do not continue with an invitation we cannot
        // safely retain for that navigation.
        return {
          token: null,
          error:
            "This browser cannot preserve the invitation securely. Enable site storage and open the invitation again.",
        };
      }
      // Fragments are not sent to the API, but clear the token from browser
      // history as soon as it has been persisted for the auth redirect.
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    } else {
      token = sessionStorage.getItem(INVITATION_TOKEN_STORAGE_KEY);
    }
  } catch {
    return {
      token: null,
      error:
        "This browser cannot preserve the invitation securely. Enable site storage and open the invitation again.",
    };
  }
  return { token, error: null };
}

function InvitationPage() {
  const [{ token, error: tokenError }] = useState(readInvitationToken);
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useWindowAuth();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const [message, setMessage] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token || tokenError) return;
    void resolveInvitation({ token })
      .then((invitation) => setMessage(`You have been invited to join ${invitation.org.name}.`))
      .catch(() => setMessage("This invitation is invalid or has expired."));
  }, [token, tokenError]);

  if (tokenError || !token) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold font-display">Invitation unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground" data-testid="status-invitation-token">
            {tokenError ??
              "This invitation link is missing its signed token. Ask an organization administrator to resend it."}
          </p>
          <Button className="mt-6" onClick={() => setLocation("/")} data-testid="button-invitation-home">
            Go home
          </Button>
        </div>
      </div>
    );
  }

  if (!isLoaded) return <HomeStatus message="Loading your session..." />;
  if (!isSignedIn) {
    const redirect = `${basePath}/invite`;
    return (
      <AuthLayout>
        <div className="w-full space-y-5 rounded-2xl border border-primary/10 bg-card p-8 text-center shadow-xl">
          <h1 className="font-display text-2xl font-bold">Join your team</h1>
          <p className="text-sm text-muted-foreground">{message ?? "Checking invitation..."}</p>
          <Button className="w-full" onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(redirect)}`)}>Sign in to accept</Button>
          <a className="block text-sm text-primary hover:underline" href={`${basePath}/sign-up`}>Create an account first</a>
        </div>
      </AuthLayout>
    );
  }

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    try {
      const result = await acceptInvitation({ token });
      setSelectedOrgId(result.org.id);
      sessionStorage.removeItem(INVITATION_TOKEN_STORAGE_KEY);
      setLocation("/dashboard", { replace: true });
    } catch {
      setMessage("We could not accept this invitation. Confirm that you signed in with the invited, verified email.");
      setAccepting(false);
    }
  };
  return (
    <AuthLayout>
      <div className="w-full space-y-5 rounded-2xl border border-primary/10 bg-card p-8 text-center shadow-xl">
        <h1 className="font-display text-2xl font-bold">Join your team</h1>
        <p className="text-sm text-muted-foreground">{message ?? "Checking invitation..."}</p>
        <Button className="w-full" disabled={accepting || message?.includes("invalid")} onClick={() => void accept()}>{accepting ? "Joining..." : "Accept invitation"}</Button>
      </div>
    </AuthLayout>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn, user } = useWindowAuth();
  const { data: me, isLoading, isError, refetch } = useGetMe({
    query: {
      enabled: isLoaded && isSignedIn,
      queryKey: getGetMeQueryKey(),
    },
  });

  if (!isLoaded) {
    return <HomeStatus message="Loading your account..." />;
  }
  if (!isSignedIn) {
    return <Landing />;
  }
  if (isError) {
    return (
      <HomeStatus
        message="We could not load your workspace."
        actionLabel="Try again"
        onAction={() => void refetch()}
      />
    );
  }
  if (isLoading || !me) {
    return <HomeStatus message="Loading your workspace..." />;
  }
  if (!belongsToAuthenticatedUser(me.user, user?.clerkId)) {
    return <HomeStatus message="Loading your account..." />;
  }
  if (me.orgs.length === 0) {
    return <NoOrganizationHome />;
  }

  return <Redirect to="/dashboard" />;
}

function HomeStatus({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <img
          src={`${basePath}/logo-icon.png`}
          alt="Aegis Horizon"
          className="mx-auto h-12 w-12 object-contain"
        />
        <p className="text-sm text-muted-foreground">{message}</p>
        {actionLabel && onAction && (
          <Button variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function NoOrganizationHome() {
  const { signOut } = useWindowAuth();
  const [showLanding, setShowLanding] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
      setSignOutError("Your session could not be revoked. Please try again.");
    }
  };

  if (showLanding) {
    return <Landing />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-6 rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
        <img
          src={`${basePath}/logo-icon.png`}
          alt="Aegis Horizon"
          className="mx-auto h-12 w-12 object-contain"
        />
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">Your organization was deleted</h1>
          <p className="text-sm text-muted-foreground">
            Your organization and its data are gone, but your login account is still active.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => setShowLanding(true)}>Continue to landing page</Button>
          <Button
            variant="outline"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
        {signOutError ? <p className="text-sm text-destructive">{signOutError}</p> : null}
        <DeleteAccountDangerZone />
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded, isSignedIn } = useWindowAuth();
  if (!isLoaded) return <HomeStatus message="Loading your session..." />;
  return isSignedIn ? <Shell><Component /></Shell> : <Redirect to="/sign-in" />;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access Aegis Horizon",
          },
        },
        signUp: {
          start: {
            title: "Start building",
            subtitle: "Create your workspace today",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <WindowAuthProvider>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/invite" component={InvitationPage} />
          
          <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
          <Route path="/communications" component={() => <ProtectedRoute component={Communications} />} />
          <Route path="/accounts" component={() => <ProtectedRoute component={Accounts} />} />
          <Route path="/accounts/:accountId" component={() => <ProtectedRoute component={AccountDetail} />} />
          <Route path="/segments" component={() => <ProtectedRoute component={Segments} />} />
          <Route path="/opportunities" component={() => <ProtectedRoute component={Opportunities} />} />
          <Route path="/leads" component={() => <ProtectedRoute component={Leads} />} />
          <Route path="/quotes" component={() => <ProtectedRoute component={Quotes} />} />
          <Route path="/territories" component={() => <ProtectedRoute component={Territories} />} />
          <Route path="/forecast" component={() => <ProtectedRoute component={Forecast} />} />
          <Route path="/automation" component={() => <ProtectedRoute component={Automation} />} />
          <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
          <Route path="/documents" component={() => <ProtectedRoute component={Documents} />} />
          <Route path="/signatures/:token" component={Signatures} />
          <Route path="/billing" component={() => <ProtectedRoute component={Billing} />} />
          <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
          
          <Route>
            <div className="flex min-h-screen items-center justify-center bg-background">
              <div className="text-center space-y-4">
                <h1 className="text-4xl font-bold font-display text-foreground">404</h1>
                <p className="text-muted-foreground">Page not found</p>
                <Button onClick={() => setLocation("/")} className="font-display">Go Home</Button>
              </div>
            </div>
          </Route>
        </Switch>
        <Toaster />
        </WindowAuthProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
