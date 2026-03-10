// --- Types ---

type OrderSide = 'buy' | 'sell';

interface TwapSlice {
  sliceIndex: number;
  quantity: number;
  scheduledAt: string;
  delayMs: number;
}

interface TwapPlan {
  type: 'twap';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  durationMinutes: number;
  intervalMs: number;
  plan: TwapSlice[];
  createdAt: string;
}

interface VwapSlice {
  sliceIndex: number;
  quantity: number;
  weight: number;
  scheduledAt: string;
  delayMs: number;
}

interface VwapPlan {
  type: 'vwap';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  volumeProfile: number[];
  plan: VwapSlice[];
  createdAt: string;
}

interface IcebergPlan {
  type: 'iceberg';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  displayQuantity: number;
  price: number;
  totalRefills: number;
  remainderQuantity: number;
  createdAt: string;
}

// --- Request Interfaces ---

export interface TwapRequest {
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  durationMinutes: number;
}

export interface VwapRequest {
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  volumeProfile?: number[];
}

export interface IcebergRequest {
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  displayQuantity: number;
  price: number;
}

// --- Default Volume Profile ---

/**
 * Generate a simplified U-shaped volume profile for VWAP.
 * Higher weight at session open (first 30 min) and close (last 30 min),
 * lower weight in the middle of the session.
 *
 * Returns an array of weights (one per slice) that sum to 1.
 */
function generateDefaultVolumeProfile(sliceCount: number): number[] {
  if (sliceCount <= 0) {
    return [];
  }
  if (sliceCount === 1) {
    return [1];
  }

  const weights: number[] = [];

  for (let index = 0; index < sliceCount; index++) {
    // Normalize position to [0, 1]
    const position = index / (sliceCount - 1);

    // U-shaped curve: higher at edges (0 and 1), lower in middle (0.5)
    // Formula: w = 1 + cos(2 * PI * position) => range [0, 2]
    // This gives weight ~2 at edges, ~0 at center
    const rawWeight = 1 + Math.cos(2 * Math.PI * position);

    // Floor at 0.3 so the middle slices still get meaningful volume
    weights.push(Math.max(rawWeight, 0.3));
  }

  // Normalize so weights sum to 1
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / totalWeight);
}

/**
 * Normalize a user-provided volume profile so weights sum to 1.
 * If the array length doesn't match the slice count, interpolates linearly.
 */
function normalizeVolumeProfile(
  profile: number[],
  sliceCount: number,
): number[] {
  if (profile.length === sliceCount) {
    const total = profile.reduce((sum, weight) => sum + weight, 0);
    if (total === 0) {
      return generateDefaultVolumeProfile(sliceCount);
    }
    return profile.map((weight) => weight / total);
  }

  // Linear interpolation to match slice count
  const interpolated: number[] = [];
  for (let index = 0; index < sliceCount; index++) {
    const position = (index / (sliceCount - 1)) * (profile.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, profile.length - 1);
    const fraction = position - lower;
    const value = profile[lower] * (1 - fraction) + profile[upper] * fraction;
    interpolated.push(value);
  }

  const total = interpolated.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    return generateDefaultVolumeProfile(sliceCount);
  }
  return interpolated.map((weight) => weight / total);
}

// --- Plan Generators ---

/**
 * Create a TWAP (Time-Weighted Average Price) execution plan.
 *
 * Splits a large order into N equal slices evenly spaced over T minutes.
 * Does not execute orders -- only calculates the slicing plan.
 */
export function createTwapPlan(request: TwapRequest): TwapPlan {
  const { instrument, side, totalQuantity, slices, durationMinutes } = request;

  const intervalMs = (durationMinutes * 60 * 1000) / slices;
  const quantityPerSlice = totalQuantity / slices;
  const now = new Date();

  const plan: TwapSlice[] = [];

  for (let index = 0; index < slices; index++) {
    const delayMs = index * intervalMs;
    const scheduledAt = new Date(now.getTime() + delayMs);

    plan.push({
      sliceIndex: index,
      quantity: index === slices - 1
        ? totalQuantity - quantityPerSlice * (slices - 1) // Last slice absorbs rounding
        : quantityPerSlice,
      scheduledAt: scheduledAt.toISOString(),
      delayMs,
    });
  }

  return {
    type: 'twap',
    instrument,
    side,
    totalQuantity,
    slices,
    durationMinutes,
    intervalMs,
    plan,
    createdAt: now.toISOString(),
  };
}

/**
 * Create a VWAP (Volume-Weighted Average Price) execution plan.
 *
 * Weights order slices by a volume profile. Uses a U-shaped profile
 * by default (more volume at session open/close, less in the middle).
 * Does not execute orders -- only calculates the slicing plan.
 */
export function createVwapPlan(request: VwapRequest): VwapPlan {
  const { instrument, side, totalQuantity, slices } = request;

  const volumeProfile = request.volumeProfile
    ? normalizeVolumeProfile(request.volumeProfile, slices)
    : generateDefaultVolumeProfile(slices);

  // Duration assumption: VWAP typically runs across a full trading session
  // Use 6.5 hours (390 min) for equities or configurable per-session
  const sessionDurationMs = 390 * 60 * 1000;
  const intervalMs = sessionDurationMs / slices;
  const now = new Date();

  const plan: VwapSlice[] = [];
  let allocatedQuantity = 0;

  for (let index = 0; index < slices; index++) {
    const weight = volumeProfile[index];
    const delayMs = index * intervalMs;
    const scheduledAt = new Date(now.getTime() + delayMs);

    let quantity: number;
    if (index === slices - 1) {
      // Last slice absorbs any rounding remainder
      quantity = totalQuantity - allocatedQuantity;
    } else {
      quantity = Math.round(totalQuantity * weight * 1e8) / 1e8;
      allocatedQuantity += quantity;
    }

    plan.push({
      sliceIndex: index,
      quantity,
      weight,
      scheduledAt: scheduledAt.toISOString(),
      delayMs,
    });
  }

  return {
    type: 'vwap',
    instrument,
    side,
    totalQuantity,
    slices,
    volumeProfile,
    plan,
    createdAt: now.toISOString(),
  };
}

/**
 * Create an Iceberg execution plan.
 *
 * Shows only a fraction (displayQuantity) of the total order size.
 * The hidden portion is refilled after each displayed tranche fills.
 * Does not execute orders -- only calculates the refill plan.
 */
export function createIcebergPlan(request: IcebergRequest): IcebergPlan {
  const { instrument, side, totalQuantity, displayQuantity, price } = request;

  const totalRefills = Math.ceil(totalQuantity / displayQuantity) - 1;
  const remainderQuantity = totalQuantity % displayQuantity;

  return {
    type: 'iceberg',
    instrument,
    side,
    totalQuantity,
    displayQuantity,
    price,
    totalRefills,
    remainderQuantity: remainderQuantity === 0 ? displayQuantity : remainderQuantity,
    createdAt: new Date().toISOString(),
  };
}
