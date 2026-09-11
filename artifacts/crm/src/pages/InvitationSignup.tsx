import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk, useAuth, useUser } from "@clerk/react";
import { useSignUp } from "@clerk/react/legacy";

import {
  acceptInvitation,
  getGetMeQueryKey,
  getGetMeQueryOptions,
  resolveInvitation as generatedResolveInvitation,
} from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { useOrgStore } from "@/store/org-store";
import {
  clerkSignupErrorMessage,
  createInvitationAcceptanceController,
  formatMissingSignupRequirements,
  hasCaptchaRequirement,
  hasInvitedEmail,
  hasVerifiedInvitedEmail,
  invitationErrorMessage,
  invitationViewState,
  isExistingEmailSignupError,
  parseResolvedInvitation,
  validateSignupFields,
  waitForIdentityToken,
  type InvitationResolutionState,
  type InvitationSignupPhase,
} from "@/lib/invitation-signup";

interface InvitationSignupProps {
  token: string;
}

interface SignupFormState {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

const initialFormState: SignupFormState = {
  firstName: "",
  lastName: "",
  password: "",
  confirmPassword: "",
};

function InvitationCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full rounded-2xl border border-primary/20 bg-card p-7 shadow-xl sm:p-8">
      {children}
    </div>
  );
}

function PageMessage({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <InvitationCard>
      <h1 className="text-2xl font-bold font-display">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground" data-testid="status-invitation-message">
        {message}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </InvitationCard>
  );
}

export default function InvitationSignup({ token }: InvitationSignupProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const setSelectedOrgId = useOrgStore((state) => state.setSelectedOrgId);
  const { isLoaded: authLoaded, isSignedIn, getToken } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const { signOut } = useClerk();
  const {
    isLoaded: signupLoaded,
    signUp,
    setActive,
  } = useSignUp();

  const [resolution, setResolution] = useState<InvitationResolutionState>({
    status: "loading",
  });
  const [phase, setPhase] = useState<InvitationSignupPhase>("form");
  const [form, setForm] = useState<SignupFormState>(initialFormState);
  const [verificationCode, setVerificationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailExists, setEmailExists] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [signupBusy, setSignupBusy] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signoutFailed, setSignoutFailed] = useState(false);
  const [pendingAcceptanceUserId, setPendingAcceptanceUserId] = useState<string | null>(null);
  const [acceptanceRetryNonce, setAcceptanceRetryNonce] = useState(0);
  const signoutAttemptedRef = useRef(false);
  const acceptanceControllerRef = useRef(createInvitationAcceptanceController());

  useEffect(() => {
    const controller = new AbortController();
    setResolution({ status: "loading" });
    setErrorMessage(null);
    setEmailExists(false);
    void generatedResolveInvitation({ token }, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setResolution({
            status: "resolved",
            invitation: parseResolvedInvitation(payload),
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResolution({
            status: "error",
            message: error instanceof Error
              ? error.message
              : "We could not verify this invitation. Please try again.",
          });
        }
      });

    return () => controller.abort();
  }, [token]);

  const invitation = resolution.status === "resolved" ? resolution.invitation : null;
  const matchingEmail = hasInvitedEmail(user, invitation?.email ?? "");
  const verifiedEmail = hasVerifiedInvitedEmail(user, invitation?.email ?? "");
  const viewState = invitationViewState({
    resolution: resolution.status,
    authLoaded,
    userLoaded,
    isSignedIn,
    hasMatchingEmail: matchingEmail,
    hasVerifiedEmail: verifiedEmail,
    signingOut,
    signoutFailed,
    phase,
  });

  const signInUrl = useMemo(
    () => `/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`,
    [],
  );

  const acceptForIdentity = async (expectedUserId: string): Promise<void> => {
    if (!invitation) {
      throw new Error("The invitation is no longer available.");
    }

    const authToken = await waitForIdentityToken(getToken, expectedUserId);
    if (!authToken) {
      throw new Error("The new account session is not ready yet. Please try again.");
    }

    const result = await acceptInvitation(
      { token },
      {
        credentials: "omit",
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    const freshMe = await queryClient.fetchQuery(
      getGetMeQueryOptions({
        query: {
          queryKey: getGetMeQueryKey(),
          staleTime: 0,
        },
        request: {
          credentials: "omit",
          headers: { Authorization: `Bearer ${authToken}` },
        },
      }),
    );
    if (freshMe.user.clerkId !== expectedUserId) {
      throw new Error("The active account changed before this invitation could finish.");
    }
    if (!freshMe.orgs.some((membership) => membership.org.id === result.org.id)) {
      throw new Error("The accepted organization was not present in the refreshed account.");
    }
    const finalAuthToken = await waitForIdentityToken(getToken, expectedUserId, {
      attempts: 4,
      delayMs: 50,
    });
    if (!finalAuthToken) {
      throw new Error("The active account changed before this invitation could finish.");
    }

    try {
      sessionStorage.removeItem("aegis_horizon_invitation_token");
    } catch {
      // The server has accepted the one-time invitation. Storage cleanup is
      // best effort and must not block the authenticated redirect.
    }
    setSelectedOrgId(result.org.id);
    setPhase("complete");
    setLocation("/dashboard", { replace: true });
  };

  useEffect(() => {
    if (
      !invitation ||
      resolution.status !== "resolved" ||
      !authLoaded ||
      !userLoaded ||
      isSignedIn === undefined ||
      !user
    ) {
      return;
    }

    if (verifiedEmail) {
      const expectedUserId = pendingAcceptanceUserId ?? user.id;
      if (expectedUserId !== user.id) {
        setPhase("error");
        setErrorMessage("The active account changed before this invitation could be accepted.");
        return;
      }
      if (!acceptanceControllerRef.current.begin(expectedUserId)) return;
      if (!pendingAcceptanceUserId) setPendingAcceptanceUserId(user.id);
      setPhase("accepting");
      setErrorMessage(null);
      void acceptForIdentity(expectedUserId).catch((error: unknown) => {
        acceptanceControllerRef.current.reset();
        setPhase("error");
        setErrorMessage(invitationErrorMessage(error));
      });
      return;
    }

    // A signed-in account with a different email must never see an owner
    // confirmation or be allowed to accept. Only do this after resolution has
    // authenticated the invitation and only once for this page instance.
    if (!matchingEmail && !signoutAttemptedRef.current) {
      signoutAttemptedRef.current = true;
      setSigningOut(true);
      void signOut()
        .catch(() => {
          setSignoutFailed(true);
          setPhase("error");
          setErrorMessage(
            "We could not sign out the current account. The invitation cannot continue until that account is signed out.",
          );
        })
        .finally(() => setSigningOut(false));
    }
  }, [
    authLoaded,
    invitation,
    isSignedIn,
    matchingEmail,
    resolution.status,
    signOut,
    user,
    userLoaded,
    verifiedEmail,
    pendingAcceptanceUserId,
    acceptanceRetryNonce,
  ]);

  const updateForm = (field: keyof SignupFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      phase !== "form" ||
      !invitation ||
      !signupLoaded ||
      !signUp ||
      !setActive
    ) {
      return;
    }

    const validationError = validateSignupFields(form);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setEmailExists(false);
    setCaptchaRequired(false);
    setSignupBusy(true);

    try {
      const result = await signUp.create({
        emailAddress: invitation.email,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        password: form.password,
      });

      // Passwords are never retained after the account creation request,
      // including when Clerk asks for email verification.
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));

      const emailVerificationPending =
        result.unverifiedFields.some((field) => field === "email_address") ||
        result.verifications.emailAddress.status !== "verified";

      if (emailVerificationPending) {
        try {
          await result.prepareEmailAddressVerification({ strategy: "email_code" });
          setVerificationCode("");
          setSignupBusy(false);
          setPhase("verify");
        } catch (error: unknown) {
          setCaptchaRequired(hasCaptchaRequirement(error));
          setSignupBusy(false);
          setPhase("verify");
          setErrorMessage(clerkSignupErrorMessage(error));
        }
        return;
      }

      if (result.status !== "complete" || !result.createdSessionId || !result.createdUserId) {
        setSignupBusy(false);
        setPhase("error");
        setErrorMessage(formatMissingSignupRequirements(result.missingFields));
        return;
      }

      setPendingAcceptanceUserId(result.createdUserId);
      await setActive({ session: result.createdSessionId });
      setSignupBusy(false);
      setPhase("accepting");
    } catch (error: unknown) {
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
      setSignupBusy(false);
      setPendingAcceptanceUserId(null);
      setCaptchaRequired(hasCaptchaRequirement(error));
      if (isExistingEmailSignupError(error)) {
        setEmailExists(true);
        setPhase("form");
        setErrorMessage(
          "An account already exists for this invited email. Sign in to continue with this invitation.",
        );
      } else {
        setPhase("form");
        setErrorMessage(clerkSignupErrorMessage(error));
      }
    }
  };

  const handleVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      phase !== "verify" ||
      !signupLoaded ||
      !signUp ||
      !setActive ||
      !verificationCode.trim()
    ) {
      return;
    }

    setErrorMessage(null);
    setVerificationBusy(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });
      setVerificationCode("");

      if (result.status !== "complete" || !result.createdSessionId || !result.createdUserId) {
        setVerificationBusy(false);
        setPhase("error");
        setErrorMessage(formatMissingSignupRequirements(result.missingFields));
        return;
      }

      setPendingAcceptanceUserId(result.createdUserId);
      await setActive({ session: result.createdSessionId });
      setVerificationBusy(false);
      setPhase("accepting");
    } catch (error: unknown) {
      setVerificationBusy(false);
      setCaptchaRequired(hasCaptchaRequirement(error));
      setPhase("verify");
      setErrorMessage(clerkSignupErrorMessage(error));
    }
  };

  const resendVerificationCode = async () => {
    if (!signupLoaded || !signUp || resendingCode || verificationBusy) return;
    setResendingCode(true);
    setErrorMessage(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (error: unknown) {
      setCaptchaRequired(hasCaptchaRequirement(error));
      setErrorMessage(clerkSignupErrorMessage(error));
    } finally {
      setResendingCode(false);
    }
  };

  const retryAcceptance = () => {
    if (!user || !verifiedEmail) return;
    acceptanceControllerRef.current.reset();
    setErrorMessage(null);
    setPhase("accepting");
    setAcceptanceRetryNonce((current) => current + 1);
  };

  if (resolution.status === "error") {
    return (
      <AuthLayout>
        <PageMessage
          title="Invitation unavailable"
          message={resolution.message}
          action={
            <Button className="w-full" onClick={() => setLocation("/")} data-testid="button-invitation-home">
              Go home
            </Button>
          }
        />
      </AuthLayout>
    );
  }

  if (viewState === "loading") {
    return (
      <AuthLayout>
        <PageMessage title="Preparing your invitation" message="Checking the invitation securely…" />
      </AuthLayout>
    );
  }

  if (viewState === "signing-out") {
    return (
      <AuthLayout>
        <PageMessage
          title="Preparing your invitation"
          message={
            signingOut
              ? "Signing out the current account so you can create the invited account…"
              : "The current account must be signed out before this invitation can continue."
          }
        />
      </AuthLayout>
    );
  }

  if (viewState === "account-verification") {
    return (
      <AuthLayout>
        <PageMessage
          title="Verify your invited email"
          message="This account has the invited email, but that email is not verified in Clerk. Verify it before accepting this invitation."
          action={
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                signoutAttemptedRef.current = true;
                setSigningOut(true);
                void signOut()
                  .catch(() => {
                    setSignoutFailed(true);
                    setPhase("error");
                    setErrorMessage(
                      "We could not sign out the current account. The invitation cannot continue until that account is signed out.",
                    );
                  })
                  .finally(() => setSigningOut(false));
              }}
            >
              Sign out and use the invitation form
            </Button>
          }
        />
      </AuthLayout>
    );
  }

  if (viewState === "accepting") {
    return (
      <AuthLayout>
        <PageMessage
          title={phase === "complete" ? "Invitation accepted" : "Completing your invitation"}
          message={
            phase === "complete"
              ? "Your organization is ready. Redirecting to your dashboard…"
              : "Verifying the account and refreshing your organization access…"
          }
        />
      </AuthLayout>
    );
  }

  if (viewState === "complete") {
    return (
      <AuthLayout>
        <PageMessage
          title="Invitation accepted"
          message="Your organization is ready. Redirecting to your dashboard…"
        />
      </AuthLayout>
    );
  }

  if (viewState === "error" && !emailExists) {
    return (
      <AuthLayout>
        <PageMessage
          title="Invitation could not continue"
          message={errorMessage ?? "We could not complete this invitation. Please try again."}
          action={
            phase === "error" && verifiedEmail ? (
              <Button className="w-full" onClick={retryAcceptance}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </AuthLayout>
    );
  }

  if (!invitation) {
    return null;
  }

  if (phase === "verify") {
    return (
      <AuthLayout>
        <InvitationCard>
          <h1 className="text-2xl font-bold font-display">Verify your email</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Enter the verification code sent to the invited email address.
          </p>
          <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Invited email
            </p>
            <p className="mt-1 break-all font-semibold text-foreground" data-testid="text-invited-email">
              {invitation.email}
            </p>
          </div>
          <form onSubmit={handleVerification} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-foreground" htmlFor="invitation-code">
              Email verification code
            </label>
            <input
              id="invitation-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              disabled={verificationBusy}
              className="flex h-10 w-full rounded-md border border-primary/20 bg-background px-3 py-2 text-sm tracking-[0.35em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
            <div id="clerk-captcha" data-clerk-captcha aria-live="polite" />
            {captchaRequired ? (
              <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
                Complete the CAPTCHA challenge above, then submit the code again.
              </p>
            ) : null}
            {errorMessage ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-invitation-error">
                {errorMessage}
              </p>
            ) : null}
            <Button className="w-full" type="submit" disabled={!verificationCode.trim() || verificationBusy}>
              Verify email and continue
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              type="button"
              onClick={() => void resendVerificationCode()}
              disabled={resendingCode || verificationBusy}
            >
              {resendingCode ? "Resending…" : "Resend code"}
            </Button>
          </form>
        </InvitationCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <InvitationCard>
        <h1 className="text-2xl font-bold font-display">Create your account</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You’ve been invited to join {invitation.org.name}. Create a new account
          for this invitation.
        </p>
        <form onSubmit={handleSignup} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="invited-email">
              Invited email
            </label>
            <input
              id="invited-email"
              type="email"
              value={invitation.email}
              readOnly
              aria-readonly="true"
              className="mt-2 flex h-10 w-full cursor-not-allowed rounded-md border border-primary/20 bg-muted px-3 py-2 text-sm text-muted-foreground"
              data-testid="input-invited-email"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground" htmlFor="invitation-first-name">
                First name
              </label>
              <input
                id="invitation-first-name"
                value={form.firstName}
                onChange={(event) => updateForm("firstName", event.target.value)}
                disabled={signupBusy}
                autoComplete="given-name"
                className="mt-2 flex h-10 w-full rounded-md border border-primary/20 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground" htmlFor="invitation-last-name">
                Last name
              </label>
              <input
                id="invitation-last-name"
                value={form.lastName}
                onChange={(event) => updateForm("lastName", event.target.value)}
                disabled={signupBusy}
                autoComplete="family-name"
                className="mt-2 flex h-10 w-full rounded-md border border-primary/20 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="invitation-password">
              Password
            </label>
            <input
              id="invitation-password"
              type="password"
              value={form.password}
              onChange={(event) => updateForm("password", event.target.value)}
              disabled={signupBusy}
              autoComplete="new-password"
              minLength={8}
              className="mt-2 flex h-10 w-full rounded-md border border-primary/20 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">Use at least 8 characters.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="invitation-confirm-password">
              Confirm password
            </label>
            <input
              id="invitation-confirm-password"
              type="password"
              value={form.confirmPassword}
              onChange={(event) => updateForm("confirmPassword", event.target.value)}
              disabled={signupBusy}
              autoComplete="new-password"
              minLength={8}
              className="mt-2 flex h-10 w-full rounded-md border border-primary/20 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>

          <div id="clerk-captcha" data-clerk-captcha aria-live="polite" />
          {captchaRequired ? (
            <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
              Complete the CAPTCHA challenge above, then submit the form again.
            </p>
          ) : null}
          {errorMessage ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-invitation-error">
              {errorMessage}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={signupBusy || phase === "accepting" || !signupLoaded}>
            {signupBusy ? "Creating account…" : "Create account and accept invitation"}
          </Button>
          {emailExists ? (
            <Button
              variant="outline"
              className="w-full"
              type="button"
              onClick={() => setLocation(signInUrl)}
            >
              Sign in with this invited email
            </Button>
          ) : null}
        </form>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Your invited email is verified before access is granted.
        </p>
      </InvitationCard>
    </AuthLayout>
  );
}