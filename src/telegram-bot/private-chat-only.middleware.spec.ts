import { Context } from 'telegraf';
import { privateChatOnly } from './private-chat-only.middleware';

describe('privateChatOnly', () => {
  const run = (chat: unknown) => {
    const next = jest.fn().mockResolvedValue(undefined);
    void privateChatOnly({ chat } as unknown as Context, next);
    return next;
  };

  it('passes updates from a private chat through', () => {
    expect(run({ id: 1, type: 'private' })).toHaveBeenCalledTimes(1);
  });

  it.each(['group', 'supergroup', 'channel'])(
    'drops updates from a %s chat',
    (type) => {
      expect(run({ id: -100, type })).not.toHaveBeenCalled();
    },
  );

  it('drops updates without a chat', () => {
    expect(run(undefined)).not.toHaveBeenCalled();
  });
});
