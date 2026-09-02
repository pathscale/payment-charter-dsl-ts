# payment-charter-dsl-ts

The TypeScript implementation of the [Payment Charter DSL](https://github.com/pathscale/payment-charter-dsl):
types, JSON Schema, and the **emitter**.

The specification and the conformance corpus live in the
[spec repo](https://github.com/pathscale/payment-charter-dsl) and are normative.
[`payment-charter-dsl-rs`](https://github.com/pathscale/payment-charter-dsl-rs) is the reference
implementation; this one follows it.

## Scope, and the order it is built in

**1. Types and JSON Schema.** The `.charter.json` wire form, generated from or checked against
the schema in the spec repo.

**2. The emitter.** The browser builds a typed charter object and has to *render* it as text so a
controller can read, download and diff the thing they are about to authorise. A charter that can
only be inspected as JSON is a charter nobody reviews.

The emitter produces the **canonical text form** (§1.1) — exact indentation, clause order,
declaration order, spacing around `=` and `@`. That is what makes it verifiable: emit from
TypeScript, re-parse in Rust, and compare bytes. A semantic comparison would let the two
emitters diverge in every respect a human actually reads.

**3. A parser — last, and only if it is cheap.** Deferred deliberately. Emitting is mechanical;
parsing carries the entire error catalogue (E1xx–E4xx), the overlap analysis and the resolver
checks, which is a second full implementation of the expensive half. Pasted charter text can go
to the backend, and a controller pastes one rarely.

So: finish the emitter, measure what a parser would actually cost against the corpus, and build
it only if that number is small. If it is not, it does not get built, and that is not a gap.

## Why the emitter is the cheap half to verify

It round-trips through the Rust parser. The corpus does the work:

```
roundtrip/*.charter    text → JSON → text, byte-identical
```

Emit each fixture from TypeScript, parse it with Rust, compare. No separate TypeScript
conformance suite is needed for the emitter, which is most of why it comes first.

## Licence

Dual [Apache-2.0](LICENSE-APACHE) / [MIT](LICENSE-MIT), at your option.
