import { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useClerk, useUser } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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
  getGetMeQueryOptions,
  useAcceptInvitation,
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { getSafeAuthRedirectUrl, isInvitationAuthRedirect } from "@/lib/auth-redirect";

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
  const redirectUrl = getAuthRedirectUrl(`${basePath}/dashboard`);
  const invitationRedirect = isInvitationAuthRedirect(redirectUrl, basePath);
  return (
    <AuthLayout>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`}
        forceRedirectUrl={invitationRedirect ? redirectUrl : undefined}
        fallbackRedirectUrl={redirectUrl}
      />
    </AuthLayout>
  );
}

function SignUpPage() {
  const redirectUrl = getAuthRedirectUrl(`${basePath}/dashboard`);
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

type InvitationStatus = "confirm" | "accepting" | "error";

function getInvitationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const detail = message.replace(/^HTTP \d+ [^:]+:\s*/, "").trim();
  if (detail.toLowerCase().includes("not valid for this account")) {
    return "This invitation belongs to a different email address. Sign out and use the invited account.";
  }
  if (detail.toLowerCase().includes("verify the invited email")) {
    return "The invited email is not verified on this account. Verify it in Clerk or switch accounts.";
  }
  return detail || "We could not accept this invitation. It may be invalid, expired, or no longer available.";
}

function InvitationAcceptance({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const { isLoaded: userLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const acceptInvitation = useAcceptInvitation();
  const [status, setStatus] = useState<InvitationStatus>("confirm");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    "your signed-in email";
  const returnUrl = `${basePath}/invite`;

  const switchAccount = async () => {
    setSwitchingAccount(true);
    try {
      // Do not clear the invitation token: it is the return context for the
      // next account and is intentionally kept out of auth query URLs.
      await signOut();
      setLocation(`/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`, { replace: true });
    } catch {
      setSwitchingAccount(false);
      setStatus("error");
      setErrorMessage("We could not sign out this account. Please try again.");
    }
  };

  const accept = () => {
    if (status === "accepting" || switchingAccount || !isSignedIn) return;
    setStatus("accepting");
    setErrorMessage(null);
    acceptInvitation.mutate(
      { data: { token } },
      {
        onSuccess: async (result) => {
          // The acceptance endpoint can transfer a pending membership. Remove
          // any pre-acceptance /auth/me result before fetching so Shell cannot
          // immediately restore a stale org selection after navigation.
          queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
          try {
            const freshMe = await queryClient.fetchQuery(
              getGetMeQueryOptions({
                query: {
                  queryKey: getGetMeQueryKey(),
                  staleTime: 0,
                },
              }),
            );
            if (!freshMe.orgs.some((membership) => membership.org.id === result.org.id)) {
              throw new Error("Accepted organization is not present in the refreshed memberships.");
            }
          } catch {
            // Keep the stale result removed. Shell will make a fresh request
            // after navigation instead of flashing the previous user's orgs.
            queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
          }
          try {
            sessionStorage.removeItem(INVITATION_TOKEN_STORAGE_KEY);
          } catch {
            // Ignore storage cleanup failures after the server confirms.
          }
          setSelectedOrgId(result.org.id);
          setLocation("/dashboard", { replace: true });
        },
        onError: (error) => {
          // Keep the token and remain on the invitation route so a recipient
          // can switch to the invited account without losing the link.
          setStatus("error");
          setErrorMessage(getInvitationErrorMessage(error));
        },
      },
    );
  };

  if (!userLoaded || !isSignedIn || !user) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
          <p className="text-sm text-muted-foreground" data-testid="status-invitation-auth">
            Waiting for the account session…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
        {status === "error" ? (
          <>
            <h1 className="text-2xl font-bold font-display">Invitation not accepted</h1>
            <p className="mt-3 text-sm text-muted-foreground" data-testid="status-invitation-error">
              {errorMessage}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Button
                className="w-full"
                onClick={switchAccount}
                disabled={switchingAccount}
                data-testid="button-switch-invitation-account"
              >
                {switchingAccount ? "Signing out…" : "Sign out and use another account"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStatus("confirm");
                  setErrorMessage(null);
                }}
                disabled={switchingAccount}
                data-testid="button-retry-invitation"
              >
                Try this account again
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold font-display">
              {status === "accepting" ? "Accepting invitation" : "Confirm your account"}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {status === "accepting"
                ? "We are verifying this account and selecting the invited organization."
                : "Before accepting, confirm that this is the account you want to use for this invitation."}
            </p>
            <div
              className="mt-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
              data-testid="text-invitation-account-email"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Signed-in email
              </p>
              <p className="mt-1 break-all font-semibold text-foreground">{email}</p>
            </div>
            <Button
              className="mt-6 w-full"
              onClick={accept}
              disabled={status === "accepting" || switchingAccount}
              data-testid="button-accept-invitation"
            >
              {status === "accepting" ? "Accepting…" : `Accept invitation as ${email}`}
            </Button>
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={switchAccount}
              disabled={status === "accepting" || switchingAccount}
              data-testid="button-switch-invitation-account"
            >
              {switchingAccount ? "Signing out…" : "Sign out and use another account"}
            </Button>
            <p className="mt-4 text-xs text-muted-foreground">
              Invitation acceptance is never automatic. If this is not the invited
              email, switch accounts before continuing.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function InvitationPage() {
  const [{ token, error: tokenError }] = useState(readInvitationToken);
  const returnUrl = `${basePath}/invite`;
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();

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

  if (!isLoaded) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
          <p className="text-sm text-muted-foreground" data-testid="status-invitation-loading">
            Loading invitation…
          </p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`;
    const signUpUrl = `/sign-up?redirect_url=${encodeURIComponent(returnUrl)}`;
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold font-display">You’re invited</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in with the invited email, or create your own account to continue.
            Your invitation will be preserved while you switch between forms.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              className="w-full"
              onClick={() => setLocation(signInUrl)}
              data-testid="button-invitation-sign-in"
            >
              Sign in
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation(signUpUrl)}
              data-testid="button-invitation-sign-up"
            >
              Create an account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <InvitationAcceptance token={token} />
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const nextUserId = userId ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== nextUserId) {
      // Query keys are shared by the generated client. Clear them before the
      // next identity can render, and never carry an org selection across
      // accounts.
      queryClient.clear();
      setSelectedOrgId(null);
    }
    prevUserIdRef.current = nextUserId;
  }, [isLoaded, queryClient, setSelectedOrgId, userId]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Shell>
          <Component />
        </Shell>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
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
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
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
