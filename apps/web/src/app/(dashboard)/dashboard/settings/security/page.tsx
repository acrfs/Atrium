"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SecuritySection } from "@/components/two-factor/security-section";
import type { TwoFactorStatus } from "@/components/two-factor/security-section";

/** Owner-only: "Require 2FA for staff" for the active workspace. */
function RequirementToggle({ status }: { status: TwoFactorStatus }): React.ReactElement {
  const [required, setRequired] = useState<boolean>(status.workspaceRequires);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ required: boolean }>("/two-factor/requirement", {
        method: "PUT",
        body: JSON.stringify({ required: next }),
      });
      setRequired(result.required);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] p-6">
      <div>
        <h2 className="text-lg font-semibold">Require two-factor for staff</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Owners and admins of this workspace must use two-factor. Anyone without it is asked to set it up the next
          time they sign in. Clients are never required to.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={required}
          disabled={busy || (!required && !status.enabled)}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Require two-factor for owners and admins
      </label>
      {!required && !status.enabled && (
        <p className="text-xs text-[var(--muted-foreground)]">Turn on two-factor for your own account first.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

/** Owner-only: "Require passkeys for staff" for the active workspace. */
function PasskeyRequirementToggle({ status }: { status: TwoFactorStatus }): React.ReactElement {
  const [required, setRequired] = useState<boolean>(status.workspaceRequiresPasskey);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canTurnOn: boolean = status.passkeysOffered && status.passkeyCount > 0;

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ required: boolean }>("/two-factor/passkey-requirement", {
        method: "PUT",
        body: JSON.stringify({ required: next }),
      });
      setRequired(result.required);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] p-6">
      <div>
        <h2 className="text-lg font-semibold">Require passkeys for staff</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Owners, admins and developers of this workspace must sign in with a passkey. Anyone without one is asked to
          add one the next time they sign in, and the authenticator app alone no longer gets them in. Clients are
          never required to.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={required}
          disabled={busy || (!required && !canTurnOn)}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Require passkeys for staff
      </label>
      {!required && !canTurnOn && (
        <p className="text-xs text-[var(--muted-foreground)]">Add a passkey to your own account first.</p>
      )}
      {required && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Lost every passkey? An owner can reset another person&apos;s sign-in from Team. An owner who is locked out
          needs whoever runs the server to run the disable-2fa script with --passkeys, then adds a new passkey at the
          next sign-in.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export default function SecuritySettingsPage(): React.ReactElement {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const onChange = useCallback((next: TwoFactorStatus): void => setStatus(next), []);

  return (
    <div className="space-y-6">
      <SecuritySection onChange={onChange} />
      {status?.isOwner && <RequirementToggle key={String(status.enabled)} status={status} />}
      {status?.isOwner && <PasskeyRequirementToggle key={`pk-${status.passkeyCount}`} status={status} />}
    </div>
  );
}
