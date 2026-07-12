import { strict as assert } from "node:assert";
import { isPurchaseConfirmation } from "../src/payment-handlers.ts";

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
