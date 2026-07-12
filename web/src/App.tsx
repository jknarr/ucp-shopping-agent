import { FormEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  getPaymentHandler,
  isPaymentMethodChangeRequest,
  isPaymentRequest,
  isPurchaseConfirmation,
  loadPaymentHandlers,
  shouldAutoLaunchDeferredPayment,
  type PaymentHandlerDescriptor,
  type PaymentSelection,
} from "./payment-handlers";
import type { Checkout, Message, Product, UcpPostalAddress, UiPayload } from "./types";

const initial: Message = {
  id: "welcome",
  role: "assistant",
  text: "Hi — I’m a standalone UCP shopping agent. Ask me to find something, change your cart, or use a supported payment handler."
};

function money(amount = 0, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

function checkoutAmount(checkout: Checkout, type: string) {
  return checkout.totals.find((entry) => entry.type === type)?.amount ?? 0;
}

function formatShippingAddress(address?: UcpPostalAddress) {
  if (!address) return "Shipping address selected in the payment handler";
  const locality = [address.address_locality, address.address_region, address.postal_code]
    .filter(Boolean)
    .join(", ");
  return [
    [address.first_name, address.last_name].filter(Boolean).join(" "),
    address.street_address,
    address.extended_address,
    locality,
    address.address_country,
  ].filter(Boolean).join(" · ") || "Shipping address selected in the payment handler";
}

function Products({ products, send }: { products: Product[]; send: (text: string) => void }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <article className="product-card" key={product.id}>
          <div className="emoji">{product.metadata?.emoji ?? "🛍️"}</div>
          <div className="eyebrow">{product.id}</div>
          <h3>{product.title}</h3>
          <p>{product.description?.plain}</p>
          <div className="product-footer">
            <strong>{money(product.price_range?.min?.amount, product.price_range?.min?.currency)}</strong>
            <button onClick={() => send(`Add product ${product.id} to my checkout`)}>Add</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function CheckoutCard({
  checkout,
  paymentReview,
}: {
  checkout: Checkout;
  paymentReview?: PaymentSelection["display"];
}) {
  const subtotal = checkoutAmount(checkout, "subtotal");
  const shipping = checkoutAmount(checkout, "fulfillment");
  const tax = checkoutAmount(checkout, "tax");
  const total = checkoutAmount(checkout, "total");
  const instrument = checkout.payment?.instruments?.[0]?.display;
  return (
    <section className={`checkout-card${paymentReview ? " checkout-card--review" : ""}`}>
      <div className="checkout-heading">
        <div>
          <div className="eyebrow">{paymentReview ? "Checkout review" : "Merchant"}</div>
          <h3>
            {checkout.status === "completed"
              ? "Order confirmed"
              : paymentReview
                ? "Review your order and payment"
                : "Order summary"}
          </h3>
        </div>
      </div>
      {checkout.line_items.map((line) => (
        <div className="line" key={line.id}>
          <span>{line.item.image_url} {line.quantity} × {line.item.title}</span>
          <span>{money((line.item.price ?? 0) * line.quantity, checkout.currency)}</span>
        </div>
      ))}
      <div className="price-breakdown">
        <div><span>Items subtotal</span><span>{money(subtotal, checkout.currency)}</span></div>
        <div>
          <span>Shipping</span>
          <span className={shipping === 0 ? "free-shipping" : undefined}>
            {shipping === 0 ? "FREE" : money(shipping, checkout.currency)}
          </span>
        </div>
        <div><span>Estimated tax</span><span>{money(tax, checkout.currency)}</span></div>
        <div className="total"><span>Order total</span><strong>{money(total, checkout.currency)}</strong></div>
      </div>
      {instrument && (
        <p className="safe-payment">{instrument.card_network ?? "Payment card"} ending in {instrument.pan_last_four ?? "••••"}</p>
      )}
      {paymentReview && (
        <div className="payment-review-inline">
          <div className="eyebrow">Payment method returned securely</div>
          <p className="payment-method-line">
            <strong>
              {paymentReview.card_network ?? "Selected card"} ending in{" "}
              {paymentReview.pan_last_four ?? "••••"}
            </strong>
            {paymentReview.buyer_name ? ` · ${paymentReview.buyer_name}` : ""}
          </p>
          <div className="shipping-destination">
            <span className="eyebrow">Ships to</span>
            <strong>{formatShippingAddress(paymentReview.shipping_address)}</strong>
          </div>
          <p className="conversation-prompt">
            If everything looks right, say <strong>“I’m ready to complete the purchase.”</strong>
            You can also ask to change your card.
          </p>
        </div>
      )}
      {checkout.status === "completed" && checkout.order && (
        <div className="order-success">
          <div>
            <strong>Thanks, your order has been placed.</strong>
            <span>Order {checkout.order.id}</span>
          </div>
          {checkout.order.permalink_url && (
            <a className="order-link" href={checkout.order.permalink_url} target="_blank" rel="noreferrer">
              View order details
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function StructuredContent({
  ui,
  send,
  openPayment,
}: {
  ui?: UiPayload | null;
  send: (text: string) => void;
  openPayment: (
    checkout: Checkout,
    handler: string,
    action: "START_FLOW" | "CHANGE_PAYMENT_METHOD",
  ) => void;
}) {
  if (!ui) return null;
  if (ui.kind === "products") return <Products products={ui.products} send={send} />;
  if (ui.kind === "checkout" || ui.kind === "order") return <CheckoutCard checkout={ui.checkout} />;
  if (ui.kind === "payment_action") {
    return (
      <>
        <CheckoutCard checkout={ui.checkout} />
        <button
          className="primary"
          onClick={() =>
            openPayment(
              ui.checkout,
              ui.action.handler,
              ui.action.action_code ?? "START_FLOW",
            )
          }
        >
          Select payment method
        </button>
      </>
    );
  }
  if (ui.kind === "payment_review") {
    return (
      <CheckoutCard
        checkout={ui.checkout}
        paymentReview={ui.selection.display}
      />
    );
  }
  return <div className="profile-ok">Merchant UCP profile discovered and negotiated.</div>;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([initial]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingPaymentReview, setPendingPaymentReview] = useState<
    Extract<UiPayload, { kind: "payment_review" }> | null
  >(null);
  const [paymentHandlerStatus, setPaymentHandlerStatus] = useState<"loading" | "ready" | "error">("loading");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkoutRef = useRef<Checkout | null>(null);
  const paymentHandlerNamesRef = useRef<string[]>([]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [messages, loading]);
  useEffect(() => {
    fetch("/api/payment-handlers")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Payment-handler discovery returned ${response.status}`);
        return response.json() as Promise<{ handlers: PaymentHandlerDescriptor[] }>;
      })
      .then(async ({ handlers }) => {
        await loadPaymentHandlers(handlers);
        paymentHandlerNamesRef.current = handlers.map((handler) => handler.name);
        setPaymentHandlerStatus("ready");
      })
      .catch((error) => {
        console.warn("Payment-handler initialization failed.", error);
        setPaymentHandlerStatus("error");
      });
  }, []);

  async function send(text: string, options: { paymentAlreadyLaunched?: boolean } = {}) {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: clean }]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, session_id: sessionId })
      });
      const body = await response.json() as { session_id?: string; text?: string; ui?: UiPayload; detail?: string };
      if (!response.ok) throw new Error(body.detail ?? `Agent returned ${response.status}`);
      setSessionId(body.session_id ?? null);
      if (body.ui && "checkout" in body.ui) checkoutRef.current = body.ui.checkout;
      const paymentAction = body.ui?.kind === "payment_action" ? body.ui : null;
      const allowDeferredAutoLaunch = shouldAutoLaunchDeferredPayment(
        window.matchMedia("(pointer: coarse)").matches,
      );
      const canLaunchAutomatically = Boolean(
        paymentAction &&
        !options.paymentAlreadyLaunched &&
        allowDeferredAutoLaunch &&
        paymentHandlerStatus === "ready" &&
        getPaymentHandler(paymentAction.action.handler) &&
        ["requires_escalation", "ready_for_complete"].includes(
          paymentAction.checkout.status,
        ),
      );
      const visibleUi = canLaunchAutomatically || (options.paymentAlreadyLaunched && paymentAction)
        ? undefined
        : body.ui;
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: body.text ?? (paymentAction ? "Opening the supported payment handler." : "Done."),
        ui: visibleUi
      }]);
      if (canLaunchAutomatically && paymentAction) {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            launchPayment(
              paymentAction.checkout,
              paymentAction.action.handler,
              paymentAction.action.action_code ?? "START_FLOW",
            );
          }, 0);
        });
      }
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant", text: `I couldn't reach the agent: ${(error as Error).message}`
      }]);
    } finally {
      setLoading(false);
    }
  }

  function launchPayment(
    checkout: Checkout,
    handlerName: string,
    actionCode: "START_FLOW" | "CHANGE_PAYMENT_METHOD",
  ): boolean {
    const handler = getPaymentHandler(handlerName);
    if (!handler || !["requires_escalation", "ready_for_complete"].includes(checkout.status)) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          paymentHandlerStatus === "error"
            ? "The supported payment handler could not initialize. I will not redirect you to the merchant."
            : "The supported payment handler is still initializing. Please try again in a moment.",
      }]);
      return false;
    }
    // A handler must invoke its consumer-present UI synchronously before its
    // first await so this call remains within the Send/Enter user activation.
    handler.select({ checkout, action: actionCode })
      .then((selection: PaymentSelection) => {
        const review: UiPayload = {
          kind: "payment_review",
          handler: handlerName,
          checkout,
          selection,
        };
        setPendingPaymentReview(review);
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          text:
            actionCode === "CHANGE_PAYMENT_METHOD"
              ? "The payment handler returned your updated selection. Review it here before I replace the payment on the checkout."
              : "The payment handler returned your selection. Review it here before I attach it to the checkout.",
          ui: review,
        }]);
      })
      .catch((error: Error) => {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `The browser could not open the payment handler automatically: ${error.message} Use the button below to select a payment method.`,
          ui: {
            kind: "payment_action",
            checkout,
            action: {
              handler: handlerName,
              label: "Payment",
              action_code: actionCode,
            },
          },
        }]);
      });
    return true;
  }

  async function completePaymentAndPurchase(
    ui: Extract<UiPayload, { kind: "payment_review" }>,
    confirmation: string,
  ) {
    const handler = getPaymentHandler(ui.handler);
    if (!handler) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant", text: "The payment handler is no longer available. Please retry the payment flow."
      }]);
      return;
    }
    setInput("");
    setMessages((current) => [...current, {
      id: crypto.randomUUID(), role: "user", text: confirmation,
    }]);
    setLoading(true);
    try {
      const result = await handler.complete({ checkout: ui.checkout, selection: ui.selection });
      const response = await fetch("/api/payment/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handler: ui.handler,
          checkout_id: ui.checkout.id,
          instrument: result.instrument,
        }),
      });
      const body = await response.json() as Checkout & { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? `Payment completion returned ${response.status}`);
      checkoutRef.current = body;
      setPendingPaymentReview(null);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: body.order
          ? `Your purchase is complete. Order **${body.order.id}** was created by the merchant.`
          : "Your purchase was completed by the merchant.",
        ui: { kind: "order", checkout: body },
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant", text: `I couldn't attach the payment: ${(error as Error).message}`
      }]);
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = input.trim();
    if (
      clean &&
      pendingPaymentReview &&
      isPurchaseConfirmation(clean)
    ) {
      void completePaymentAndPurchase(pendingPaymentReview, clean);
      return;
    }
    const checkout = pendingPaymentReview?.checkout ?? checkoutRef.current;
    const handlerName =
      pendingPaymentReview?.handler ?? paymentHandlerNamesRef.current[0];
    const changePaymentMethod = isPaymentMethodChangeRequest(clean);
    if (
      clean &&
      checkout &&
      handlerName &&
      (changePaymentMethod || isPaymentRequest(clean))
    ) {
      const launched = launchPayment(
        checkout,
        handlerName,
        changePaymentMethod ? "CHANGE_PAYMENT_METHOD" : "START_FLOW",
      );
      void send(clean, { paymentAlreadyLaunched: launched });
      return;
    }
    void send(clean);
  }

  return (
    <div className="shell">
      <header>
        <div className="mark">U</div>
        <div><h1>Conversational Commerce Lab</h1><p>Google ADK · UCP 2026-04-08 · Negotiated payment handlers</p></div>
        <span className="live">Standalone agent</span>
      </header>
      <main>
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="avatar">{message.role === "assistant" ? "AI" : "You"}</div>
            <div className="bubble">
              {message.role === "assistant" ? (
                <div className="markdown">
                  <Markdown
                    skipHtml
                    components={{
                      a: ({ children, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer">{children}</a>
                      )
                    }}
                  >
                    {message.text}
                  </Markdown>
                </div>
              ) : (
                <p>{message.text}</p>
              )}
              <StructuredContent
                ui={message.ui}
                send={send}
                openPayment={(checkout, handler, action) => {
                  launchPayment(checkout, handler, action);
                }}
              />
            </div>
          </div>
        ))}
        {loading && <div className="message assistant"><div className="avatar">AI</div><div className="bubble typing">Thinking…</div></div>}
        <div ref={endRef} />
      </main>
      <form onSubmit={submit}>
        <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Message" disabled={loading} />
        <button className="send" disabled={loading || !input.trim()}>Send</button>
      </form>
      <footer>Merchant prices and payment state are authoritative. The model never receives payment credentials.</footer>
    </div>
  );
}
