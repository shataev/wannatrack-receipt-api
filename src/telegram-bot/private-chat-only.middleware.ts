import { Context, MiddlewareFn } from 'telegraf';

/**
 * Drops every update that does not come from a private chat.
 *
 * Pending expenses are kept per chat, so in a group any member could press
 * the category/account buttons and complete someone else's expense. The bot
 * is only meant to be used one-to-one.
 */
export const privateChatOnly: MiddlewareFn<Context> = (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    return;
  }
  return next();
};
