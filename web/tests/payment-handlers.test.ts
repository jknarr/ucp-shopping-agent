import { strict as assert } from "node:assert";
import {
  isPaymentMethodChangeRequest,
  isPaymentRequest,
  isPurchaseConfirmation,
  shouldAutoLaunchDeferredPayment,
} from "../src/payment-handlers.ts";

assert.equal(shouldAutoLaunchDeferredPayment(false), true);
assert.equal(shouldAutoLaunchDeferredPayment(true), false);

for (const request of [
  "I'm ready to pay",
  "pay with Paze",
  "checkout",
  "no more items",
  "nothing else",
  "that's all",
  "proceed",
]) {
  assert.equal(isPaymentRequest(request), true, `expected payment request: ${request}`);
}

for (const request of [
  "not ready to pay",
  "add another item",
  "I also want to buy the book",
  "continue shopping",
  "what is the total?",
]) {
  assert.equal(isPaymentRequest(request), false, `expected non-payment request: ${request}`);
}

for (const request of ["change my card", "use a different card", "select another payment method"]) {
  assert.equal(
    isPaymentMethodChangeRequest(request),
    true,
    `expected payment-method change: ${request}`,
  );
}

for (const confirmation of [
  "I'm ready to complete the purchase",
  "looks good, purchase it",
  "Everything looks right",
  "buy it",
  "purchase",
  "purchase please",
  "buy",
  "complete",
  "complete please",
  "place the order",
  "yes",
  "go ahead",
  "do it",
  "confirm",
]) {
  assert.equal(
    isPurchaseConfirmation(confirmation),
    true,
    `expected confirmation: ${confirmation}`,
  );
}

for (const rejection of [
  "not ready",
  "don't purchase it",
  "wait",
  "not yet",
  "change my card",
  "edit the order",
  "what is the total?",
]) {
  assert.equal(
    isPurchaseConfirmation(rejection),
    false,
    `expected rejection: ${rejection}`,
  );
}

console.log("Payment confirmation intent tests passed");
