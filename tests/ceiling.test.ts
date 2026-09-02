/**
 * S5 and S5.1, and the decimal arithmetic they rest on.
 *
 * The claim this language makes is that the maximum a charter can authorise is computable by
 * reading it. These are the functions that compute it, so a wrong answer here is a wrong number
 * shown to whoever is deciding whether to sign.
 */

import { describe, expect, test } from "bun:test";
import { addDecimal, compareDecimal, declaredCeilings, documentCeiling } from "../src/ceiling.js";
import type { Charter } from "../src/types.js";

const SOL = "mint://USDC/Circle/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function charterWith(declarations: Charter["declarations"]): Charter {
  return {
    charter: "t", version: 1,
    resolver: { tier: "common", version: 41 },
    timezone: "UTC+00:00",
    declarations,
  };
}

describe("compareDecimal", () => {
  test("orders by magnitude, not by string length", () => {
    expect(compareDecimal("100.00", "99.99")).toBeGreaterThan(0);
    expect(compareDecimal("9.99", "100.00")).toBeLessThan(0);
  });

  test("pads fractions so .5 beats .45", () => {
    expect(compareDecimal("0.5", "0.45")).toBeGreaterThan(0);
    expect(compareDecimal("1.10", "1.1")).toBe(0);
  });

  test("ignores leading zeros", () => {
    expect(compareDecimal("007.00", "7")).toBe(0);
  });

  test("stays exact past 2^53, which is why money is a string at all", () => {
    // 9007199254740993 is the first integer a double cannot represent; as a Number it equals
    // 9007199254740992, so a numeric comparison would call these two equal.
    expect(compareDecimal("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
  });
});

describe("addDecimal", () => {
  test("carries", () => {
    expect(addDecimal("0.99", "0.01")).toBe("1.00");
    expect(addDecimal("999.99", "0.01")).toBe("1000.00");
  });

  test("aligns fractions of different widths", () => {
    expect(addDecimal("1.5", "2.25")).toBe("3.75");
  });

  test("whole numbers stay whole", () => {
    expect(addDecimal("20", "3")).toBe("23");
  });

  test("is exact past 2^53", () => {
    expect(addDecimal("9007199254740992", "1")).toBe("9007199254740993");
  });
});

describe("declaredCeilings", () => {
  test("the maximum over the base and every exception (S5)", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "petty_cash",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_solana",
          exceptions: [
            { value: { type: "amount", amount: "5000.00", asset: "USDC_solana" },
              when: { op: "compare", field: "counterparty", operator: "is", value: { type: "literal", literal: "x" } } },
          ] },
        window: { type: "fixed", unit: "month" } },
    ]);
    expect(declaredCeilings(c)).toEqual([
      { limit: "petty_cash", asset: "USDC_solana", autonomous: "5000.00", escalated: "5000.00", inheritsFromParent: false },
    ]);
  });

  test("an escalation raises the escalated figure and not the autonomous one", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "approvers", name: "owner", members: ["sam"] },
      { kind: "limit", name: "petty_cash",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
        window: { type: "fixed", unit: "month" },
        escalations: [
          { trigger: { type: "above", amount: "50.00", asset: "USDC_solana" },
            quorum: 1, approvers: "owner",
            ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" } },
        ] },
    ]);
    expect(declaredCeilings(c)[0]).toMatchObject({ autonomous: "100.00", escalated: "2000.00" });
  });

  test("`unlimited` contributes no figure and is flagged (H4)", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "dept",
        dimension: { type: "amount", amount: "800.00", asset: "USDC_solana",
          exceptions: [
            { value: { type: "unlimited" },
              when: { op: "compare", field: "counterparty", operator: "is", value: { type: "literal", literal: "payroll" } } },
          ] },
        window: { type: "fixed", unit: "month" } },
    ]);
    const [d] = declaredCeilings(c);
    // The declared number stands, and the flag says it is not the whole story: the real ceiling
    // is the parent's, which this document does not contain.
    expect(d).toMatchObject({ autonomous: "800.00", inheritsFromParent: true });
  });

  test("a count limit has no asset", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "rate",
        dimension: { type: "count", count: 20 },
        window: { type: "fixed", unit: "day" } },
    ]);
    expect(declaredCeilings(c)[0]).toEqual({
      limit: "rate", autonomous: "20", escalated: "20", inheritsFromParent: false,
    });
  });
});

describe("documentCeiling", () => {
  test("sums per asset, which is the number no single limit states (S5.1)", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "a",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
        window: { type: "fixed", unit: "month" } },
      { kind: "limit", name: "b",
        dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
        window: { type: "fixed", unit: "month" } },
    ]);
    // W4's case: two hundred-a-month limits on one asset are two hundred a month.
    expect(documentCeiling(c)).toEqual([{ asset: "USDC_solana", total: "200.00" }]);
  });

  test("a count limit contributes nothing, having no asset to contribute to", () => {
    const c = charterWith([
      { kind: "asset", name: "USDC_solana", reference: SOL },
      { kind: "limit", name: "rate", dimension: { type: "count", count: 20 },
        window: { type: "fixed", unit: "day" } },
    ]);
    expect(documentCeiling(c)).toEqual([]);
  });
});
