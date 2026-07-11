# UCP Shopping Agent

A standalone conversational shopping client built with Google Agent Development Kit (ADK). It acts as a buyer-side Universal Commerce Protocol (UCP) platform and discovers merchants through their public UCP profiles.

The initial demo will integrate with the Jimporium demo merchant and exercise:

- UCP business discovery and capability negotiation
- Catalog search and product lookup
- Conversational checkout creation and updates
- A consumer-present Paze payment handoff
- Explicit buyer confirmation and guarded checkout completion
- Structured order confirmation

The agent and chat client are intentionally deployed separately from the merchant. Merchant catalog data, pricing rules, payment verification, and order state remain authoritative on the merchant service.

## Status

Initial repository scaffold. Implementation will be adapted from the official UCP Google ADK/A2A conversational sample while operating as a buyer-side platform over UCP REST.

## Related projects

- [Universal Commerce Protocol](https://github.com/Universal-Commerce-Protocol/ucp)
- [Official UCP samples](https://github.com/Universal-Commerce-Protocol/samples)
- [Google Agent Development Kit](https://adk.dev)
