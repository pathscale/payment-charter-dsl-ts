/**
 * The emitter: a charter's JSON form to its **canonical text form** (spec §1.2).
 *
 * Byte-exact, not merely semantically equivalent. Two emitters can agree on every meaning and
 * still disagree on every character a human reads, so `roundtrip/` conformance is a byte
 * comparison and this file is what it compares against.
 *
 * A pure function of its input. No clock, no locale, no environment, no I/O — the same charter
 * emits the same bytes on every machine, which is what makes the comparison meaningful and what
 * lets §12 sign a digest over the result.
 */

import type {
  Charter, Condition, ConditionValue, Declaration, Escalation, Exception,
  LimitDecl, Money, Timezone, Trigger, Value, Window,
} from "./types.js";

export interface EmitOptions {
  /**
   * Decimals per asset name, from the resolver's `common` tier.
   *
   * §1.2 emits money with exactly the asset's declared minor-unit digits — `500.00` for a
   * 2-decimal asset, never `500` or `500.000`. Supply this and the emitter normalises; omit it
   * and money is emitted exactly as given, which is correct when the caller has already scaled
   * it and wrong silently when it has not.
   *
   * Omitting it is the better default for a UI that validates input against the same resolver
   * data, because it keeps this function pure and keeps the resolver in one place.
   */
  decimals?: Readonly<Record<string, number>>;
}

/** Emit the canonical text form. The result always ends with exactly one `\n`. */
export function emit(charter: Charter, options: EmitOptions = {}): string {
  const out: string[] = [];

  // Header: grammar order, one per line, unindented, no blank line between.
  out.push(`charter ${charter.charter} version ${charter.version}`);
  if (charter.extends) {
    out.push(`extends ${charter.extends.charter}@${charter.extends.version}`);
  }
  out.push(`resolver ${charter.resolver.tier}@${charter.resolver.version}`);
  out.push(`timezone ${timezone(charter.timezone)}`);
  out.push("");

  // Declarations grouped by kind in §1.2's order, sorted by identifier within each kind.
  // Sorting is what makes the output a function of the meaning rather than of the author's
  // typing: declaration order is not semantic (§5.2).
  const ORDER = [
    "asset", "asset_group", "instrument", "group", "approvers", "prohibit", "limit",
  ] as const;

  let previousKind: string | null = null;
  for (const kind of ORDER) {
    const group = charter.declarations
      .filter((d) => d.kind === kind)
      .sort((a, b) => byteCompare(a.name, b.name));
    if (group.length === 0) continue;

    // A blank line separates one kind from the next, and separates each limit from the next.
    // Consecutive asset, asset group, instrument, group and approvers declarations are not
    // separated.
    if (previousKind !== null) out.push("");
    previousKind = kind;

    group.forEach((decl, i) => {
      if (i > 0 && (kind === "limit" || kind === "prohibit")) out.push("");
      out.push(...emitDeclaration(decl, options));
    });
  }

  // Exactly one LF at end of input, and no trailing whitespace on any line.
  return out.map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "") + "\n";
}

function emitDeclaration(decl: Declaration, options: EmitOptions): string[] {
  switch (decl.kind) {
    case "asset":
      // One space either side of `=`, and no alignment padding: alignment depends on the
      // widest name in the block, so it rewrites unrelated lines when a name changes.
      return [`  asset ${decl.name} = ${decl.reference}`];
    case "asset_group":
      return [`  asset group ${decl.name} = ${set(decl.members)}`];
    case "instrument":
      return [`  instrument ${decl.name} = ${decl.reference}`];
    case "group":
      return [`  group ${decl.name} = ${set(decl.members)}`];
    case "approvers":
      return [`  approvers ${decl.name} = ${set(decl.members)}`];
    case "prohibit":
      return [`  prohibit ${decl.name} when ${condition(decl.condition)}`];
    case "limit":
      return emitLimit(decl, options);
  }
}

function emitLimit(l: LimitDecl, options: EmitOptions): string[] {
  const out: string[] = [`  limit ${l.name}`];

  // Clauses in grammar order: dimension, its exceptions, `for`, `per`, `scope`, `escalate`.
  if (l.dimension.type === "amount") {
    out.push(`    amount ${money(l.dimension.amount, l.dimension.asset, options)} ${l.dimension.asset}`);
  } else {
    out.push(`    count ${l.dimension.count}`);
  }

  // Exceptions sorted ascending by byte value of their emitted text. S4 forces them disjoint,
  // so their order carries no meaning and sorting costs nothing.
  const exceptions = (l.dimension.exceptions ?? [])
    .map((e) => exception(e, options))
    .sort(byteCompare);
  for (const e of exceptions) out.push(`      ${e}`);

  if (l.applies) out.push(`    for ${condition(l.applies)}`);
  out.push(`    ${window(l.window)}`);
  if (l.scope) out.push(`    scope ${l.scope}`);

  // Threshold triggers first, ascending; `when exhausted` last. S17 makes `above` and
  // `at least` one kind and S15 admits one of each, so no two thresholds can coexist and the
  // sort never has to break a tie.
  const escalations = [...(l.escalations ?? [])].sort((a, b) => {
    const rank = (t: Trigger) => (t.type === "when_exhausted" ? 1 : 0);
    const r = rank(a.trigger) - rank(b.trigger);
    return r !== 0 ? r : byteCompare(triggerText(a.trigger, options), triggerText(b.trigger, options));
  });
  for (const e of escalations) out.push(`    ${escalation(e, options)}`);

  return out;
}

function exception(e: Exception, options: EmitOptions): string {
  return `except ${value(e.value, options)} when ${condition(e.when)}`;
}

function escalation(e: Escalation, options: EmitOptions): string {
  let s = `escalate ${triggerText(e.trigger, options)} require ${e.quorum} of ${e.approvers}`;
  s += ` up to ${value(e.ceiling, options)}`;
  if (e.within) s += ` within ${e.within.count} ${e.within.unit}`;
  return s;
}

function triggerText(t: Trigger, options: EmitOptions): string {
  if (t.type === "when_exhausted") return "when exhausted";
  const keyword = t.type === "above" ? "above" : "at least";
  if ("amount" in t) return `${keyword} ${money(t.amount, t.asset, options)} ${t.asset}`;
  return `${keyword} ${t.count}`;
}

function value(v: Value, options: EmitOptions): string {
  switch (v.type) {
    case "amount":
      return `${money(v.amount, v.asset, options)} ${v.asset}`;
    case "count":
      return String(v.count);
    case "unlimited":
      return "unlimited";
  }
}

function window(w: Window): string {
  if (w.type === "rolling") return `per rolling ${w.count} ${w.unit}`;
  // Durations and calendar units keep the unit the author used: the unit is significant
  // (§8.3) and is not normalised.
  return w.timezone ? `per fixed ${w.unit} in ${timezone(w.timezone)}` : `per fixed ${w.unit}`;
}

/**
 * Money at exactly the asset's declared minor-unit digits.
 *
 * String arithmetic, deliberately. The value is the digits the author wrote, so scaling is
 * padding and truncation of a decimal tail that E202 has already guaranteed is absent — no
 * `Number`, no `BigInt`, and no opportunity for a floating-point answer in the one field where
 * a silently wrong value is a wrong payment.
 */
function money(m: Money, asset: string, options: EmitOptions): string {
  const decimals = options.decimals?.[asset];
  if (decimals === undefined) return m;

  const [whole, fraction = ""] = m.split(".");
  if (fraction.length > decimals) {
    // E202: a literal that cannot be represented exactly is an error, never a rounding.
    throw new RangeError(
      `${m} has ${fraction.length} fractional digits but ${asset} has ${decimals}. ` +
        `A literal that cannot be represented exactly in minor units is an error, never a rounding (E202).`,
    );
  }
  return decimals === 0 ? whole : `${whole}.${fraction.padEnd(decimals, "0")}`;
}

function condition(c: Condition): string {
  return conditionAt(c, 0);
}

/**
 * Precedence is `not` > `and` > `or`, left-associative (§3). Parenthesise only where the
 * structure needs it: a canonical form that parenthesised defensively would emit different
 * bytes for the same meaning depending on how the tree was built.
 */
function conditionAt(c: Condition, parentPrecedence: number): string {
  switch (c.op) {
    case "or": {
      const s = `${conditionAt(c.left, 1)} or ${conditionAt(c.right, 1)}`;
      return parentPrecedence > 1 ? `(${s})` : s;
    }
    case "and": {
      const s = `${conditionAt(c.left, 2)} and ${conditionAt(c.right, 2)}`;
      return parentPrecedence > 2 ? `(${s})` : s;
    }
    case "not":
      return `not ${conditionAt(c.operand, 3)}`;
    case "compare":
      return `${c.field} ${c.operator} ${conditionValue(c.value)}`;
  }
}

function conditionValue(v: ConditionValue): string {
  switch (v.type) {
    case "name":
      return v.name;
    case "literal":
      return v.literal;
    case "date":
      return v.date;
    case "plane":
      return v.plane;
    case "set":
      // Items keep source order: set membership is unordered, but reordering buys nothing and
      // loses the author's grouping.
      return set(v.items.map(conditionValue));
  }
}

/**
 * Always with an explicit offset. `UTC` is accepted on input and means `UTC+00:00` (§2.9);
 * the canonical form is the explicit one, so every timezone in an emitted document has the
 * same shape and a diff compares `UTC+00:00` against `UTC-05:00` rather than against a word.
 */
function timezone(tz: Timezone): string {
  return tz === "UTC" ? "UTC+00:00" : tz;
}

/** `{ a, b, c }`: one space inside each brace, `, ` between items, no trailing comma. */
function set(items: string[]): string {
  return `{ ${items.join(", ")} }`;
}

/**
 * Ascending by byte value, which for this language is every character: §2.4 admits only ASCII
 * in identifiers and there are no escapes anywhere, so there is nothing to normalise first and
 * a code-unit comparison is a byte comparison.
 */
function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
