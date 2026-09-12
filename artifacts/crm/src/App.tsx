import { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useClerk } from '@clerk/react';
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
import InvitationSignup from "@/pages/InvitationSignup";
import { Button } from "@/components/ui/button";
import {
  getGetMeQueryKey,
  getGetMeQueryOptions,
  useGetMe,
} from "@workspace/api-client-react";
import { useOrgStore } from "@/store/org-store";
import { getSafeAuthRedirectUrl, isInvitationAuthRedirect } from "@/lib/auth-redirect";
import { belongsToAuthenticatedUser } from "@/lib/auth-scope";
import { DeleteAccountDangerZone } from "@/components/settings/DeleteAccountDangerZone";

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

function InvitationPage() {
  const [{ token, error: tokenError }] = useState(readInvitationToken);
  const [, setLocation] = useLocation();

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

  return <InvitationSignup token={token} />;
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
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { data: me, isLoading, isError, refetch } = useGetMe({
    query: {
      enabled: isLoaded && isSignedIn === true && Boolean(userId),
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
  if (!belongsToAuthenticatedUser(me.user, userId)) {
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
  const { signOut } = useClerk();
  const [showLanding, setShowLanding] = useState(false);

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
            onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
          >
            Sign out
          </Button>
        </div>
        <DeleteAccountDangerZone />
      </div>
    </div>
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
