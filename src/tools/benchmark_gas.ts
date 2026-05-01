import { simulateTransaction } from "../tools/simulate_transaction";
import { getAccountBalance } from "../tools/get_account_balance";
import { logger } from "../logger";
import { performance } from "perf_hooks";

/**
 * Benchmarks gas (CPU/Memory) usage for a Stellar/Soroban contract execution.
 * Compares Pulsar-reported gas with actual resource usage.
 * @param contractId - The contract to benchmark
 * @param method - The contract method to invoke
 * @param args - Arguments for the contract method
 * @param account - The account executing the contract
 */
export async function benchmarkGas({
  contractId,
  method,
  args = [],
  account,
}: {
  contractId: string;
  method: string;
  args?: any[];
  account: string;
}) {
  logger.info("Starting gas benchmarking...");
  const startMem = process.memoryUsage().rss;
  const start = performance.now();
  let simulationResult;
  let error;
  try {
    simulationResult = await simulateTransaction({ contractId, method, args, account });
  } catch (e) {
    error = e;
    logger.error("Simulation failed", e);
  }
  const end = performance.now();
  const endMem = process.memoryUsage().rss;
  const cpuMs = end - start;
  const memDelta = endMem - startMem;
  let pulsarGas = simulationResult?.gas ?? null;
  logger.info("Benchmark complete", {
    cpuMs,
    memDelta,
    pulsarGas,
    error,
  });
  return {
    cpuMs,
    memDelta,
    pulsarGas,
    error,
    simulationResult,
  };
}

if (require.main === module) {
  // CLI usage: node benchmark_gas.js <contractId> <method> <account> [args...]
  (async () => {
    const [contractId, method, account, ...args] = process.argv.slice(2);
    const result = await benchmarkGas({ contractId, method, args, account });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.error ? 1 : 0);
  })();
}
