import { strict as assert } from "node:assert";
import {
  isAffirmativeResponse,
  isPaymentInvitation,
  isPaymentMethodChangeRequest,
  isPaymentRequest,
  isPurchaseConfirmation,
  requiresExplicitPaymentButton,
  shouldAutoLaunchDeferredPayment,
} from "../src/payment-handlers.ts";

assert.equal(
  requiresExplicitPaymentButton(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
    false,
  ),
  true,
);
assert.equal(
  requiresExplicitPaymentButton(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
    false,
  ),
  false,
);
assert.equal(
  requiresExplicitPaymentButton(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1",
    true,
  ),
  true,
);
assert.equal(requiresExplicitPaymentButton("mobile browser", true), false);

for (const invitation of [
  "Would you like to proceed to payment?",
  "Would you like to proceed with payment?",
  "Are you ready to pay?",
  "Do you want to continue to checkout?",
]) {
  assert.equal(isPaymentInvitation(invitation), true, `expected payment invitation: ${invitation}`);
}

for (const response of [
  "yes",
  "yep",
  "sure",
  "okay",
  "sounds good",
  "go ahead",
  "let's do it",
]) {
  assert.equal(isAffirmativeResponse(response), true, `expected affirmative response: ${response}`);
}

for (const response of ["no", "not yet", "yes, add the book", "okay, but change the cart"]) {
  assert.equal(isAffirmativeResponse(response), false, `expected contextual response: ${response}`);
}

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
  "buy it",
  "purchase this",
  "yes, buy it please",
]) {
  assert.equal(isPaymentRequest(request), true, `expected payment request: ${request}`);
}

for (const request of [
  "not ready to pay",
  "add another item",
  "I also want to buy the book",
  "buy the tent",
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
