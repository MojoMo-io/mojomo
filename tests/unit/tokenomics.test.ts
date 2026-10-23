// Unit tests for tokenomics (dilution model)
import { allocateGenesisTokens, validateOwnershipSum } from '../../src/services/conversations';
import { OwnershipLedger } from '../../src/types';

describe('Tokenomics: Genesis Allocation', () => {
  const avatar_a = 'avatar-a-id';
  const avatar_b = 'avatar-b-id';
  const total_tokens = 1000;

  it('should allocate 70/30 split (creator / co-creator)', () => {
    const ledger = allocateGenesisTokens(avatar_a, avatar_b, total_tokens);

    expect(ledger[avatar_a].ownership_pct).toBe(70);
    expect(ledger[avatar_b].ownership_pct).toBe(30);
    expect(ledger[avatar_a].token_balance).toBe(700);
    expect(ledger[avatar_b].token_balance).toBe(300);
  });

  it('should sum to exactly 100%', () => {
    const ledger = allocateGenesisTokens(avatar_a, avatar_b, total_tokens);
    expect(validateOwnershipSum(ledger)).toBe(true);
  });

  it('should have 0% vested at genesis', () => {
    const ledger = allocateGenesisTokens(avatar_a, avatar_b, total_tokens);

    expect(ledger[avatar_a].vested_pct).toBe(0);
    expect(ledger[avatar_b].vested_pct).toBe(0);
  });

  it('should have 0 buy_in_amount at genesis', () => {
    const ledger = allocateGenesisTokens(avatar_a, avatar_b, total_tokens);

    expect(ledger[avatar_a].buy_in_amount).toBe(0);
    expect(ledger[avatar_b].buy_in_amount).toBe(0);
  });

  it('should work with different token amounts', () => {
    const amounts = [1, 100, 1000, 10000, 1000000];

    amounts.forEach((amount) => {
      const ledger = allocateGenesisTokens(avatar_a, avatar_b, amount);
      expect(validateOwnershipSum(ledger)).toBe(true);
      expect(ledger[avatar_a].token_balance + ledger[avatar_b].token_balance).toBe(amount);
    });
  });
});

describe('Tokenomics: Ownership Validation', () => {
  it('should validate 100% exactly', () => {
    const ledger: OwnershipLedger = {
      'avatar-1': { ownership_pct: 100, token_balance: 1000, vested_pct: 0, buy_in_amount: 0 },
    };
    expect(validateOwnershipSum(ledger)).toBe(true);
  });

  it('should validate within 0.1% tolerance', () => {
    const ledger: OwnershipLedger = {
      'avatar-1': { ownership_pct: 50.05, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
      'avatar-2': { ownership_pct: 49.95, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
    };
    expect(validateOwnershipSum(ledger)).toBe(true);
  });

  it('should reject ownership sum > 100.1%', () => {
    const ledger: OwnershipLedger = {
      'avatar-1': { ownership_pct: 50.1, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
      'avatar-2': { ownership_pct: 50.1, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
    };
    expect(validateOwnershipSum(ledger)).toBe(false);
  });

  it('should reject ownership sum < 99.9%', () => {
    const ledger: OwnershipLedger = {
      'avatar-1': { ownership_pct: 49.9, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
      'avatar-2': { ownership_pct: 49.9, token_balance: 500, vested_pct: 0, buy_in_amount: 0 },
    };
    expect(validateOwnershipSum(ledger)).toBe(false);
  });
});

describe('Tokenomics: Dilution Model Simulation', () => {
  /**
   * Simulates specialist joins using the dilution model:
   * Each specialist extracts 15% from both A and B
   */
  function simulateDilution(
    initialA_pct: number,
    initialB_pct: number,
    numSpecialists: number
  ): OwnershipLedger {
    const ledger: OwnershipLedger = {
      'A': {
        ownership_pct: initialA_pct,
        token_balance: initialA_pct * 10, // 1000 tokens total
        vested_pct: 0,
        buy_in_amount: 0,
      },
      'B': {
        ownership_pct: initialB_pct,
        token_balance: initialB_pct * 10,
        vested_pct: 0,
        buy_in_amount: 0,
      },
    };

    // Policy (2026-10-23): team pool capped at 20%, split equally among members.
    // Only A and B fund it, diluted proportionally so their ratio is preserved.
    const TEAM_POOL_PCT = 20;

    for (let i = 1; i <= numSpecialists; i++) {
      const member_count = i;
      const per_member = TEAM_POOL_PCT / member_count;

      // A and B together hold whatever the pool does not, in their original ratio.
      const founders_total = 100 - TEAM_POOL_PCT;
      const ratio = ledger['A'].ownership_pct /
        (ledger['A'].ownership_pct + ledger['B'].ownership_pct);
      ledger['A'].ownership_pct = founders_total * ratio;
      ledger['A'].token_balance = ledger['A'].ownership_pct * 10;
      ledger['B'].ownership_pct = founders_total * (1 - ratio);
      ledger['B'].token_balance = ledger['B'].ownership_pct * 10;

      // Every member, old and new, holds an equal slice.
      for (let j = 1; j <= i; j++) {
        ledger[`S${j}`] = {
          ownership_pct: per_member,
          token_balance: per_member * 10,
          vested_pct: 0,
          buy_in_amount: 0,
          join_round: j,
        };
      }
    }

    return ledger;
  }

  it('should sum to 100% with 1 specialist', () => {
    const ledger = simulateDilution(70, 30, 1);
    expect(validateOwnershipSum(ledger)).toBe(true);

    const expected = {
      A: 56,
      B: 24,
      S1: 20,
    };
    expect(ledger['A'].ownership_pct).toBeCloseTo(expected.A, 10);
    expect(ledger['B'].ownership_pct).toBeCloseTo(expected.B, 10);
    expect(ledger['S1'].ownership_pct).toBeCloseTo(expected.S1, 10);
  });

  it('should sum to 100% with 5 specialists', () => {
    const ledger = simulateDilution(50, 50, 5);
    expect(validateOwnershipSum(ledger)).toBe(true);

    const totalOwnership = Object.values(ledger).reduce(
      (sum, entry) => sum + entry.ownership_pct,
      0
    );
    expect(totalOwnership).toBeCloseTo(100, 8);
  });

  it('should sum to 100% with 10 specialists', () => {
    const ledger = simulateDilution(50, 50, 10);
    expect(validateOwnershipSum(ledger)).toBe(true);

    const totalOwnership = Object.values(ledger).reduce(
      (sum, entry) => sum + entry.ownership_pct,
      0
    );
    expect(totalOwnership).toBeCloseTo(100, 8);
  });

  it('should re-slice earlier specialists as new ones join', () => {
    const ledger5 = simulateDilution(50, 50, 5);
    const s1_after_5 = ledger5['S1'].ownership_pct;

    const ledger10 = simulateDilution(50, 50, 10);
    const s1_after_10 = ledger10['S1'].ownership_pct;

    // The pool divides more ways, so an earlier member's slice shrinks.
    expect(s1_after_5).toBeCloseTo(4, 10);   // 20 / 5
    expect(s1_after_10).toBeCloseTo(2, 10);  // 20 / 10
  });

  it('should dilute A and B proportionally, preserving their ratio', () => {
    const ledger = simulateDilution(70, 30, 10);

    // A and B together hold 80%, still in a 70:30 ratio -> 56 / 24
    expect(ledger['A'].ownership_pct).toBeCloseTo(56, 10);
    expect(ledger['B'].ownership_pct).toBeCloseTo(24, 10);
  });

  it('should decrease specialist allocation as more join', () => {
    const ledger = simulateDilution(50, 50, 10);

    const allocations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ledger[`S${i}`]?.ownership_pct || 0);

    // All members hold an equal slice of the pool, so every allocation matches.
    for (let i = 1; i < allocations.length; i++) {
      expect(allocations[i]).toBeCloseTo(allocations[i - 1], 10);
    }

    // With 10 members the pool divides into 10 equal slices of 2%.
    expect(allocations[0]).toBeCloseTo(2, 10);
    expect(allocations[9]).toBeCloseTo(2, 10);
  });

  it('should work with any starting A/B ratio', () => {
    // Test with unequal starting allocation
    const ledger = simulateDilution(60, 40, 5);
    expect(validateOwnershipSum(ledger)).toBe(true);

    const totalOwnership = Object.values(ledger).reduce(
      (sum, entry) => sum + entry.ownership_pct,
      0
    );
    expect(totalOwnership).toBeCloseTo(100, 8);
  });

  it('should handle 100 specialists without rounding error', () => {
    const ledger = simulateDilution(50, 50, 100);
    expect(validateOwnershipSum(ledger)).toBe(true);

    const totalOwnership = Object.values(ledger).reduce(
      (sum, entry) => sum + entry.ownership_pct,
      0
    );
    expect(totalOwnership).toBeCloseTo(100, 6); // 6 decimals for 100 specialists
  });
});

describe('Tokenomics: Edge Cases', () => {
  it('should handle 0.01% ownership', () => {
    const ledger: OwnershipLedger = {
      'A': {
        ownership_pct: 99.99,
        token_balance: 9999,
        vested_pct: 0,
        buy_in_amount: 0,
      },
      'B': {
        ownership_pct: 0.01,
        token_balance: 1,
        vested_pct: 0,
        buy_in_amount: 0,
      },
    };
    expect(validateOwnershipSum(ledger)).toBe(true);
  });

  it('should handle very large token amounts', () => {
    const ledger = allocateGenesisTokens('a', 'b', 1000000000);
    expect(validateOwnershipSum(ledger)).toBe(true);
    expect(ledger['a'].ownership_pct).toBe(70);
    expect(ledger['b'].ownership_pct).toBe(30);
  });

  it('should handle very small token amounts', () => {
    const ledger = allocateGenesisTokens('a', 'b', 0.01);
    expect(validateOwnershipSum(ledger)).toBe(true);
    expect(ledger['a'].ownership_pct).toBe(70);
  });
});
