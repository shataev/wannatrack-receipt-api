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
    await ctx.reply(
      '👋 Hello! I can help you track expenses.\n\n' +
      'Send me:\n' +
      '• Text messages like "I bought a tent in Decathlon for 3000 rubles yesterday"\n' +
      '• Receipt photos\n\n' +
      'I will extract and return structured expense information.',
    );
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

