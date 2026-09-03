import { v4 as uuidv4 } from 'uuid';
import * as conversationService from '../../src/services/conversations';

describe('Sprint 7: Conversation Creation & Genesis Allocation', () => {
  describe('allocateGenesisTokens', () => {
    test('allocates exactly 50/50 split', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      expect(ledger[id1].token_balance).toBe(500);
      expect(ledger[id2].token_balance).toBe(500);
      expect(ledger[id1].ownership_pct).toBe(50);
      expect(ledger[id2].ownership_pct).toBe(50);
    });

    test('sums tokens to total regardless of odd amounts', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1001);

      const total = ledger[id1].token_balance + ledger[id2].token_balance;
      expect(total).toBe(1001);
    });

    test('marks tokens as unvested at genesis', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      expect(ledger[id1].vested_pct).toBe(0);
      expect(ledger[id2].vested_pct).toBe(0);
    });

    test('sets join_round to 0 for genesis', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      expect(ledger[id1].join_round).toBe(0);
      expect(ledger[id2].join_round).toBe(0);
    });

    test('no buy-in for genesis tokens', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      expect(ledger[id1].buy_in_amount).toBe(0);
      expect(ledger[id2].buy_in_amount).toBe(0);
    });

    test('handles fractional token amounts', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 123.45);

      const total = ledger[id1].token_balance + ledger[id2].token_balance;
      expect(total).toBeCloseTo(123.45, 2);
    });

    test('handles very large amounts', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000000);

      expect(ledger[id1].token_balance).toBe(500000);
      expect(ledger[id2].token_balance).toBe(500000);
    });

    test('creates ledger for exactly two avatars', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      const keys = Object.keys(ledger);
      expect(keys.length).toBe(2);
      expect(keys).toContain(id1);
      expect(keys).toContain(id2);
    });

    test('ledger entries have all required fields', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      Object.values(ledger).forEach(entry => {
        expect(entry).toHaveProperty('ownership_pct');
        expect(entry).toHaveProperty('token_balance');
        expect(entry).toHaveProperty('vested_pct');
        expect(entry).toHaveProperty('buy_in_amount');
        expect(entry).toHaveProperty('join_round');
      });
    });
  });

  describe('validateOwnershipSum', () => {
    test('accepts valid genesis 50/50 split', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 1000);

      expect(conversationService.validateOwnershipSum(ledger)).toBe(true);
    });

    test('rejects ownership sum exceeding 100 percent', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = {
        [id1]: { ownership_pct: 60, token_balance: 600, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id2]: { ownership_pct: 50, token_balance: 500, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
      };

      expect(conversationService.validateOwnershipSum(ledger)).toBe(false);
    });

    test('rejects ownership sum below 100 percent', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = {
        [id1]: { ownership_pct: 40, token_balance: 400, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id2]: { ownership_pct: 50, token_balance: 500, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
      };

      expect(conversationService.validateOwnershipSum(ledger)).toBe(false);
    });

    test('tolerates plus-minus 0.1 percent tolerance margin', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = {
        [id1]: { ownership_pct: 50.05, token_balance: 500.5, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id2]: { ownership_pct: 49.95, token_balance: 499.5, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
      };

      expect(conversationService.validateOwnershipSum(ledger)).toBe(true);
    });

    test('works with many equal participants', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const id3 = uuidv4();
      const id4 = uuidv4();
      const ledger = {
        [id1]: { ownership_pct: 25, token_balance: 250, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id2]: { ownership_pct: 25, token_balance: 250, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id3]: { ownership_pct: 25, token_balance: 250, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
        [id4]: { ownership_pct: 25, token_balance: 250, vested_pct: 0, buy_in_amount: 0, join_round: 0 },
      };

      expect(conversationService.validateOwnershipSum(ledger)).toBe(true);
    });
  });

  describe('Genesis Allocation Invariants', () => {
    test('token balance equals ownership percentage ratio of total', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const total = 1234.56;
      const ledger = conversationService.allocateGenesisTokens(id1, id2, total);

      Object.entries(ledger).forEach(([, entry]) => {
        const expectedTokens = (entry.ownership_pct / 100) * total;
        expect(entry.token_balance).toBeCloseTo(expectedTokens, 2);
      });
    });

    test('all genesis tokens have zero vesting', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const ledger = conversationService.allocateGenesisTokens(id1, id2, 5000);

      Object.values(ledger).forEach(entry => {
        expect(entry.vested_pct).toBe(0);
        expect(entry.join_round).toBe(0);
      });
    });

    test('genesis allocation always sums to exactly 100 percent', () => {
      for (let i = 0; i < 10; i++) {
        const id1 = uuidv4();
        const id2 = uuidv4();
        const amount = Math.random() * 10000;
        const ledger = conversationService.allocateGenesisTokens(id1, id2, amount);

        const sum = Object.values(ledger).reduce((acc, entry) => acc + entry.ownership_pct, 0);
        expect(sum).toBeCloseTo(100, 1);
      }
    });
  });
});
