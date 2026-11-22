"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { usePlanFeatures } from "@/lib/plan-features";
import { ProBadge, UpgradeLink } from "@/components/pro-badge";
import { Link2, Unlink } from "lucide-react";

interface BillcomStatus {
  enabled: boolean;
  sandbox: boolean;
  organizationId: string | null;
  username: string | null;
  webhook: boolean;
}

const DISCONNECTED: BillcomStatus = { enabled: false, sandbox: false, organizationId: null, username: null, webhook: false };

const fieldClass =
  "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm";

export function BillcomSection() {
  const [status, setStatus] = useState<BillcomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [devKey, setDevKey] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const { success, error: showError } = useToast();
  const planFeatures = usePlanFeatures();

  useEffect(() => {
    apiFetch<BillcomStatus>("/payments/billcom/status")
      .then(setStatus)
      .catch(() => setStatus(DISCONNECTED))
      .finally(() => setLoading(false));
  }, []);

  const canSave = username.trim() && password && organizationId.trim() && devKey.trim();

  const handleConnect = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await apiFetch<BillcomStatus>("/payments/billcom/connect", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          organizationId: organizationId.trim(),
          devKey: devKey.trim(),
          sandbox,
        }),
      });
      setPassword("");
      setDevKey("");
      setStatus(res);
      success("Bill.com connected. Clients can now pay invoices from the portal.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to connect Bill.com");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Bill.com? Clients will no longer be able to pay invoices online.")) return;
    setDisconnecting(true);
    try {
      await apiFetch("/payments/billcom/disconnect", { method: "POST" });
      setStatus(DISCONNECTED);
      success("Bill.com disconnected");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading || !planFeatures) {
    return <div className="h-24 bg-[var(--muted)] rounded-lg animate-pulse" />;
  }

  if (!planFeatures.online_payments && !status?.enabled) {
    return (
      <div className="p-4 border border-[var(--border)] rounded-lg space-y-2" data-testid="payments-locked">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Let clients pay invoices online</span>
          <ProBadge />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Connect Bill.com so clients can pay by bank transfer or card from the portal.
        </p>
        <UpgradeLink reason="online-payments" />
      </div>
    );
  }

  if (status?.enabled) {
    return (
      <div className="space-y-3" data-testid="billcom-connected">
        <div className="flex items-center gap-2 p-3 border border-[var(--border)] rounded-lg bg-[var(--muted)]">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-medium">Connected to Bill.com</span>
          {status.username && (
            <span className="text-xs text-[var(--muted-foreground)] truncate">{status.username}</span>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
              status.sandbox
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {status.sandbox ? "Sandbox" : "Live"}
          </span>
        </div>
        {status.sandbox && (
          <p className="text-xs text-yellow-600">
            This is a Bill.com sandbox account, so no real money moves. Connect your live account to take real payments.
          </p>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">
          When a client presses Pay, the invoice is added to your Bill.com account and the client pays on
          Bill.com&apos;s secure page by bank transfer or card. The invoice is marked paid here automatically
          {status.webhook ? " as soon as Bill.com reports it." : " within about 10 minutes."}
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Card and bank payments must be turned on in Bill.com under Settings, Receivables, Online payments.
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <Unlink size={14} />
          {disconnecting ? "Disconnecting..." : "Disconnect Bill.com"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="billcom-connect">
      <p className="text-sm text-[var(--muted-foreground)]">
        Sign in with your Bill.com account so clients can pay invoices from the portal by bank transfer or card.
        Your sign-in and developer key are stored encrypted and never shown again.
      </p>
      <div className="space-y-2">
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Bill.com email</span>
          <input
            type="email"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Bill.com password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Organization ID</span>
          <input
            type="text"
            autoComplete="off"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            placeholder="008..."
            className={`${fieldClass} font-mono`}
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Developer key</span>
          <input
            type="password"
            autoComplete="off"
            value={devKey}
            onChange={(e) => setDevKey(e.target.value)}
            className={`${fieldClass} font-mono`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => setSandbox(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
          />
          This is a Bill.com sandbox (test) account
        </label>
        <p className="text-xs text-[var(--muted-foreground)]">
          In Bill.com, the developer key is under Settings, Sync &amp; Integrations, Manage Developer Keys.
          The organization ID starts with 008.
        </p>
      </div>
      <button
        type="button"
        onClick={handleConnect}
        disabled={saving || !canSave}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Link2 size={16} />
        {saving ? "Connecting..." : "Connect Bill.com"}
      </button>
    </div>
  );
}
