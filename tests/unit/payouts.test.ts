// Unit tests for vesting and payout validation
import { allocateGenesisTokens } from '../../src/services/conversations';
import { OwnershipLedger } from '../../src/types';

/**
 * Simulates vesting calculation at a given time
 */
function calculateVestingAtTime(
  totalTokens: number,
  vestingStartDate: Date,
  checkTime: Date
): { vested_pct: number; available_tokens: number; locked_tokens: number } {
  const vestingEnd = new Date(vestingStartDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  let vested_pct = 0;
  if (checkTime >= vestingEnd) {
    vested_pct = 100;
  } else if (checkTime > vestingStartDate) {
    const elapsed_ms = checkTime.getTime() - vestingStartDate.getTime();
    const total_ms = vestingEnd.getTime() - vestingStartDate.getTime();
    vested_pct = Math.round((elapsed_ms / total_ms) * 10000) / 100;
  }

  const available = Math.round((totalTokens * vested_pct) / 100 * 100) / 100;
  const locked = totalTokens - available;

  return {
    vested_pct,
    available_tokens: available,
    locked_tokens: locked,
  };
}

describe('Vesting: Time-Based Calculation', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const total_tokens = 1000;

  it('should be 0% vested at genesis', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, start);
    expect(vesting.vested_pct).toBe(0);
    expect(vesting.available_tokens).toBe(0);
    expect(vesting.locked_tokens).toBe(total_tokens);
  });

  it('should be 50% vested at day 15', () => {
    const day15 = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    expect(vesting.vested_pct).toBeCloseTo(50, 1);
    expect(vesting.available_tokens).toBeCloseTo(500, 1);
    expect(vesting.locked_tokens).toBeCloseTo(500, 1);
  });

  it('should be 100% vested at day 30', () => {
    const day30 = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day30);
    expect(vesting.vested_pct).toBe(100);
    expect(vesting.available_tokens).toBe(total_tokens);
    expect(vesting.locked_tokens).toBe(0);
  });

  it('should be 100% vested after day 30', () => {
    const day35 = new Date(start.getTime() + 35 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day35);
    expect(vesting.vested_pct).toBe(100);
    expect(vesting.available_tokens).toBe(total_tokens);
    expect(vesting.locked_tokens).toBe(0);
  });

  it('should be 33.33% vested at day 10', () => {
    const day10 = new Date(start.getTime() + 10 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day10);
    expect(vesting.vested_pct).toBeCloseTo(33.33, 1);
    expect(vesting.available_tokens).toBeCloseTo(333.33, 0);
    expect(vesting.locked_tokens).toBeCloseTo(666.67, 0);
  });

  it('should be 66.67% vested at day 20', () => {
    const day20 = new Date(start.getTime() + 20 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day20);
    expect(vesting.vested_pct).toBeCloseTo(66.67, 1);
    expect(vesting.available_tokens).toBeCloseTo(666.67, 0);
  });

  it('should be linear progression', () => {
    const vesting = [0, 5, 10, 15, 20, 25, 30].map((day) => {
      const checkTime = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
      return calculateVestingAtTime(total_tokens, start, checkTime).vested_pct;
    });

    for (let i = 1; i < vesting.length; i++) {
      expect(vesting[i]).toBeGreaterThanOrEqual(vesting[i - 1]);
    }

    expect(vesting[0]).toBe(0);
    expect(vesting[3]).toBeCloseTo(50, 1);
    expect(vesting[6]).toBe(100);
  });
});

describe('Vesting: Token Amount Scaling', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const day15 = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);

  it('should scale available tokens proportionally', () => {
    const amounts = [1, 100, 1000, 10000, 1000000];

    amounts.forEach((amount) => {
      const vesting = calculateVestingAtTime(amount, start, day15);
      expect(vesting.available_tokens).toBeCloseTo(amount * 0.5, 2);
      expect(vesting.locked_tokens).toBeCloseTo(amount * 0.5, 2);
    });
  });

  it('should preserve total tokens', () => {
    const amounts = [1, 100, 1000, 10000];

    amounts.forEach((amount) => {
      const vesting = calculateVestingAtTime(amount, start, day15);
      const total = vesting.available_tokens + vesting.locked_tokens;
      expect(total).toBeCloseTo(amount, 8);
    });
  });
});

describe('Payout Validation', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const day15 = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);
  const total_tokens = 1000;

  function validatePayoutRequest(
    available: number,
    locked: number,
    requested: number
  ): { valid: boolean; error?: string } {
    if (requested <= 0) {
      return { valid: false, error: 'Amount must be positive' };
    }
    if (requested > available) {
      return {
        valid: false,
        error: `Insufficient vested tokens. Requested: ${requested}, Available: ${available.toFixed(2)}, Locked: ${locked.toFixed(2)}`,
      };
    }
    return { valid: true };
  }

  it('should reject zero or negative amount', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 0).valid).toBe(false);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, -100).valid).toBe(false);
  });

  it('should reject payout of locked tokens at day 0', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, start);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 1).valid).toBe(false);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 500).valid).toBe(false);
  });

  it('should allow payout of available tokens at day 15', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 100).valid).toBe(true);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 500).valid).toBe(true);
  });

  it('should reject payout exceeding available at day 15', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 501).valid).toBe(false);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 1000).valid).toBe(false);
  });

  it('should allow full payout at day 30', () => {
    const day30 = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    const vesting = calculateVestingAtTime(total_tokens, start, day30);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 1000).valid).toBe(true);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 500).valid).toBe(true);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 1).valid).toBe(true);
  });

  it('should allow partial payout within available amount', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 250).valid).toBe(true);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 500).valid).toBe(true);
    expect(validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 1).valid).toBe(true);
  });

  it('should provide clear error messages', () => {
    const vesting = calculateVestingAtTime(total_tokens, start, day15);
    const result = validatePayoutRequest(vesting.available_tokens, vesting.locked_tokens, 600);
    expect(result.error).toContain('Insufficient vested');
    expect(result.error).toContain('Available');
    expect(result.error).toContain('Locked');
  });
});

describe('Payout: Specialist Scenarios', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const day15 = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);

  function simulateSpecialistJoin(amount: number, join_round: number): number {
    const DILUTION_RATE = 0.15;
    let a_pct = 50;
    let b_pct = 50;
    for (let i = 1; i <= join_round; i++) {
      const extracted = a_pct * DILUTION_RATE;
      a_pct -= extracted;
      b_pct -= extracted;
    }
    return amount * ((100 - a_pct - b_pct) / 100);
  }

  it('should calculate correct available tokens for S1 at day 15', () => {
    const total_tokens = 1000;
    const s1_allocation = simulateSpecialistJoin(total_tokens, 1);
    const vesting = calculateVestingAtTime(s1_allocation, start, day15);
    expect(vesting.available_tokens).toBeCloseTo(75, 1);
    expect(vesting.locked_tokens).toBeCloseTo(75, 1);
  });

  it('should calculate correct available tokens for S5 at day 15', () => {
    const total_tokens = 1000;
    const s5_allocation = simulateSpecialistJoin(total_tokens, 5);
    const vesting = calculateVestingAtTime(s5_allocation, start, day15);
    const expected_available = s5_allocation * 0.5;
    expect(vesting.available_tokens).toBeCloseTo(expected_available, 1);
  });
});
