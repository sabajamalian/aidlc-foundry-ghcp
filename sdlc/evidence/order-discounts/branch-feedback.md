# Branch manager feedback, Q3 review (excerpt)

> Collected by the HQ operations team from the monthly branch manager sync.
> Fictional data for the OctoCAT Supply demo.

**Chloe Whiskers, Meowtown Branch**
"The catalog says SmartFeeder One is 25% off, so we budgeted $97.49 a unit. Our last order of 12 came through at $129.99 each. Finance flagged a $390.00 variance and I had to explain it in the QBR. Either the discount is real or the catalog shouldn't show it."

**Tom Pouncer, Tabby Terrace Branch**
"Same thing with the AutoClean Litter Dome. We ordered 4 at the advertised 25% off and got billed list price. I also can't see an order total anywhere in the order screen or the API export, so we reconcile by hand in a spreadsheet."

**HQ Finance (Priya Tailwhip)**
"We have eight open variance tickets that all look like discount not applied. We'd like the system price on the order line to be the source of truth, not whatever the requester types in, and an order total we can reconcile against invoices."

**Platform team note**
"The order Swagger page documents a `totalAmount` field on Order, but integrations report it never shows up in responses."
