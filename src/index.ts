/**
 * The Payment Charter DSL in TypeScript: types, and the canonical-text emitter.
 *
 * There is no parser here, deliberately. Emitting is mechanical; parsing carries the whole
 * error catalogue (E1xx–E5xx), the overlap analysis and the resolver checks, which is a second
 * full implementation of the expensive half. Pasted charter text goes to the backend, and a
 * controller pastes one rarely.
 *
 * Zero runtime dependencies, and none are coming. Dates are `YYYY-MM-DD` strings and timezones
 * are `UTC±HH:MM` strings (§2.9), so there is no date library. Money is a decimal string at the
 * asset's scale (§1.1), so scaling is padding and there is no bignum library.
 */

export { emit, type EmitOptions } from "./emit.ts";
export type * from "./types.ts";
