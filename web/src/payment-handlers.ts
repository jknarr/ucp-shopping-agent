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
