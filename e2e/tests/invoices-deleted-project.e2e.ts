import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": getCsrfToken() },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function createInvoice(request: APIRequestContext, data: Record<string, unknown>): Promise<{ id: string; invoiceNumber: string }> {
  const res = await request.post(`${API}/invoices`, {
    data: { lineItems: [{ description: "Orphan check", quantity: 1, unitPrice: 5000 }], ...data },
    headers: { "x-csrf-token": getCsrfToken() },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; invoiceNumber: string };
}

test.describe("Invoices when their project is deleted", () => {
  test("unpaid invoices go with the project, paid ones stay reachable", async ({ request, page }) => {
    const projectId = await createProject(request, `Delete With Invoices ${Date.now()}`);
    const unpaid = await createInvoice(request, { projectId });
    const paid = await createInvoice(request, { projectId });
    const markPaid = await request.put(`${API}/invoices/${paid.id}`, {
      data: { status: "paid" },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(markPaid.ok()).toBeTruthy();

    const del = await request.delete(`${API}/projects/${projectId}`, {
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(del.ok()).toBeTruthy();

    // The unpaid invoice no longer counts anywhere.
    expect((await request.get(`${API}/invoices/${unpaid.id}`)).status()).toBe(404);

    // The paid one is kept as a record with no project.
    const kept = await request.get(`${API}/invoices/${paid.id}`);
    expect(kept.ok()).toBeTruthy();
    expect(((await kept.json()) as { projectId: string | null }).projectId).toBeNull();

    const none = await request.get(`${API}/invoices?projectId=none&limit=100`);
    expect(none.ok()).toBeTruthy();
    const ids = ((await none.json()) as { data: { id: string }[] }).data.map((i) => i.id);
    expect(ids).toContain(paid.id);
    expect(ids).not.toContain(unpaid.id);

    // And it can be opened from the "Invoices without a project" page.
    await page.goto("/dashboard/invoices");
    await expect(page.getByRole("heading", { name: "Invoices without a project" })).toBeVisible();
    await expect(page.getByText(paid.invoiceNumber).first()).toBeVisible({ timeout: 15000 });
  });

  test("an invoice made without a project is listed on the unassigned page", async ({ request, page }) => {
    const inv = await createInvoice(request, {});
    await page.goto("/dashboard/invoices");
    await expect(page.getByText(inv.invoiceNumber).first()).toBeVisible({ timeout: 15000 });
  });
});
