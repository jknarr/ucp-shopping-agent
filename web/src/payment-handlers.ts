import type { Checkout, PaymentSelection } from "./types";

export type PaymentHandlerDescriptor = {
  name: string;
  label: string;
  config: Record<string, unknown> & { module_url: string };
};

export type { PaymentSelection };

// Platform-owned runtime plugin API. This is intentionally not presented as a
// UCP protocol type; independently hosted handlers implement it structurally.
export type BrowserPaymentHandler = {
  name: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  canSelect?(input: Record<string, string>): Promise<boolean>;
  select(input: {
    checkout: Checkout;
    action: "START_FLOW" | "CHANGE_PAYMENT_METHOD";
    consumer?: Record<string, string>;
  }): Promise<PaymentSelection>;
  complete(input: {
    checkout: Checkout;
    selection: PaymentSelection;
  }): Promise<{ instrument: Record<string, unknown> }>;
};

const handlers = new Map<string, BrowserPaymentHandler>();

export async function loadPaymentHandlers(
  descriptors: PaymentHandlerDescriptor[],
): Promise<void> {
  await Promise.all(descriptors.map(async (descriptor) => {
    const loaded = await import(/* @vite-ignore */ descriptor.config.module_url) as {
      default?: BrowserPaymentHandler;
    };
    const handler = loaded.default;
    if (!handler || handler.name !== descriptor.name) {
      throw new Error(`Payment handler module does not implement ${descriptor.name}`);
    }
    await handler.initialize(descriptor.config);
    handlers.set(descriptor.name, handler);
  }));
}

export function getPaymentHandler(name: string): BrowserPaymentHandler | undefined {
  return handlers.get(name);
}

export function isPaymentMethodChangeRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /\b(change|switch|replace|choose|select|pick|use)\b[^.!?]*\b(card|payment method)\b/.test(normalized) ||
    /\b(another|different|other)\s+(card|payment method)\b/.test(normalized)
  );
}

export function isPaymentRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  // With an existing checkout, these pronouns refer to the current order.
  // Keep this narrow so a named-product request such as "buy the tent" still
  // reaches the agent as a cart mutation instead of opening payment.
  if (
    /^(yes[, ]+)?(please )?(buy|purchase|order) (it|this)( please)?[.!]?$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(not ready|do not|don't|dont|cancel|stop|wait|hold off|not yet)\b/.test(normalized) ||
    /\b(add|remove|delete|quantity|qty|replace|another item|also want|buy|get)\b/.test(normalized) ||
    /\bcontinue shopping\b/.test(normalized)
  ) {
    return false;
  }
  return (
    /\b(pay|payment|check\s*out|checkout)\b/.test(normalized) ||
    /\b(ready|done|finished|all set|no more items|nothing else|that's all|that is all)\b/.test(normalized) ||
    /^(no|nope|nothing else|that's all|that is all|proceed|continue)( please)?[.!]?$/i.test(normalized)
  );
}

export function isPaymentInvitation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /\b(would you like|do you want|are you ready)\b[^.!?]*\b(pay|payment|checkout)\b/.test(
      normalized,
    ) ||
    /\b(proceed|continue|move forward|go ahead)\b[^.!?]*\b(pay|payment|checkout)\b/.test(
      normalized,
    )
  );
}

export function isAffirmativeResponse(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(yes|yep|yeah|yup|sure|ok|okay|absolutely|definitely|affirmative|sounds good|that works|please do|go ahead|do it|let'?s do it|i would|i'?d like to|proceed|continue|ready)( please)?[.!]?$/i.test(
    normalized,
  );
}

export function shouldAutoLaunchDeferredPayment(coarsePointer: boolean): boolean {
  return !coarsePointer;
}

export function isPurchaseConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (
    /\b(not ready|do not|don't|dont|cancel|stop|wait|hold off|not yet|change|edit)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return (
    /\b(ready|confirm|yes|go ahead|place|complete|finish|submit)\b[^.!?]*\b(purchase|order|checkout)\b/.test(normalized) ||
    /\b(purchase|order|checkout)\b[^.!?]*\b(confirm|complete|finish|submit|now)\b/.test(normalized) ||
    /\b(purchase|buy|place|submit|complete|finish)\b\s+(it|this|the (purchase|order))\b/.test(normalized) ||
    /\b(looks?|seems?)\s+(good|right|correct)\b/.test(normalized) ||
    /^(yes|yep|yeah|confirm|confirmed|approved|proceed|go ahead|do it|purchase|buy|place (the )?order|complete|complete (the )?purchase)( please)?[.!]?$/i.test(normalized)
  );
}
