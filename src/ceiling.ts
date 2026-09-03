/**
 * S5: the two numbers a charter states, per limit.
 *
 * > Every limit MUST have a computable static ceiling. For `amount`, the maximum over the base
 * > value and every exception value. For `count`, the maximum integer. An escalation raises
 * > this to its `up to` value.
 *
 * The whole value of this language is that the maximum a charter can authorise is computable by
 * reading it, so this is the arithmetic that claim rests on. It lives in the package rather than
 * in whichever application displays a ceiling, because two applications computing it separately
 * are two chances to show a person a number that is not the one being enforced.
 *
 * String arithmetic throughout. Money is a decimal string in the JSON form (§1.1) precisely
 * because `Number` loses exactness above 2^53; parsing it back to take a maximum would
 * reintroduce what that rule removed.
 */

import type { Charter } from "./types.js";

export interface DeclaredCeiling {
  limit: string;
  /** Absent for a `count` limit, which bounds a rate and has no asset (§8.1.3). */
  asset?: string;
  /** The most this limit permits unaccompanied. */
  autonomous: string;
  /** The most it permits with a human approving the exact payment. */
  escalated: string;
  /**
   * True when the limit carries an `unlimited` exception (H4).
   *
   * The figures above then understate what the limit can resolve to: `unlimited` means "this
   * level adds no constraint" and takes the parent's ceiling, a number this document does not
   * contain. A caller displaying a ceiling MUST say so rather than presenting the declared
   * number as the effective one — the word reads as larger than it is, and the figure beside it
   * reads as smaller.
   */
  inheritsFromParent: boolean;
}

/**
 * Every limit's declared ceilings, in declaration order.
 *
 * These are the numbers *this document* states. Where it extends another, the binding ceiling
 * is the minimum over the whole chain (§8A H1), which only something holding the parent can
 * compute — so treat these as upper bounds on the text, never as the effective ceiling.
 */
export function declaredCeilings(charter: Charter): DeclaredCeiling[] {
  const out: DeclaredCeiling[] = [];

  for (const d of charter.declarations) {
    if (d.kind !== "limit") continue;
    const dim = d.dimension;

    let autonomous = dim.type === "amount" ? dim.amount : String(dim.count);
    let inheritsFromParent = false;
    for (const e of dim.exceptions ?? []) {
      const v = e.value;
      if (v.type === "amount") autonomous = maxDecimal(autonomous, v.amount);
      else if (v.type === "count") autonomous = maxDecimal(autonomous, String(v.count));
      // `unlimited` contributes no figure. Folding in the base, as the Rust compiler's fallback
      // does when it has no chain to consult, would state a maximum this limit can exceed.
      else inheritsFromParent = true;
    }

    let escalated = autonomous;
    for (const e of d.escalations ?? []) {
      const c = e.ceiling;
      if (c.type === "amount") escalated = maxDecimal(escalated, c.amount);
      else if (c.type === "count") escalated = maxDecimal(escalated, String(c.count));
      else inheritsFromParent = true;
    }

    out.push({
      limit: d.name,
      ...(dim.type === "amount" ? { asset: dim.asset } : {}),
      autonomous,
      escalated,
      inheritsFromParent,
    });
  }

  return out;
}

/**
 * S5.1: the sum per asset of every limit's escalated ceiling — what the whole charter
 * authorises over a window.
 *
 * > A controller who has written six limits is owed the one number they add up to, because that
 * > number is the answer to "how much can this thing spend", and it is not any of the six
 * > numbers they wrote.
 *
 * A sound upper bound rather than a tight one: S24 guarantees every authorised request draws at
 * least one limit, so total exposure cannot exceed this. A request drawing two limits is counted
 * in both, which over-states and never under-states.
 *
 * A `count` limit contributes nothing — it bounds a rate, not an amount.
 */
export function documentCeiling(charter: Charter): Array<{ asset: string; total: string }> {
  const totals = new Map<string, string>();
  for (const c of declaredCeilings(charter)) {
    if (c.asset === undefined) continue;
    totals.set(c.asset, addDecimal(totals.get(c.asset) ?? "0", c.escalated));
  }
  return [...totals].map(([asset, total]) => ({ asset, total }));
}

function maxDecimal(a: string, b: string): string {
  return compareDecimal(a, b) >= 0 ? a : b;
}

/** Ascending numeric order on two non-negative decimal strings. */
export function compareDecimal(a: string, b: string): number {
  const [aWhole, aFrac] = split(a);
  const [bWhole, bFrac] = split(b);

  // With leading zeros gone, a longer whole part is a larger number, and at equal length a
  // lexicographic comparison of digits is a numeric one.
  if (aWhole.length !== bWhole.length) return aWhole.length - bWhole.length;
  if (aWhole !== bWhole) return aWhole < bWhole ? -1 : 1;

  // Fractions compare left to right once padded to a common length, so .5 beats .45.
  const width = Math.max(aFrac.length, bFrac.length);
  const l = aFrac.padEnd(width, "0");
  const r = bFrac.padEnd(width, "0");
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

/** Exact addition of two non-negative decimal strings, digit by digit. */
export function addDecimal(a: string, b: string): string {
  const [aWhole, aFrac] = split(a);
  const [bWhole, bFrac] = split(b);

  const fracWidth = Math.max(aFrac.length, bFrac.length);
  const l = aWhole + aFrac.padEnd(fracWidth, "0");
  const r = bWhole + bFrac.padEnd(fracWidth, "0");
  const width = Math.max(l.length, r.length);
  const left = l.padStart(width, "0");
  const right = r.padStart(width, "0");

  let carry = 0;
  const digits: string[] = [];
  for (let i = width - 1; i >= 0; i--) {
    const sum = Number(left[i]) + Number(right[i]) + carry;
    digits.unshift(String(sum % 10));
    carry = sum >= 10 ? 1 : 0;
  }
  if (carry) digits.unshift("1");

  const all = digits.join("");
  if (fracWidth === 0) return strip(all);
  const cut = all.length - fracWidth;
  return `${strip(all.slice(0, cut) || "0")}.${all.slice(cut)}`;
}

function split(s: string): [string, string] {
  const [whole = "", frac = ""] = s.split(".");
  return [strip(whole), frac];
}

/** Drop leading zeros, keeping at least one digit. */
function strip(s: string): string {
  const t = s.replace(/^0+(?=\d)/, "");
  return t === "" ? "0" : t;
}
