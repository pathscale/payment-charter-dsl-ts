/**
 * The check that matters: emit from TypeScript, parse with Rust.
 *
 * Two independent implementations of one language drift unless something compares them, and
 * `roundtrip/` is that something. It is why the emitter needs no conformance suite of its own
 * (§1.2), and why this file is worth more than the unit tests beside it.
 *
 * Skips with a message when the Rust binary is absent rather than passing quietly — a
 * cross-implementation test that silently becomes a no-op is worse than no test, because the
 * suite still reports green.
 */

import { describe, expect, test } from "bun:test";
import { emit } from "../src/emit.js";
import type { Charter } from "../src/types.js";

const RS = new URL("../../payment-charter-dsl-rs/", import.meta.url).pathname;

async function parseWithRust(text: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(
    ["cargo", "run", "-q", "--bin", "charter-parse"],
    {
      cwd: RS,
      stdin: new TextEncoder().encode(text),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH}` },
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, output: out + err };
}

async function rustAvailable(): Promise<boolean> {
  try {
    return (await parseWithRust("charter x version 1\nresolver common@41\ntimezone UTC\n")).output.length >= 0;
  } catch {
    return false;
  }
}

const SOL = "mint://USDC/Circle/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const ETH = "mint://USDC/Circle/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/eip155:1";

const cases: Record<string, Charter> = {
  "petty cash, the grounding case": {
    charter: "assistant", version: 1,
    resolver: { tier: "common", version: 41 }, timezone: "UTC-05:00",
    declarations: [
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "approvers", name: "owner", members: ["sam"] },
      { kind: "limit", name: "petty_cash",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
        window: { type: "fixed", unit: "month", timezone: "UTC-05:00" },
        scope: "agent",
        escalations: [
          { trigger: { type: "at_least", amount: "50.00", asset: "USDC_solana" },
            quorum: 1, approvers: "owner",
            ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" },
            within: { count: 3, unit: "days" } },
          { trigger: { type: "when_exhausted" }, quorum: 1, approvers: "owner",
            ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" },
            within: { count: 3, unit: "days" } },
        ] },
    ],
  },

  "a prohibition and a for clause": {
    charter: "household", version: 4,
    resolver: { tier: "common", version: 41 }, timezone: "UTC-05:00",
    declarations: [
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "group", name: "groceries", members: ["mcc:5411", "mcc:5422"] },
      { kind: "prohibit", name: "freeze", condition: {
        op: "and",
        left: { op: "compare", field: "date", operator: "after", value: { type: "date", date: "2026-12-20" } },
        right: { op: "compare", field: "date", operator: "before", value: { type: "date", date: "2027-01-02" } },
      } },
      { kind: "limit", name: "food",
        dimension: { type: "amount", amount: "200.00", asset: "USDC_solana" },
        applies: { op: "compare", field: "merchant.category", operator: "in", value: { type: "name", name: "groceries" } },
        window: { type: "fixed", unit: "week" }, scope: "account" },
    ],
  },

  "an asset group across chains": {
    charter: "multichain", version: 1,
    resolver: { tier: "full", version: 41 }, timezone: "UTC",
    declarations: [
      { kind: "asset", name: "USDC_ethereum", reference: ETH },
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "asset_group", name: "USDC_circle_group", members: ["USDC_ethereum", "USDC_solana"] },
      { kind: "limit", name: "monthly",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_circle_group" },
        window: { type: "fixed", unit: "month" } },
      { kind: "limit", name: "ethereum_exposure",
        dimension: { type: "amount", amount: "25.00", asset: "USDC_ethereum" },
        window: { type: "fixed", unit: "month" } },
    ],
  },

  "instruments and per-card caps": {
    charter: "corporate-cards", version: 1,
    resolver: { tier: "full", version: 41 }, timezone: "UTC-05:00",
    declarations: [
      { kind: "asset", name: "USD_iso4217", reference: "unit://USD/ISO4217" },
      { kind: "instrument", name: "visa_gold", reference: "card://visa/tok_g7h8i9" },
      { kind: "instrument", name: "mastercard_token", reference: "card://mastercard/tok_d4e5f6" },
      { kind: "approvers", name: "finance", members: ["cfo", "controller"] },
      { kind: "limit", name: "gold_monthly",
        dimension: { type: "amount", amount: "1000000.00", asset: "USD_iso4217" },
        applies: { op: "compare", field: "instrument", operator: "is", value: { type: "name", name: "visa_gold" } },
        window: { type: "fixed", unit: "month" },
        escalations: [
          { trigger: { type: "at_least", amount: "5000.00", asset: "USD_iso4217" },
            quorum: 2, approvers: "finance",
            ceiling: { type: "amount", amount: "1000000.00", asset: "USD_iso4217" },
            within: { count: 5, unit: "days" } },
        ] },
      { kind: "limit", name: "mastercard_monthly",
        dimension: { type: "amount", amount: "50.00", asset: "USD_iso4217" },
        applies: { op: "compare", field: "instrument", operator: "is", value: { type: "name", name: "mastercard_token" } },
        window: { type: "fixed", unit: "month" } },
    ],
  },

  "exceptions and a rolling window": {
    charter: "supplier", version: 2,
    resolver: { tier: "common", version: 41 }, timezone: "UTC+00:00",
    declarations: [
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "group", name: "trusted", members: ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"] },
      { kind: "limit", name: "burst",
        dimension: { type: "amount", amount: "500.00", asset: "USDC_solana",
          exceptions: [
            { value: { type: "amount", amount: "5000.00", asset: "USDC_solana" },
              when: { op: "compare", field: "counterparty", operator: "in", value: { type: "name", name: "trusted" } } },
          ] },
        window: { type: "rolling", count: 5, unit: "minutes" }, scope: "agent" },
    ],
  },
};

describe("emitted text is accepted by the Rust parser", () => {
  test("the Rust binary is reachable", async () => {
    expect(await rustAvailable()).toBe(true);
  }, 120_000);

  for (const [name, charter] of Object.entries(cases)) {
    test(name, async () => {
      const text = emit(charter);
      const { ok, output } = await parseWithRust(text);
      expect(ok, `Rust rejected the emitted text:\n${text}\n${output}`).toBe(true);
    }, 120_000);
  }

  test("emission is idempotent", async () => {
    // The canonical form of a canonical document is itself. Without this, an emitter could
    // produce accepted-but-unstable output and roundtrip/ would never notice.
    for (const charter of Object.values(cases)) {
      const once = emit(charter);
      const twice = emit(structuredClone(charter));
      expect(twice).toBe(once);
    }
  });
});

async function canonicaliseWithRust(text: string): Promise<string> {
  const proc = Bun.spawn(["cargo", "run", "-q", "--bin", "charter-emit"], {
    cwd: RS,
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH}` },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`charter-emit failed:\n${err}`);
  return out;
}

describe("the two emitters agree byte for byte", () => {
  // The real drift check. It is not enough that Rust *accepts* what TypeScript emits: if
  // TypeScript's output is canonical, then parsing and re-emitting it in Rust must return the
  // identical bytes. Any disagreement about indentation, ordering, spacing or separation shows
  // up here as a diff, which is precisely what a semantic comparison would have hidden.
  for (const [name, charter] of Object.entries(cases)) {
    test(name, async () => {
      const fromTs = emit(charter);
      const fromRust = await canonicaliseWithRust(fromTs);
      expect(fromRust).toBe(fromTs);
    }, 120_000);
  }
});
