"use client";

import { useEffect, useState } from "react";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { destinationAfterSignIn } from "@/lib/two-factor-redirect";
import { TwoFactorSetup } from "@/components/two-factor/two-factor-setup";
import { AddPasskey } from "@/components/two-factor/add-passkey";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type Step = "choose" | "passkey-added";

async function goOn(): Promise<void> {
  window.location.href = await destinationAfterSignIn(() => setActiveOrgAndRedirect("/portal/projects"));
}

/** Where staff of a workspace that requires 2FA land until they set it up. No way to skip. */
export function SetupClient({ onCustomDomain }: { onCustomDomain: boolean }): React.ReactElement {
  const [passkeysOffered, setPasskeysOffered] = useState(false);
  const [passkeyRequired, setPasskeyRequired] = useState(false);
  const [step, setStep] = useState<Step>("choose");

  useEffect(() => {
    fetch(`${API_URL}/api/two-factor/status`, { credentials: "include" })
      .then((res: Response) => res.json())
      .then((status: { passkeysOffered?: boolean; passkeyRequired?: boolean }) => {
        setPasskeysOffered(status.passkeysOffered === true && !onCustomDomain);
        setPasskeyRequired(status.passkeyRequired === true);
      })
      .catch((err: unknown) => console.error("Could not load two-factor status", err));
  }, [onCustomDomain]);

  const signOut = async (): Promise<void> => {
    try {
      await fetch(`${API_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "include",
      });
    } catch (err) {
      console.error("Sign out failed", err);
    }
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            {passkeyRequired ? "Add a passkey" : "Set up two-factor authentication"}
          </h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            {passkeyRequired
              ? "Your workspace requires a passkey for staff. From now on you sign in with it: your fingerprint, face or device PIN."
              : "Your workspace requires two-factor for owners and admins. It takes about a minute."}
          </p>
        </div>

        {passkeyRequired && onCustomDomain ? (
          <p className="p-3 text-sm rounded-lg border border-[var(--border)]">
            Passkeys work on the main portal address. Sign in there to add yours.
          </p>
        ) : passkeyRequired && step === "passkey-added" ? (
          <div className="space-y-4">
            <p className="font-medium">Passkey added.</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Add a second one on another device (a phone and a laptop, or a security key), so losing one device
              doesn&apos;t lock you out.
            </p>
            <AddPasskey label="Add another passkey" onAdded={() => setStep("passkey-added")} />
            <button
              type="button"
              onClick={() => void goOn()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]"
            >
              Continue
            </button>
          </div>
        ) : passkeyRequired ? (
          <div className="space-y-2">
            <AddPasskey label="Add a passkey" onAdded={() => setStep("passkey-added")} />
          </div>
        ) : step === "passkey-added" ? (
          <div className="space-y-4">
            <p className="font-medium">Passkey added.</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Add a backup: a second passkey or an authenticator app, so losing this device doesn&apos;t lock you out.
            </p>
            <AddPasskey label="Add another passkey" onAdded={() => setStep("passkey-added")} />
            <div className="space-y-2">
              <p className="text-sm font-medium">Or add an authenticator app</p>
              <TwoFactorSetup onDone={() => void goOn()} />
            </div>
            <button
              type="button"
              onClick={() => void goOn()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]"
            >
              Continue
            </button>
          </div>
        ) : !passkeysOffered ? (
          <TwoFactorSetup onDone={() => void goOn()} />
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="font-medium">Use a passkey</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                Your fingerprint, face or device PIN. The fastest option.
              </p>
              <AddPasskey label="Use a passkey" onAdded={() => setStep("passkey-added")} />
            </div>
            <div className="space-y-2">
              <h2 className="font-medium">Or use an authenticator app</h2>
              <TwoFactorSetup onDone={() => void goOn()} />
            </div>
          </div>
        )}

        <button type="button" onClick={signOut} className="text-sm text-[var(--muted-foreground)] hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );
}
