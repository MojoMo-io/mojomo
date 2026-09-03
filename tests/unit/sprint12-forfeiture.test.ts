import * as forfeitureService from '../../src/services/forfeiture';
import * as db from '../../src/services/db';

jest.mock('../../src/services/db');

describe('Sprint 12: Forfeiture & End-to-End', () => {
  const mockDate = new Date('2026-10-15');
  const conversationId = 'conv-123';
  const avatarId1 = 'avatar-1';
  const avatarId2 = 'avatar-2';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateForfeiture', () => {
    test('returns zero forfeiture at 30 days (fully vested)', async () => {
      const thirtyDaysLater = new Date(mockDate);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const status = await forfeitureService.calculateForfeiture(
        conversationId,
        avatarId1,
        thirtyDaysLater
      );

      expect(status.vested_tokens).toBe(1000);
      expect(status.forfeited_tokens).toBe(0);
    });

    test('returns full forfeiture at day 0 (no vesting)', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const status = await forfeitureService.calculateForfeiture(
        conversationId,
        avatarId1,
        mockDate
      );

      expect(status.vested_tokens).toBe(0);
      expect(status.forfeited_tokens).toBe(1000);
      expect(status.payout_amount).toBe(0);
    });

    test('returns linear vesting at 15 days (50% vested)', async () => {
      const fifteenDaysLater = new Date(mockDate);
      fifteenDaysLater.setDate(fifteenDaysLater.getDate() + 15);

      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const status = await forfeitureService.calculateForfeiture(
        conversationId,
        avatarId1,
        fifteenDaysLater
      );

      expect(status.vested_tokens).toBeCloseTo(500, 0);
      expect(status.forfeited_tokens).toBeCloseTo(500, 0);
    });

    test('throws error when conversation not found', async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(
        forfeitureService.calculateForfeiture(conversationId, avatarId1, mockDate)
      ).rejects.toThrow('Conversation not found');
    });

    test('throws error when avatar not in conversation', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        forfeitureService.calculateForfeiture(conversationId, avatarId1, mockDate)
      ).rejects.toThrow('Avatar not found');
    });
  });

  describe('getForfeitureStatus', () => {
    test('returns status for all avatars in conversation', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }, { avatar_id: avatarId2 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 500 }],
        });

      const statuses = await forfeitureService.getForfeitureStatus(
        conversationId,
        mockDate
      );

      expect(statuses.length).toBeGreaterThanOrEqual(2);
      expect(statuses[0]).toHaveProperty('avatar_id');
      expect(statuses[0]).toHaveProperty('forfeited_tokens');
    });
  });

  describe('calculateConversationVesting', () => {
    test('calculates vested percentage across all avatars', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const result = await forfeitureService.calculateConversationVesting(
        conversationId,
        mockDate
      );

      expect(result).toHaveProperty('vested_pct');
      expect(result).toHaveProperty('forfeiture_breakdown');
      expect(result.vested_pct).toBeGreaterThanOrEqual(0);
      expect(result.vested_pct).toBeLessThanOrEqual(100);
    });

    test('returns 100% vested at 30+ days', async () => {
      const thirtyDaysLater = new Date(mockDate);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const result = await forfeitureService.calculateConversationVesting(
        conversationId,
        thirtyDaysLater
      );

      expect(result.vested_pct).toBe(100);
    });

    test('returns 0% vested at day 0', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const result = await forfeitureService.calculateConversationVesting(
        conversationId,
        mockDate
      );

      expect(result.vested_pct).toBe(0);
    });
  });

  describe('endConversation', () => {
    test('begins and commits transaction', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await forfeitureService.endConversation(conversationId, avatarId1, 'test_end', mockDate);

      expect(db.query).toHaveBeenCalledWith('BEGIN');
      expect(db.query).toHaveBeenCalledWith('COMMIT');
    });

    test('returns EndConversationResult with forfeitures', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await forfeitureService.endConversation(
        conversationId,
        avatarId1,
        'test',
        mockDate
      );

      expect(result).toHaveProperty('conversation_id');
      expect(result).toHaveProperty('ended_at');
      expect(result).toHaveProperty('forfeitures');
    });

    test('rolls back on error', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        forfeitureService.endConversation(conversationId, avatarId1, 'test', mockDate)
      ).rejects.toThrow();

      expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('checkAndEndDormantConversations', () => {
    test('returns array of ended conversation IDs', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: conversationId }],
        })
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await forfeitureService.checkAndEndDormantConversations();

      expect(Array.isArray(result)).toBe(true);
    });

    test('handles errors gracefully', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: conversationId }],
        })
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockRejectedValueOnce(new Error('Query failed'));

      const result = await forfeitureService.checkAndEndDormantConversations();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('E2E Vesting Scenarios', () => {
    test('vesting increases linearly from 0% to 100%', async () => {
      (db.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const day0 = await forfeitureService.calculateConversationVesting(
        conversationId,
        mockDate
      );

      const day15 = new Date(mockDate);
      day15.setDate(day15.getDate() + 15);

      (db.query as jest.Mock)
        .mockClear()
        .mockResolvedValueOnce({
          rows: [{ avatar_id: avatarId1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ created_at: mockDate.toISOString() }],
        })
        .mockResolvedValueOnce({
          rows: [{ balance: 1000 }],
        });

      const day15Result = await forfeitureService.calculateConversationVesting(
        conversationId,
        day15
      );

      expect(day0.vested_pct).toBe(0);
      expect(day15Result.vested_pct).toBeCloseTo(50, 0);
    });
  });
});
