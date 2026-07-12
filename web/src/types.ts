export type Product = {
  id: string;
  title: string;
  description?: { plain?: string };
  price_range?: { min?: { amount?: number; currency?: string } };
  metadata?: { emoji?: string };
  rating?: { value?: number; count?: number };
};

export type Checkout = {
  id: string;
  status: string;
  currency: string;
  continue_url?: string;
  line_items: Array<{
    id: string;
    item: { id: string; title: string; price?: number; image_url?: string };
    quantity: number;
  }>;
  totals: Array<{ type: string; amount: number; display_text?: string }>;
  payment?: {
    instruments?: Array<{
      display?: { card_network?: string; pan_last_four?: string };
    }>;
  };
  order?: { id: string; permalink_url?: string };
};

export type UiPayload =
  | { kind: "products"; products: Product[] }
  | { kind: "checkout" | "order"; checkout: Checkout }
  | {
      kind: "payment_action";
      checkout: Checkout;
      action: {
        handler: string;
        label: string;
        action_code?: "START_FLOW" | "CHANGE_PAYMENT_METHOD";
      };
    }
  | {
      kind: "payment_review";
      handler: string;
      checkout: Checkout;
      selection: PaymentSelection;
    }
  | { kind: "merchant"; profile: Record<string, unknown> };

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ui?: UiPayload | null;
};
// UCP-shaped address fields follow the pinned 2026-04-08 postal-address schema.
export type UcpPostalAddress = {
  extended_address?: string;
  street_address?: string;
  address_locality?: string;
  address_region?: string;
  address_country?: string;
  postal_code?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
};

// This display/selection shape is the platform's browser-plugin host API. UCP
// deliberately leaves each handler's instrument display schema extensible.
export type PaymentDisplay = {
  label?: string;
  card_network?: string;
  pan_last_four?: string;
  buyer_name?: string;
  shipping_address?: UcpPostalAddress;
};

export type PaymentSelection = {
  opaque: unknown;
  display: PaymentDisplay;
};
