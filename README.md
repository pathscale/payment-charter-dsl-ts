# payment-charter-dsl-ts

TypeScript types, the JSON Schema, and the **canonical-text emitter** for the
[Payment Charter DSL](https://github.com/pathscale/payment-charter-dsl).

```ts
import { emit, type Charter } from "@pathscale/payment-charter-dsl";

const text = emit(charter);   // the canonical text form, byte-exact (spec §1.2)
```

## Zero runtime dependencies, and none are coming

- **No date library.** Dates are `YYYY-MM-DD` strings and timezones are `UTC±HH:MM` strings
  (§2.9). There are no IANA zone names and no daylight saving, so there is nothing for
  `Temporal` or `date-fns` to do.
- **No bignum.** Money is a decimal string carrying the digits the author wrote, at the asset's
  scale, so emission is padding rather than arithmetic. No `BigInt`, no `Number`, and no
  opportunity for a floating-point answer in the one field where a silently wrong value is a
  wrong payment.
- **No validator.** The backend parses what this emits, so it is already the validator. `ajv`
  in the browser would duplicate it and disagree with it.
- **No parser.** See below.

## Why money is a string

§2.6 caps assets at nine decimals, which keeps money inside `u64` — and *not* inside 2^53. A
nine-decimal asset crosses `9007199254740992` minor units at about nine million tokens, which is
a limit somebody will write. JSON numbers are IEEE-754 doubles wherever JavaScript reads them,
and JCS (RFC 8785), which §12 signs over, defines number serialisation in exactly those terms.

As a number the rule would be "a JSON number, except above nine million tokens of a nine-decimal
asset, or nine billion of a six-decimal one". As a string it is one sentence.

## What is here and what is not

**Emitter.** The browser builds a typed charter object and has to render it as text so a
controller can read, download and diff the thing they are about to authorise. A charter that can
only be inspected as JSON is a charter nobody reviews.

**No parser, deliberately.** Emitting is mechanical; parsing carries the whole error catalogue
(E1xx–E5xx), the overlap analysis and the resolver checks — a second full implementation of the
expensive half. Pasted charter text goes to the backend, and a controller pastes one rarely. It
comes last and only if it is measured cheap; if it is not, it does not get built, and that is not
a gap.

**No WASM.** Considered and rejected. It would have deleted the drift risk by having one
emitter, but once money became a string the emitter needed no arithmetic and no dependencies —
a few hundred lines of sorting and string building against 150–400KB of wasm and a bundler
integration. Revisit only if the parser is wanted in-browser.

## How it is verified

The emitter has no conformance suite of its own. It round-trips through the Rust parser instead:

```bash
bun test          # unit tests, plus tests/roundtrip.test.ts against payment-charter-dsl-rs
```

`roundtrip.test.ts` emits each fixture and feeds it to `charter-parse` from the Rust repo. Two
independent implementations of one language drift unless something compares them; that file is
the something. It **fails** when the Rust binary is absent, rather than skipping: a
cross-implementation guard that can be skipped will be skipped, in CI or on the day somebody is
in a hurry, and a suite reporting green having compared nothing is worse than no suite. The
cost is that this repository cannot be tested without a Rust toolchain and a sibling checkout,
which is the correct price for the guarantee.

## Consuming it

Built for `pays.online` — SolidJS, rsbuild, bun. `charter.schema.json` is the shared normative
artifact; generate types from it with `json-schema-to-typescript` (already in that project's
toolchain) rather than hand-maintaining a second description of the wire format.

## Licence

Dual [Apache-2.0](LICENSE-APACHE) / [MIT](LICENSE-MIT), at your option.
