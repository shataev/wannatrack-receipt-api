import { Update, On, Ctx, Start } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramBotService } from './telegram-bot.service';
import { Logger } from '@nestjs/common';
import { ReceiptResultDto } from '../receipts/dto/receipt-result.dto';

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
    const telegramId = ctx.from?.id;

    if (!chatId || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const text = ctx.message.text;
    if (!text) {
      return;
    }

    try {
      await ctx.telegram.sendChatAction(chatId, 'typing');

      const result = await this.botService.handleText(chatId, text);
      await this.replyWithExpenseAndSaveOption(ctx, chatId, telegramId, result);
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
    const telegramId = ctx.from?.id;

    if (!chatId) {
      return;
    }

    try {
      await ctx.telegram.sendChatAction(chatId, 'upload_photo');

      const result = await this.botService.handlePhoto(ctx);
      await this.replyWithExpenseAndSaveOption(ctx, chatId, telegramId, result);
    } catch (error) {
      this.logger.error(`Error handling photo message: ${error.message}`, error.stack);
      await ctx.reply(
        '❌ Sorry, I could not process the receipt image. Please make sure the image is clear and try again.',
      );
    }
  }

  @On('callback_query')
  async onCallbackQuery(@Ctx() ctx: Context) {
    const cb = ctx.callbackQuery;
    const msg = cb?.message;
    const chatId = msg && 'chat' in msg ? msg.chat.id : ctx.chat?.id;
    const data =
      cb && 'data' in cb && typeof cb.data === 'string' ? cb.data : undefined;

    if (!data || chatId === undefined) {
      await ctx.answerCbQuery();
      return;
    }

    try {
      if (data.startsWith('cat_')) {
        const categoryId = data.slice(4);
        const pending = this.botService.getPendingExpense(chatId);
        if (!pending) {
          await ctx.answerCbQuery('Session expired. Please send the receipt again.');
          return;
        }
        this.botService.setPendingExpense(chatId, { ...pending, categoryId });
        const funds = await this.botService.getFunds(pending.userId);
        const keyboard = this.botService.buildFundKeyboard(funds);
        await ctx.reply('Choose an account (or "No account"):', {
          reply_markup: keyboard,
        });
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('fund_')) {
        const fundId = data === 'fund_none' ? null : data.slice(5);
        try {
          await this.botService.createCost(chatId, fundId);
          await ctx.reply('✅ Expense saved.');
          await ctx.answerCbQuery();
          return;
        } catch (err: any) {
          const apiError = err.response?.data?.error;
          if (apiError === 'Insufficient funds') {
            await ctx.answerCbQuery();
            const pending = this.botService.getPendingExpense(chatId);
            if (pending) {
              const funds = await this.botService.getFunds(pending.userId);
              const keyboard = this.botService.buildFundKeyboard(funds);
              await ctx.reply(
                '💸 Insufficient funds in the selected account. Choose another account or "No account":',
                { reply_markup: keyboard },
              );
            } else {
              await ctx.reply('❌ Session expired. Please send the receipt again.');
            }
            return;
          }
          throw err;
        }
      }
    } catch (error) {
      this.logger.error(`Callback error: ${error.message}`, error.stack);
      await ctx.answerCbQuery('Failed to save expense. Please try again.');
      return;
    }

    await ctx.answerCbQuery();
  }

  private async replyWithExpenseAndSaveOption(
    ctx: Context,
    chatId: number,
    telegramId: number | undefined,
    result: any,
  ) {
    const message = this.botService.formatExpenseResult(result);

    if (!telegramId) {
      await ctx.reply(message);
      return;
    }

    const userId = await this.botService.getUserIdByTelegramId(telegramId);
    if (!userId) {
      await ctx.reply(
        message + '\n\nLink your account in the app to save expenses.',
      );
      return;
    }

    const categories = await this.botService.getCategories(userId);
    if (categories.length === 0) {
      await ctx.reply(
        message + '\n\nNo categories available. Add categories in the app to save expenses.',
      );
      return;
    }

    const dto = result as ReceiptResultDto;
    const date = dto.date || new Date().toISOString();
    this.botService.setPendingExpense(chatId, {
      amount: dto.total,
      currency: dto.currency || 'RUB',
      comment: dto.merchant ?? undefined,
      date,
      userId,
    });

    const keyboard = this.botService.buildCategoryKeyboard(categories);
    await ctx.reply(message + '\n\nChoose a category to save:', {
      reply_markup: keyboard,
    });
  }
}

