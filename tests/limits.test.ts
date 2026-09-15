import assert from "node:assert/strict";
import { test } from "node:test";
import { deployableCashNative, gasReserveNative } from "../src/lib/trading/gas";
import { capTicketUsd, limitsFromEnv, liveStartupRefusal, UNLIMITED } from "../src/lib/trading/limits";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import { CHAINS } from "../src/lib/market/chains";

test("nothing is held back when nothing is open", () => {
  assert.equal(gasReserveNative("solana", 0, AGGRESSIVE), 0);
});

test("the reserve covers every open position through a full ladder", () => {
  const legs = AGGRESSIVE.takeProfitLadder.length + 1;
  const expected = CHAINS.solana.fee.flat * 4 * legs * AGGRESSIVE.gasReserveMultiple;
  assert.equal(gasReserveNative("solana", 4, AGGRESSIVE), expected);
});

test("the ticket about to be opened is reserved for too", () => {
  // The failure this exists to prevent: the last of the cash goes into a
  // position and there is nothing left to pay for selling it.
  const cash = gasReserveNative("solana", 3, AGGRESSIVE);
  assert.equal(
    deployableCashNative("solana", cash, 2, AGGRESSIVE),
    0,
    "cash that exactly covers three exits funds no fourth position",
  );
});

test("a comfortable balance is still mostly deployable", () => {
  const deployable = deployableCashNative("solana", 2, 3, AGGRESSIVE);
  assert.ok(deployable > 1.9, `a 2 SOL balance is not eaten by gas, got ${deployable}`);
});

test("unset ceilings leave paper trading untouched", () => {
  const limits = limitsFromEnv({});
  assert.deepEqual(limits, UNLIMITED);
  assert.equal(capTicketUsd(250, 900, limits), 250);
  assert.equal(liveStartupRefusal(limits, 1_800, {}), null);
});

test("a ticket is clamped by both its own ceiling and the room left", () => {
  const limits = { maxTicketUsd: 20, maxDeployedUsd: 80, maxBookUsd: 120 };
  assert.equal(capTicketUsd(50, 0, limits), 20, "the ticket ceiling binds");
  assert.equal(capTicketUsd(20, 70, limits), 10, "the deployed ceiling binds");
  assert.equal(capTicketUsd(20, 80, limits), 0, "full means full");
  assert.equal(capTicketUsd(20, 95, limits), 0, "and over-full is not negative");
});

test("live trading refuses to start without deliberate ceilings", () => {
  const env = { ENABLE_LIVE_TRADING: "yes-i-accept-the-risk" };
  const refusal = liveStartupRefusal(limitsFromEnv(env), 100, env);
  assert.ok(refusal, "unset ceilings must refuse");
  assert.match(refusal, /ceilings/i);
});

test("live trading refuses a wallet holding more than the ceiling", () => {
  const env = {
    ENABLE_LIVE_TRADING: "yes-i-accept-the-risk",
    LIVE_MAX_TICKET_USD: "15",
    LIVE_MAX_DEPLOYED_USD: "80",
    LIVE_MAX_BOOK_USD: "120",
  };
  const limits = limitsFromEnv(env);

  assert.equal(liveStartupRefusal(limits, 108, env), null, "a 100-euro book passes");
  const refusal = liveStartupRefusal(limits, 500, env);
  assert.ok(refusal, "a wallet holding 500 must not be traded under a 120 ceiling");
  assert.match(refusal, /Move funds off the wallet/);
});

test("contradictory ceilings are refused rather than silently reconciled", () => {
  const env = {
    ENABLE_LIVE_TRADING: "yes-i-accept-the-risk",
    LIVE_MAX_TICKET_USD: "200",
    LIVE_MAX_DEPLOYED_USD: "80",
    LIVE_MAX_BOOK_USD: "500",
  };
  assert.match(liveStartupRefusal(limitsFromEnv(env), 100, env) ?? "", /cannot both hold/);
});

test("paper runs are never gated by the live opt-in", () => {
  const env = { LIVE_MAX_TICKET_USD: "15" };
  assert.equal(liveStartupRefusal(limitsFromEnv(env), 1_000_000, env), null);
});
