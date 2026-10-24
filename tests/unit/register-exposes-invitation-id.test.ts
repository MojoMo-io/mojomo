// mojomo_ask_to_vouch needs an invitation id. Before this, the register
// response exposed only invite_url, so an agent had to parse a UUID out of a
// URL to use the tool. That is exactly the kind of friction that makes an
// agent give up. Pin the field so it cannot silently disappear.
import * as agents from '../../src/services/agents';

describe('register exposes invitation_id', () => {
  it('the register return type carries invitation_id', () => {
    // Compile-time contract: if the field is removed from the signature this
    // file stops building, which fails the suite.
    type R = Awaited<ReturnType<typeof agents.registerAgent>>;
    const check: R['invitation_id'] extends string ? true : false = true;
    expect(check).toBe(true);
  });
});
