// Unit tests for specialist join functionality
import { allocateGenesisTokens, validateOwnershipSum } from '../../src/services/conversations';
import { OwnershipLedger } from '../../src/types';

/**
 * Simulates specialist join using dilution model
 * Helper for testing (doesn't use database)
 */
function simulateSpecialistJoin(
  currentLedger: OwnershipLedger,
  specialist_id: string,
  initiator_id: string,
  target_id: string,
  join_round: number,
  total_tokens: number = 1000
): OwnershipLedger {
  const DILUTION_RATE = 0.15;

  const initiator = currentLedger[initiator_id];
  const target = currentLedger[target_id];

  if (!initiator || !target) {
    throw new Error('Initiator or target not found');
  }

  const initiator_extracted = initiator.ownership_pct * DILUTION_RATE;
  const target_extracted = target.ownership_pct * DILUTION_RATE;
  const total_extracted = initiator_extracted + target_extracted;

  const initiator_new_pct = initiator.ownership_pct - initiator_extracted;
  const target_new_pct = target.ownership_pct - target_extracted;

  return {
    ...currentLedger,
    [initiator_id]: {
      ...initiator,
      ownership_pct: initiator_new_pct,
      token_balance: (initiator_new_pct / 100) * total_tokens,
    },
    [target_id]: {
      ...target,
      ownership_pct: target_new_pct,
      token_balance: (target_new_pct / 100) * total_tokens,
    },
    [specialist_id]: {
      ownership_pct: total_extracted,
      token_balance: (total_extracted / 100) * total_tokens,
      vested_pct: 0,
      buy_in_amount: 0,
      join_round,
    },
  };
}

describe('Specialist Join: Single Joins', () => {
  const avatar_a = 'avatar-a';
  const avatar_b = 'avatar-b';
  const specialist_1 = 'specialist-1';

  it('should extract 15% from each of A and B', () => {
    const genesis = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const afterJoin = simulateSpecialistJoin(genesis, specialist_1, avatar_a, avatar_b, 1, 1000);

    expect(afterJoin[avatar_a].ownership_pct).toBeCloseTo(42.5, 10);
    expect(afterJoin[avatar_b].ownership_pct).toBeCloseTo(42.5, 10);
    expect(afterJoin[specialist_1].ownership_pct).toBeCloseTo(15, 10);
  });

  it('should sum to 100% after single specialist joins', () => {
    const genesis = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const afterJoin = simulateSpecialistJoin(genesis, specialist_1, avatar_a, avatar_b, 1, 1000);

    expect(validateOwnershipSum(afterJoin)).toBe(true);
  });

  it('should preserve total tokens', () => {
    const genesis = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const genesisTotalTokens = Object.values(genesis).reduce((sum, e) => sum + e.token_balance, 0);

    const afterJoin = simulateSpecialistJoin(genesis, specialist_1, avatar_a, avatar_b, 1, 1000);
    const afterJoinTotal = Object.values(afterJoin).reduce((sum, e) => sum + e.token_balance, 0);

    expect(afterJoinTotal).toBeCloseTo(genesisTotalTokens, 10);
  });

  it('should set specialist vested_pct to 0', () => {
    const genesis = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const afterJoin = simulateSpecialistJoin(genesis, specialist_1, avatar_a, avatar_b, 1, 1000);

    expect(afterJoin[specialist_1].vested_pct).toBe(0);
    expect(afterJoin[specialist_1].buy_in_amount).toBe(0);
  });

  it('should set specialist join_round to 1', () => {
    const genesis = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const afterJoin = simulateSpecialistJoin(genesis, specialist_1, avatar_a, avatar_b, 1, 1000);

    expect(afterJoin[specialist_1].join_round).toBe(1);
  });
});

describe('Specialist Join: Sequential Joins', () => {
  const avatar_a = 'avatar-a';
  const avatar_b = 'avatar-b';

  it('should handle 5 sequential specialist joins', () => {
    let ledger = allocateGenesisTokens(avatar_a, avatar_b, 1000);

    for (let i = 1; i <= 5; i++) {
      ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, 1000);
      expect(validateOwnershipSum(ledger)).toBe(true);
    }

    const total = Object.values(ledger).reduce((sum, e) => sum + e.ownership_pct, 0);
    expect(total).toBeCloseTo(100, 8);
  });

  it('should keep earlier specialists constant as new ones join', () => {
    let ledger = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    ledger = simulateSpecialistJoin(ledger, 'specialist-1', avatar_a, avatar_b, 1, 1000);
    const s1_after_1 = ledger['specialist-1'].ownership_pct;

    for (let i = 2; i <= 5; i++) {
      ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, 1000);
    }
    const s1_after_5 = ledger['specialist-1'].ownership_pct;

    expect(s1_after_1).toBeCloseTo(s1_after_5, 10);
    expect(s1_after_1).toBeCloseTo(15, 10);
  });

  it('should decrease A and B equally', () => {
    let ledger = allocateGenesisTokens(avatar_a, avatar_b, 1000);

    for (let i = 1; i <= 5; i++) {
      ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, 1000);
      expect(ledger[avatar_a].ownership_pct).toBeCloseTo(ledger[avatar_b].ownership_pct, 10);
    }
  });

  it('should allocate less to later specialists', () => {
    let ledger = allocateGenesisTokens(avatar_a, avatar_b, 1000);
    const allocations: number[] = [];

    for (let i = 1; i <= 10; i++) {
      ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, 1000);
      allocations.push(ledger[`specialist-${i}`].ownership_pct);
    }

    for (let i = 1; i < allocations.length; i++) {
      expect(allocations[i]).toBeLessThan(allocations[i - 1]);
    }

    expect(allocations[0]).toBeCloseTo(15, 10);
  });

  it('should handle 100 specialists without error', () => {
    let ledger = allocateGenesisTokens(avatar_a, avatar_b, 1000);

    for (let i = 1; i <= 100; i++) {
      ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, 1000);
      if (i % 10 === 0) {
        expect(validateOwnershipSum(ledger)).toBe(true);
      }
    }

    const total = Object.values(ledger).reduce((sum, e) => sum + e.ownership_pct, 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

describe('Specialist Join: Edge Cases', () => {
  const avatar_a = 'avatar-a';
  const avatar_b = 'avatar-b';

  it('should work with unequal A and B ownership', () => {
    const ledger: OwnershipLedger = {
      [avatar_a]: {
        ownership_pct: 60,
        token_balance: 600,
        vested_pct: 0,
        buy_in_amount: 0,
      },
      [avatar_b]: {
        ownership_pct: 40,
        token_balance: 400,
        vested_pct: 0,
        buy_in_amount: 0,
      },
    };

    const afterJoin = simulateSpecialistJoin(ledger, 'specialist-1', avatar_a, avatar_b, 1, 1000);

    expect(afterJoin[avatar_a].ownership_pct).toBeCloseTo(51, 10);
    expect(afterJoin[avatar_b].ownership_pct).toBeCloseTo(34, 10);
    expect(afterJoin['specialist-1'].ownership_pct).toBeCloseTo(15, 10);
    expect(validateOwnershipSum(afterJoin)).toBe(true);
  });

  it('should handle multiple joins with different token amounts', () => {
    const amounts = [1, 100, 1000, 10000];

    amounts.forEach((amount) => {
      let ledger = allocateGenesisTokens(avatar_a, avatar_b, amount);

      for (let i = 1; i <= 5; i++) {
        ledger = simulateSpecialistJoin(ledger, `specialist-${i}`, avatar_a, avatar_b, i, amount);
      }

      expect(validateOwnershipSum(ledger)).toBe(true);

      const totalTokens = Object.values(ledger).reduce((sum, e) => sum + e.token_balance, 0);
      expect(totalTokens).toBeCloseTo(amount, 8);
    });
  });
});
