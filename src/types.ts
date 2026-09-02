/**
 * The JSON form of a charter (spec §1.1).
 *
 * These mirror `charter.schema.json` in the spec repo, which is the normative artifact. When
 * the toolchain can install dev dependencies, generate this file from that schema with
 * `json-schema-to-typescript` rather than editing it — two hand-maintained descriptions of one
 * wire format is the drift the shared corpus exists to catch, and it is cheaper not to create
 * it in the first place.
 *
 * Money is a **decimal string** everywhere it appears, never a number. §2.6 caps assets at
 * nine decimals, which keeps money inside `u64` and *not* inside 2^53 — a nine-decimal asset
 * crosses that at about nine million tokens, which is a limit somebody will write. JSON
 * numbers are IEEE-754 doubles wherever JavaScript reads them, and JCS (RFC 8785), which §12
 * signs over, defines number serialisation in exactly those terms.
 */

/** Digits as the author wrote them, at the asset's scale: `"100.00"`, never `"100000000"`. */
export type Money = string;

/** `UTC`, or `UTC±HH:MM` with quarter-hour minutes in `-12:00 ..= +14:00` (§2.9). */
export type Timezone = string;

export interface Charter {
  charter: string;
  version: number;
  extends?: { charter: string; version: number };
  resolver: { tier: "common" | "full"; version: number };
  timezone: Timezone;
  declarations: Declaration[];
}

export type Declaration =
  | AssetDecl
  | AssetGroupDecl
  | InstrumentDecl
  | GroupDecl
  | ApproversDecl
  | ProhibitDecl
  | LimitDecl;

export interface AssetDecl {
  kind: "asset";
  /** S19/S20: begins with the reference's symbol, never the bare symbol, never ends `_group`. */
  name: string;
  reference: string;
}

export interface AssetGroupDecl {
  kind: "asset_group";
  /** S20.1: ends `_group`, because `amount 100.00 X` is a cap on one chain or on all of them. */
  name: string;
  members: string[];
}

export interface InstrumentDecl {
  kind: "instrument";
  name: string;
  /** S26: an opaque, non-secret handle. Never a credential. */
  reference: string;
}

export interface GroupDecl {
  kind: "group";
  name: string;
  members: string[];
}

export interface ApproversDecl {
  kind: "approvers";
  name: string;
  members: string[];
}

export interface ProhibitDecl {
  kind: "prohibit";
  name: string;
  condition: Condition;
}

export interface LimitDecl {
  kind: "limit";
  name: string;
  dimension: Dimension;
  /** The `for` clause (S23). Absent means every request in this limit's asset. */
  applies?: Condition;
  window: Window;
  scope?: "account" | "agent" | "instrument" | "counterparty";
  escalations?: Escalation[];
}

export type Dimension =
  | { type: "amount"; amount: Money; asset: string; exceptions?: Exception[] }
  | { type: "count"; count: number; exceptions?: Exception[] };

export interface Exception {
  value: Value;
  when: Condition;
}

/** There is no `deny`: prohibition is its own declaration (E103). */
export type Value =
  | { type: "amount"; amount: Money; asset: string }
  | { type: "count"; count: number }
  | { type: "unlimited" };

export type TimeUnit =
  | "second" | "seconds" | "minute" | "minutes"
  | "hour" | "hours" | "day" | "days";

export type Window =
  | { type: "rolling"; count: number; unit: TimeUnit }
  | { type: "fixed"; unit: "day" | "week" | "month" | "year"; timezone?: Timezone };

export interface Escalation {
  trigger: Trigger;
  quorum: number;
  approvers: string;
  ceiling: Value;
  within?: { count: number; unit: TimeUnit };
}

/**
 * `above` fires on `requested > V`; `at_least` on `requested >= V`. Both exist because English
 * does not agree with itself and the difference is one payment (§8.2.3).
 */
export type Trigger =
  | { type: "above" | "at_least"; amount: Money; asset: string }
  | { type: "above" | "at_least"; count: number }
  | { type: "when_exhausted" };

export type Condition =
  | { op: "and" | "or"; left: Condition; right: Condition }
  | { op: "not"; operand: Condition }
  | { op: "compare"; field: Field; operator: Operator; value: ConditionValue };

/** §6. A closed enumeration; adding one is an engine change under review (S2). */
export type Field =
  | "counterparty" | "asset" | "asset.class" | "instrument"
  | "merchant.category" | "merchant.country"
  | "provenance" | "provenance.recipient" | "provenance.amount"
  | "provenance.asset" | "provenance.venue" | "date";

export type Operator =
  | "is" | "is not" | "in" | "not in" | "before" | "after" | "is at least";

export type ConditionValue =
  | { type: "name"; name: string }
  | { type: "literal"; literal: string }
  | { type: "date"; date: string }
  | { type: "plane"; plane: "principal" | "agent" | "merchant" | "network" }
  | { type: "set"; items: ConditionValue[] };
