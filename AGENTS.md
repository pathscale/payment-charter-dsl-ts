# Working agreement — payment-charter-dsl-ts

The operating contract for **any** coding agent working in this repository. This file is the
single source of truth for the rules: Codex, Cursor and Gemini CLI read `AGENTS.md` natively,
and Claude Code loads it through the `@AGENTS.md` import in [`CLAUDE.md`](CLAUDE.md). **Never
fork these rules into a per-vendor file.**

**TypeScript implementation** of the [Payment Charter DSL](https://github.com/pathscale/payment-charter-dsl):
types, JSON Schema, and the emitter. Built with `bun`.

## Invariants (don't break these)

- **The spec is normative and lives in another repo.** Build against
  [`spec.md`](https://github.com/pathscale/payment-charter-dsl/blob/master/spec.md).
  [`payment-charter-dsl-rs`](https://github.com/pathscale/payment-charter-dsl-rs) is the
  reference implementation; where this one differs, it is this one that is wrong.

- **The emitter comes first and emits the canonical text form (§1.1).** Byte-identical, not
  semantically equivalent. That is what lets it be verified by round-tripping through the Rust
  parser instead of needing its own conformance suite.

- **A parser is deferred, and conditional.** Build it last, and only once the emitter is done
  and the cost is measured and small. Parsing carries the whole error catalogue, the overlap
  analysis and the resolver checks — a second full implementation of the expensive half. If it
  is not cheap, it does not get built, and that is not a gap.

- **`bun` is the package manager** — its lockfile is authoritative. Don't introduce a second one
  by running npm/yarn/pnpm here.

- **`bun run typecheck` must pass.** A build succeeding is not the same as types being sound.

- **No Python.** Not a script, not `python3 -c`, not a heredoc.

- **Docs describe what is true now.** Behaviour change and README change land together.

## Git

- **`master`, never `main`.**
- One change per commit. Substantial work goes on a branch with a PR.
- **No AI attribution.** No `Co-Authored-By` trailers, no "Generated with" lines, anywhere.
- **No copyright, licence or SPDX banners in source.** Licensing lives in the manifest.

## Licence

Dual [Apache-2.0](LICENSE-APACHE) / [MIT](LICENSE-MIT). Contributions are taken under both.
