import assert from "node:assert/strict";
import test from "node:test";
import { AppStore, type AppDatabase } from "./app-store.js";

type State = {
  spaceType: "personal" | "organization";
  role: "owner" | "admin" | "member" | "viewer";
  subscription?: Record<string, unknown>;
  payments: Record<string, Record<string, unknown>>;
  entitlements: Record<string, Record<string, unknown>>;
  auditActions: string[];
};

function makeStore(spaceType: State["spaceType"] = "personal", role: State["role"] = "owner") {
  const state: State = { spaceType, role, payments: {}, entitlements: {}, auditActions: [] };
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("SELECT s.id, s.type, sm.role")) {
      return { rows: [{ id: String(values[1]), type: state.spaceType, role: state.role }] };
    }
    if (sql.includes("SELECT s.id, s.type")) {
      return { rows: [{ id: String(values[1]), type: state.spaceType }] };
    }
    if (sql.includes("SELECT space_id, plan, status, provider, payment_id")) {
      return { rows: state.subscription ? [state.subscription] : [] };
    }
    if (sql.includes("SELECT resource, limit_value, source_plan")) {
      return { rows: Object.values(state.entitlements) };
    }
    if (sql.includes("FROM mlbox_payment_transactions p") && sql.includes("ORDER BY p.created_at")) {
      return { rows: Object.values(state.payments) };
    }
    if (sql.includes("FROM mlbox_payment_transactions p") && sql.includes("WHERE p.id = $2")) {
      const payment = state.payments[String(values[1])];
      return { rows: payment ? [payment] : [] };
    }
    if (sql.includes("FROM mlbox_payment_transactions WHERE space_id")) {
      const payment = Object.values(state.payments).find((item) => item.idempotency_key === values[1]);
      return { rows: payment ? [payment] : [] };
    }
    if (sql.includes("INSERT INTO mlbox_payment_transactions")) {
      const payment = {
        id: values[0], space_id: values[1], plan_id: values[2], subscription_id: values[1], amount_cents: values[3],
        currency: "USD", payment_method: values[4], status: values[5], provider: "mock", failure_code: values[6],
        idempotency_key: values[7], created_by: values[8], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
      };
      state.payments[String(payment.id)] = payment;
      return { rows: [payment] };
    }
    if (sql.includes("INSERT INTO mlbox_space_subscriptions")) {
      const isFree = sql.includes("SELECT sm.space_id");
      state.subscription = {
        space_id: isFree ? values[1] : values[0], plan: isFree ? values[2] : values[1], status: isFree ? "active" : values[2], provider: "mock",
        payment_id: isFree ? null : values[3], started_at: "2026-01-01T00:00:00.000Z", current_period_end: "2026-02-01T00:00:00.000Z",
      };
      return { rows: [state.subscription] };
    }
    if (sql.includes("UPDATE mlbox_space_subscriptions")) {
      if (!state.subscription) return { rows: [] };
      state.subscription.status = "cancelled";
      return { rows: [state.subscription] };
    }
    if (sql.includes("INSERT INTO mlbox_space_entitlements")) {
      state.entitlements[`${values[0]}:${values[1]}`] = { resource: values[1], limit_value: values[2], source_plan: values[3] };
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO mlbox_audit_events")) {
      const action = typeof values[3] === "string" && values[3].startsWith("payment.")
        ? values[3]
        : sql.match(/VALUES \([^)]*'([^']+)'/)?.[1];
      if (action) state.auditActions.push(action);
      return { rows: [] };
    }
    return { rows: [] };
  };
  const database: AppDatabase = {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
  };
  return { store: new AppStore(database), state };
}

test("free activation creates no payment and writes demo entitlements", async () => {
  const { store, state } = makeStore();
  const result = await store.activateFreeSubscription("user-1", "personal:user-1", {
    id: "personal_free", spaceType: "personal", name: "Personal Free", amountCents: 0, currency: "USD", billingInterval: "month", status: "active",
    quotas: { projects: 1, storageGb: 5, cpuHours: 10, gpuHours: 0 },
  });

  assert.equal(result.payment, null);
  assert.equal(Object.keys(state.payments).length, 0);
  assert.equal(result.subscription.plan, "personal_free");
  assert.equal(result.entitlements.find((item) => item.resource === "projects")?.limitValue, 1);
});

test("checkout rejects a plan whose catalog Space type differs from the target Space", async () => {
  const { store, state } = makeStore("organization");

  await assert.rejects(
    store.createMockCheckout("user-1", {
      spaceId: "org-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card", outcome: "succeeded", idempotencyKey: "mismatch-1",
    }),
    /Space type mismatch/,
  );
  assert.equal(Object.keys(state.payments).length, 0);
});

test("checkout rejects an unknown catalog plan before creating a payment", async () => {
  const { store, state } = makeStore();

  await assert.rejects(
    store.createMockCheckout("user-1", {
      spaceId: "personal:user-1", planId: "not-a-plan", amountCents: 800, paymentMethod: "mock_card", outcome: "succeeded", idempotencyKey: "invalid-1",
    }),
    /Invalid subscription plan/,
  );
  assert.equal(Object.keys(state.payments).length, 0);
});

test("successful checkout activates the subscription and records entitlements", async () => {
  const { store, state } = makeStore();

  const result = await store.createMockCheckout("user-1", {
    spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card", outcome: "succeeded", idempotencyKey: "success-1",
  });

  assert.equal(result.payment?.status, "succeeded");
  assert.equal(result.subscription.plan, "personal_plus");
  assert.equal(result.subscription.status, "active");
  assert.equal(result.entitlements.find((item) => item.resource === "storage_gb")?.limitValue, 25);
  assert.deepEqual(Object.keys(state.payments).length, 1);
  assert.ok(state.auditActions.includes("payment.mock_succeeded"));
  assert.ok(state.auditActions.includes("subscription.mock_activated"));
});

test("non-successful outcomes preserve payment status and subscription state", async () => {
  for (const [outcome, subscriptionStatus] of [["pending", "pending"], ["failed", "past_due"], ["cancelled", "cancelled"]] as const) {
    const { store } = makeStore();
    const result = await store.createMockCheckout("user-1", {
      spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_bank_transfer", outcome, idempotencyKey: `outcome-${outcome}`,
    });
    assert.equal(result.payment?.status, outcome);
    assert.equal(result.subscription.status, subscriptionStatus);
    assert.equal(result.entitlements.length, 0);
  }
});

test("repeating an idempotent checkout returns the original payment", async () => {
  const { store, state } = makeStore();
  const input = {
    spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card" as const, outcome: "succeeded" as const, idempotencyKey: "same-request",
  };

  const first = await store.createMockCheckout("user-1", input);
  const second = await store.createMockCheckout("user-1", input);

  assert.equal(second.payment?.id, first.payment?.id);
  assert.equal(Object.keys(state.payments).length, 1);
});

test("failed payment can be retried with a new mock transaction", async () => {
  const { store, state } = makeStore();
  const failed = await store.createMockCheckout("user-1", {
    spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card", outcome: "failed", idempotencyKey: "failed-request",
  });

  const retried = await store.retryMockPayment("user-1", failed.payment!.id, {
    paymentMethod: "mock_invoice", outcome: "succeeded", idempotencyKey: "retry-request",
  });

  assert.notEqual(retried.payment?.id, failed.payment?.id);
  assert.equal(retried.subscription.status, "active");
  assert.equal(Object.keys(state.payments).length, 2);
  assert.ok(state.auditActions.includes("payment.mock_retried"));
});

test("subscription cancellation requires owner/admin and records an audit event", async () => {
  const { store, state } = makeStore();
  await store.createMockCheckout("user-1", {
    spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card", outcome: "succeeded", idempotencyKey: "cancel-request",
  });

  const cancelled = await store.cancelMockSubscription("user-1", "personal:user-1");

  assert.equal(cancelled.status, "cancelled");
  assert.ok(state.auditActions.includes("subscription.mock_cancelled"));
});

test("checkout denies a non-admin Space member", async () => {
  const { store } = makeStore("personal", "member");

  await assert.rejects(
    store.createMockCheckout("user-1", {
      spaceId: "personal:user-1", planId: "personal_plus", amountCents: 800, paymentMethod: "mock_card", outcome: "succeeded", idempotencyKey: "denied-1",
    }),
    /Subscription access denied/,
  );
});
