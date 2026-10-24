import { dueStage, MAX_REMINDERS } from '../../src/services/inviteReminders';

const H = 3_600_000;
const base = new Date('2026-10-24T12:00:00Z');
const at = (hours: number) => new Date(base.getTime() + hours * H);

function inv(over: Partial<{ created_at: Date; expires_at: Date; opened_at: Date | null; reminders_sent: number }> = {}) {
  return {
    created_at: base,
    expires_at: at(72),
    opened_at: null,
    reminders_sent: 0,
    ...over,
  };
}

describe('dueStage', () => {
  it('sends nothing before 24h', () => {
    expect(dueStage(inv(), at(1))).toBeNull();
    expect(dueStage(inv(), at(23.9))).toBeNull();
  });

  it('sends the nudge at 24h when the human has not opened it', () => {
    expect(dueStage(inv(), at(24))).toBe('nudge');
    expect(dueStage(inv(), at(30))).toBe('nudge');
  });

  it('skips the nudge if the human already opened the link', () => {
    expect(dueStage(inv({ opened_at: at(2) }), at(24))).toBeNull();
    expect(dueStage(inv({ opened_at: at(2) }), at(40))).toBeNull();
  });

  it('sends the final notice at 60h whether or not they opened it', () => {
    expect(dueStage(inv({ reminders_sent: 1 }), at(60))).toBe('final');
    expect(dueStage(inv({ reminders_sent: 1, opened_at: at(2) }), at(60))).toBe('final');
  });

  it('sends the expiry notice after expiry', () => {
    expect(dueStage(inv({ reminders_sent: 2 }), at(73))).toBe('expired');
  });

  it('never exceeds the hard cap', () => {
    expect(dueStage(inv({ reminders_sent: MAX_REMINDERS }), at(73))).toBeNull();
    expect(dueStage(inv({ reminders_sent: MAX_REMINDERS }), at(200))).toBeNull();
  });

  it('an opened-but-unaccepted invitation gets 2 emails, not 3', () => {
    // 24h: skipped (opened). 60h: final. expiry: expired. Total 2.
    const opened = inv({ opened_at: at(1) });
    expect(dueStage(opened, at(24))).toBeNull();
    expect(dueStage({ ...opened, reminders_sent: 0 }, at(60))).toBe('final');
    expect(dueStage({ ...opened, reminders_sent: 1 }, at(73))).toBe('expired');
    // After the expiry notice reminders_sent is 3, so the cap stops everything.
    expect(dueStage({ ...opened, reminders_sent: 3 }, at(80))).toBeNull();
  });

  it('an ignored invitation gets exactly 3 emails', () => {
    const ignored = inv();
    expect(dueStage(ignored, at(24))).toBe('nudge');
    expect(dueStage({ ...ignored, reminders_sent: 1 }, at(60))).toBe('final');
    expect(dueStage({ ...ignored, reminders_sent: 2 }, at(73))).toBe('expired');
    expect(dueStage({ ...ignored, reminders_sent: 3 }, at(90))).toBeNull();
  });
});
