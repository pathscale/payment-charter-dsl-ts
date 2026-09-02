/**
 * Packs the tarball, installs it into a throwaway consumer, and emits a charter through it.
 *
 * `bun test` exercises the source tree; this exercises what actually ships. The two differ
 * in ways that only bite a consumer: a file missing from `files`, an export map that does not
 * resolve, a relative import that kept its `.ts` extension. UI's equivalent caught
 * `tailwind-merge` being a devDependency while 127 shipped files imported it.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REFERENCE = `charter assistant version 1
resolver common@41
timezone UTC-05:00

  asset USDC_solana = mint://USDC/Circle/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp

  approvers owner = { sam }

  limit petty_cash
    amount 100.00 USDC_solana
    per fixed month in UTC-05:00
    scope agent
    escalate at least 50.00 USDC_solana require 1 of owner up to 2000.00 USDC_solana within 3 days
`;

const CONSUMER = `import { emit, type Charter } from "@pathscale/payment-charter-dsl";
const c: Charter = {
  charter: "assistant", version: 1,
  resolver: { tier: "common", version: 41 },
  timezone: "UTC-05:00",
  declarations: [
    { kind: "asset", name: "USDC_solana",
      reference: "mint://USDC/Circle/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
    { kind: "approvers", name: "owner", members: ["sam"] },
    { kind: "limit", name: "petty_cash",
      dimension: { type: "amount", amount: "100.00", asset: "USDC_solana" },
      window: { type: "fixed", unit: "month", timezone: "UTC-05:00" },
      scope: "agent",
      escalations: [{
        trigger: { type: "at_least", amount: "50.00", asset: "USDC_solana" },
        quorum: 1, approvers: "owner",
        ceiling: { type: "amount", amount: "2000.00", asset: "USDC_solana" },
        within: { count: 3, unit: "days" },
      }] },
  ],
};
process.stdout.write(emit(c));
`;

const run = async (cmd: string[], cwd: string) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) {
    console.error(`${cmd.join(" ")} failed:\n${err}`);
    process.exit(1);
  }
  return out;
};

const here = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "charter-smoke-"));
try {
  await run(["bun", "run", "build"], here);
  await run(["bun", "pm", "pack", "--destination", dir], here);

  const tarball = join(dir, "pathscale-payment-charter-dsl-0.1.0.tgz");
  writeFileSync(join(dir, "package.json"), '{"name":"smoke","private":true,"type":"module"}\n');
  writeFileSync(join(dir, "use.ts"), CONSUMER);
  await run(["bun", "add", tarball], dir);

  const got = await run(["bun", "run", "use.ts"], dir);
  if (got !== REFERENCE) {
    console.error("the shipped package emits different bytes than expected");
    console.error(`--- expected ---\n${REFERENCE}--- got ---\n${got}`);
    process.exit(1);
  }
  console.log("smoke: the packed tarball installs, resolves and emits correctly");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
