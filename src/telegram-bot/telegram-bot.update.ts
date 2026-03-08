import { Update, On, Ctx, Start } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramBotService } from './telegram-bot.service';
import { Logger } from '@nestjs/common';

@Update()
export class TelegramBotUpdate {
  private readonly logger = new Logger(TelegramBotUpdate.name);

  constructor(private readonly botService: TelegramBotService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const payload = this.getStartPayload(ctx);
    if (payload?.startsWith('bind_')) {
      await this.handleTelegramBinding(ctx, payload);
      return;
    }

    await ctx.reply(
      '👋 Hello! I can help you track expenses.\n\n' +
      'Send me:\n' +
      '• Text messages like "I bought a tent in Decathlon for 3000 rubles yesterday"\n' +
      '• Receipt photos\n\n' +
      'I will extract and return structured expense information.',
    );
  }

  /** Get start payload from deep link (e.g. t.me/bot?start=bind_xxx) */
  private getStartPayload(ctx: Context): string | undefined {
    const msg = ctx.message;
    if (!msg || !('text' in msg) || !msg.text) return undefined;
    const parts = msg.text.split(/\s+/);
    return parts.length >= 2 ? parts[1] : undefined;
  }

  /** Handle account binding when user opens link from app (bind_<token>) */
  private async handleTelegramBinding(ctx: Context, payload: string) {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.reply('❌ Could not identify your Telegram account. Please try again.');
      return;
    }

    try {
      await this.botService.bindTelegramAccount(payload, telegramId);
      await ctx.reply(
        '✅ Your Telegram account has been successfully linked to the app. You can now use the bot for expense tracking.',
      );
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.message;
      this.logger.warn(`Telegram bind failed for user ${telegramId}: ${message || error.message}`);

      if (status === 400 && message?.toLowerCase().includes('expired')) {
        await ctx.reply(
          '⏱ This binding link has expired. Please generate a new link in the app and try again.',
        );
      } else if (status === 400) {
        await ctx.reply('❌ Invalid or already used binding link. Please generate a new link in the app.');
      } else {
        await ctx.reply('❌ Failed to link your account. Please try again later.');
      }
    }
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    const chatId = ctx.chat?.id;

    if (!chatId || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const text = ctx.message.text;
    if (!text) {
      return;
    }

    try {
      // Show typing indicator
      await ctx.telegram.sendChatAction(chatId, 'typing');

      // Process the text message
      const result = await this.botService.handleText(chatId, text);

      // Format and send the result
      const message = this.botService.formatExpenseResult(result);
      await ctx.reply(message);
    } catch (error) {
      this.logger.error(`Error handling text message: ${error.message}`, error.stack);
      await ctx.reply(
        '❌ Sorry, I could not process your message. Please try again or send a receipt photo.',
      );
    }
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      return;
    }

    try {
      // Show typing indicator
      await ctx.telegram.sendChatAction(chatId, 'upload_photo');

      // Process the photo
      const result = await this.botService.handlePhoto(ctx);

      // Format and send the result
      const message = this.botService.formatExpenseResult(result);
      await ctx.reply(message);
    } catch (error) {
      this.logger.error(`Error handling photo message: ${error.message}`, error.stack);
      await ctx.reply(
        '❌ Sorry, I could not process the receipt image. Please make sure the image is clear and try again.',
      );
    }
  }
}

