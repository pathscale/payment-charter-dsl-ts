import { describe, expect, test } from "bun:test";
import { emit } from "../src/emit.ts";
import type { Charter } from "../src/types.ts";

const SOL = "mint://USDC/Circle/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const ETH = "mint://USDC/Circle/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/eip155:1";

const pettyCash: Charter = {
  charter: "assistant",
  version: 1,
  resolver: { tier: "common", version: 41 },
  timezone: "UTC-05:00",
  declarations: [
    { kind: "limit", name: "petty_cash",
      dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
      window: { type: "fixed", unit: "month", timezone: "UTC-05:00" },
      scope: "agent",
      escalations: [
        { trigger: { type: "when_exhausted" }, quorum: 1, approvers: "owner",
          ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" },
          within: { count: 3, unit: "days" } },
        { trigger: { type: "at_least", amount: "50.00", asset: "USDC_solana" },
          quorum: 1, approvers: "owner",
          ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" },
          within: { count: 3, unit: "days" } },
      ] },
    { kind: "approvers", name: "owner", members: ["sam"] },
    { kind: "asset", name: "USDC_solana", reference: SOL },
  ],
};

describe("canonical form", () => {
  test("emits the grounding case exactly", () => {
    expect(emit(pettyCash)).toBe(
`charter assistant version 1
resolver common@41
timezone UTC-05:00

  asset USDC_solana = ${SOL}

  approvers owner = { sam }

  limit petty_cash
    amount 100.00 USDC_solana
    per fixed month in UTC-05:00
    scope agent
    escalate at least 50.00 USDC_solana require 1 of owner up to 2000.00 USDC_solana within 3 days
    escalate when exhausted require 1 of owner up to 2000.00 USDC_solana within 3 days
`);
  });

  test("declaration order in the input does not reach the output", () => {
    // The input above lists limit, approvers, asset. Canonical order is the reverse, and
    // sorting is what makes the output a function of the meaning rather than of the typing.
    const shuffled: Charter = { ...pettyCash, declarations: [...pettyCash.declarations].reverse() };
    expect(emit(shuffled)).toBe(emit(pettyCash));
  });

  test("escalations sort with the threshold first and exhaustion last", () => {
    const out = emit(pettyCash).split("\n");
    const atLeast = out.findIndex((l) => l.includes("at least"));
    const exhausted = out.findIndex((l) => l.includes("when exhausted"));
    expect(atLeast).toBeLessThan(exhausted);
  });

  test("ends with exactly one newline and has no trailing whitespace", () => {
    const s = emit(pettyCash);
    expect(s.endsWith("\n")).toBe(true);
    expect(s.endsWith("\n\n")).toBe(false);
    for (const line of s.split("\n")) expect(line).toBe(line.replace(/\s+$/, ""));
  });

  test("nothing wraps, however long the reference", () => {
    // §1.2 forbids wrapping: a column budget would make the canonical form depend on a setting.
    const line = emit(pettyCash).split("\n").find((l) => l.includes("mint://"))!;
    expect(line).toContain(SOL);
  });
});

describe("money scaling", () => {
  const decimals = { USDC_solana: 6 };

  test("pads to the asset's declared digits", () => {
    const c: Charter = { ...pettyCash, declarations: [
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "spend",
        dimension: { type: "amount", amount: "100", asset: "USDC_solana" },
        window: { type: "fixed", unit: "day" } },
    ]};
    expect(emit(c, { decimals })).toContain("amount 100.000000 USDC_solana");
  });

  test("refuses to round rather than losing a digit", () => {
    // E202: a literal that cannot be represented exactly is an error, never a rounding.
    const c: Charter = { ...pettyCash, declarations: [
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "spend",
        dimension: { type: "amount", amount: "1.1234567", asset: "USDC_solana" },
        window: { type: "fixed", unit: "day" } },
    ]};
    expect(() => emit(c, { decimals })).toThrow(/E202/);
  });

  test("without a decimals map money is emitted as given", () => {
    expect(emit(pettyCash)).toContain("amount 100.00 USDC_solana");
  });
});

describe("conditions", () => {
  const withCondition = (condition: Charter["declarations"][number]): Charter => ({
    ...pettyCash,
    declarations: [{ kind: "asset", name: "USDC_solana", reference: SOL }, condition,
      { kind: "limit", name: "spend",
        dimension: { type: "amount", amount: "1.00", asset: "USDC_solana" },
        window: { type: "fixed", unit: "day" } }],
  });

  test("precedence is emitted without defensive parentheses", () => {
    const c = withCondition({ kind: "prohibit", name: "freeze", condition: {
      op: "and",
      left: { op: "compare", field: "date", operator: "after", value: { type: "date", date: "2026-12-20" } },
      right: { op: "compare", field: "date", operator: "before", value: { type: "date", date: "2027-01-02" } },
    }});
    expect(emit(c)).toContain(
      "prohibit freeze when date after 2026-12-20 and date before 2027-01-02");
  });

  test("or under and is parenthesised, because precedence requires it", () => {
    const c = withCondition({ kind: "prohibit", name: "p", condition: {
      op: "and",
      left: { op: "or",
        left: { op: "compare", field: "merchant.country", operator: "is", value: { type: "literal", literal: "country:PRK" } },
        right: { op: "compare", field: "merchant.country", operator: "is", value: { type: "literal", literal: "country:IRN" } } },
      right: { op: "compare", field: "provenance", operator: "is at least", value: { type: "plane", plane: "merchant" } },
    }});
    expect(emit(c)).toContain(
      "prohibit p when (merchant.country is country:PRK or merchant.country is country:IRN) and provenance is at least merchant");
  });

  test("sets are { a, b, c } and keep source order", () => {
    const c = withCondition({ kind: "prohibit", name: "p", condition: {
      op: "compare", field: "merchant.category", operator: "in",
      value: { type: "set", items: [
        { type: "literal", literal: "mcc:5411" },
        { type: "literal", literal: "mcc:5422" },
      ] },
    }});
    expect(emit(c)).toContain("merchant.category in { mcc:5411, mcc:5422 }");
  });
});

describe("asset groups", () => {
  test("a group emits after assets and before limits", () => {
    const c: Charter = {
      charter: "multichain", version: 1,
      resolver: { tier: "full", version: 41 }, timezone: "UTC",
      declarations: [
        { kind: "limit", name: "monthly",
          dimension: { type: "amount", amount: "100.00", asset: "USDC_circle_group" },
          window: { type: "fixed", unit: "month" } },
        { kind: "asset_group", name: "USDC_circle_group", members: ["USDC_ethereum", "USDC_solana"] },
        { kind: "asset", name: "USDC_solana", reference: SOL },
        { kind: "asset", name: "USDC_ethereum", reference: ETH },
      ],
    };
    expect(emit(c)).toBe(
`charter multichain version 1
resolver full@41
timezone UTC+00:00

  asset USDC_ethereum = ${ETH}
  asset USDC_solana = ${SOL}

  asset group USDC_circle_group = { USDC_ethereum, USDC_solana }

  limit monthly
    amount 100.00 USDC_circle_group
    per fixed month
`);
  });
});
