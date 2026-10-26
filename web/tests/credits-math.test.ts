import assert from "node:assert/strict";
import { test } from "node:test";
import { affordableSeconds, apply, callCostMilli, needsRecharge, planReset, splitDebit, toMilli } from "../lib/billing/credits-math.ts";

test("calls are billed by the second and rounded up to the next millicredit", () => {
  assert.equal(callCostMilli(60, 1), 1000);
  assert.equal(callCostMilli(90, 1), 1500);
  assert.equal(callCostMilli(1, 1), 17); // 16.67 rounds up
  assert.equal(callCostMilli(60, 1.5), 1500);
  assert.equal(callCostMilli(0, 1), 0);
  assert.equal(callCostMilli(30, 0), 0);
});

test("usage spends plan credits before purchased credits", () => {
  assert.deepEqual(splitDebit({ plan: 500, paid: 2000 }, 1200), { plan: -500, paid: -700 });
  assert.deepEqual(splitDebit({ plan: 5000, paid: 0 }, 1200), { plan: -1200, paid: 0 });
});

test("an empty wallet goes into overdraft on the purchased bucket, never the plan bucket", () => {
  const after = apply({ plan: 0, paid: 100 }, splitDebit({ plan: 0, paid: 100 }, 400));
  assert.deepEqual(after, { plan: 0, paid: -300 });
});

test("a new billing period resets plan credits and keeps purchased credits", () => {
  const before = { plan: 1234, paid: 5000 };
  assert.deepEqual(apply(before, planReset(before, toMilli(300))), { plan: 300000, paid: 5000 });
});

test("call length is capped by the balance, with a one-minute floor, and refused at zero", () => {
  assert.equal(affordableSeconds({ plan: 0, paid: 0 }, 1, 900), 0);
  assert.equal(affordableSeconds({ plan: 0, paid: -50 }, 1, 900), 0);
  assert.equal(affordableSeconds({ plan: 5000, paid: 0 }, 1, 900), 300);
  assert.equal(affordableSeconds({ plan: 100, paid: 0 }, 1, 900), 60);
  assert.equal(affordableSeconds({ plan: 999000, paid: 0 }, 1, 900), 900);
});

test("auto top-up triggers below the threshold", () => {
  assert.equal(needsRecharge({ plan: 0, paid: toMilli(9.9) }, 10), true);
  assert.equal(needsRecharge({ plan: toMilli(5), paid: toMilli(5) }, 10), false);
});
