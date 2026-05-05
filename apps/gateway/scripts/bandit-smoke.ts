/**
 * Boot-time cold-start smoke test for the bandit allocator.
 * Run with: pnpm --filter @tradeworks/gateway exec tsx scripts/bandit-smoke.ts
 */
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import {
  getBanditWeight,
  getCurrentWeights,
  initBandit,
} from '../src/services/orchestrator/bandit-runner.js';

const path = resolve(process.cwd(), 'data', 'bandit-weights.json');
if (existsSync(path)) unlinkSync(path);

await initBandit();

const w = getCurrentWeights();
const out = {
  weightsFileWritten: existsSync(path),
  strategiesCount: Object.keys(w?.strategies ?? {}).length,
  updatedAtSet: !!w?.updatedAt,
  peadWeight: getBanditWeight('pead'),
  regimeTrendWeight: getBanditWeight('regime_trend'),
  unknownStrategyWeight: getBanditWeight('does_not_exist'),
  allWeightsSum: Object.values(w?.strategies ?? {}).reduce((a, e) => a + e.weight, 0),
};
console.log(JSON.stringify(out, null, 2));
process.exit(0);