import { Update, On, Ctx, Start, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import {
  PendingExpense,
  TelegramBotService,
  WITHOUT_TAG_CALLBACK,
  toCurrencyCode,
} from './telegram-bot.service';
import { Logger } from '@nestjs/common';
import { ReceiptResultDto } from '../receipts/dto/receipt-result.dto';
import {
  CoreCategory,
  TelegramAccountNotLinkedError,
} from '../core-api/core-api.service';

const TRIP_SWITCH_PREFIX = 'trip:';
const TRIP_OFF_CALLBACK = 'trip_off';
/** How many recent tags /trip offers as buttons. */
const RECENT_TAGS_SHOWN = 5;
/** Telegram rejects a keyboard whose callback data exceeds 64 bytes. */
const MAX_CALLBACK_DATA_BYTES = 64;

const NOT_LINKED_MESSAGE =
  '🔗 Your Telegram account is not linked to the app. Link it in the app and send the expense again.';

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
      'I will extract and return structured expense information.\n\n' +
      'On a trip? /trip <name> tags every new expense until /trip off.',
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

  /**
   * `/trip <name>` sets the active tag, `/trip off` clears it, `/trip` alone
   * shows it and offers recent tags to switch to. Declared before the text
   * handler so the command does not also reach the receipt analyzer.
   */
  @Command('trip')
  async onTrip(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id;
    const msg = ctx.message;
    if (!telegramId || !msg || !('text' in msg)) return;

    const arg = msg.text.replace(/^\/trip(@\S+)?/i, '').trim();

    try {
      if (!arg) {
        await this.showTrip(ctx, telegramId);
      } else if (arg.toLowerCase() === 'off') {
        await this.setTrip(ctx, telegramId, null);
      } else {
        await this.setTrip(ctx, telegramId, arg);
      }
    } catch (error) {
      if (error instanceof TelegramAccountNotLinkedError) {
        await ctx.reply(NOT_LINKED_MESSAGE);
        return;
      }
      this.logger.error(`/trip failed: ${error.message}`, error.stack);
      await ctx.reply('❌ Could not reach the app. Please try again later.');
    }
  }

  private async showTrip(ctx: Context, telegramId: number) {
    const [user, tags] = await Promise.all([
      this.botService.getMe(telegramId),
      this.botService.getTags(telegramId),
    ]);
    const activeTag = user.activeTag ?? null;

    const buttons = tags
      .map(({ tag }) => tag)
      .filter((tag) => tag !== activeTag)
      .filter(
        (tag) =>
          Buffer.byteLength(TRIP_SWITCH_PREFIX + tag) <=
          MAX_CALLBACK_DATA_BYTES,
      )
      .slice(0, RECENT_TAGS_SHOWN)
      .map((tag) => [
        Markup.button.callback(`#${tag}`, TRIP_SWITCH_PREFIX + tag),
      ]);
    if (activeTag) {
      buttons.push([Markup.button.callback('Turn off', TRIP_OFF_CALLBACK)]);
    }

    const text =
      (activeTag
        ? `🏷 Active trip: #${activeTag}. New expenses get this tag.`
        : 'No active trip. New expenses are saved without a tag.') +
      '\n\nSet one with /trip <name>, clear it with /trip off.';

    await ctx.reply(
      text,
      buttons.length > 0
        ? { reply_markup: Markup.inlineKeyboard(buttons).reply_markup }
        : undefined,
    );
  }

  private async setTrip(ctx: Context, telegramId: number, tag: string | null) {
    const user = await this.botService.setActiveTag(telegramId, tag);
    const activeTag = user.activeTag ?? null;
    if (activeTag) {
      await ctx.reply(
        `🏷 Active trip: #${activeTag}. New expenses get this tag until /trip off.`,
      );
    } else if (tag === null) {
      await ctx.reply('Trip turned off. New expenses are saved without a tag.');
    } else {
      // The API normalises the name; nothing usable left means it cleared it.
      await ctx.reply(
        `⚠️ "${tag}" is not a usable tag name (letters, digits, - and _), so no trip is active now.`,
      );
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
      if (data.startsWith(TRIP_SWITCH_PREFIX) || data === TRIP_OFF_CALLBACK) {
        const telegramId = ctx.from?.id;
        if (!telegramId) {
          await ctx.answerCbQuery();
          return;
        }
        const tag =
          data === TRIP_OFF_CALLBACK
            ? null
            : data.slice(TRIP_SWITCH_PREFIX.length);
        try {
          await this.setTrip(ctx, telegramId, tag);
        } catch (error) {
          if (error instanceof TelegramAccountNotLinkedError) throw error;
          this.logger.error(
            `Trip switch failed: ${error.message}`,
            error.stack,
          );
          await ctx.answerCbQuery(
            'Could not switch the trip. Please try again.',
          );
          return;
        }
        await ctx.answerCbQuery();
        return;
      }

      if (data === WITHOUT_TAG_CALLBACK) {
        const pending = this.botService.getPendingExpense(chatId);
        if (!pending) {
          await ctx.answerCbQuery('Session expired. Please send the receipt again.');
          return;
        }
        if (this.isPressedByOtherUser(ctx, pending)) {
          await ctx.answerCbQuery();
          return;
        }
        this.botService.setPendingExpense(chatId, {
          ...pending,
          untagged: true,
        });
        await ctx.answerCbQuery(
          pending.activeTag
            ? `This expense will be saved without #${pending.activeTag}`
            : 'This expense will be saved without a tag',
        );
        await this.dropWithoutTagButton(ctx);
        return;
      }

      if (data.startsWith('cat_')) {
        const categoryId = data.slice(4);
        const pending = this.botService.getPendingExpense(chatId);
        if (!pending) {
          await ctx.answerCbQuery('Session expired. Please send the receipt again.');
          return;
        }
        if (this.isPressedByOtherUser(ctx, pending)) {
          await ctx.answerCbQuery();
          return;
        }
        const funds = await this.botService.getFunds(pending.telegramId);
        this.botService.setPendingExpense(chatId, {
          ...pending,
          categoryId,
          funds,
        });
        const keyboard = this.botService.buildFundKeyboard(funds);
        await ctx.reply('Choose an account (or "No account"):', {
          reply_markup: keyboard,
        });
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('fund_')) {
        const fundId = data === 'fund_none' ? null : data.slice(5);
        if (
          this.isPressedByOtherUser(
            ctx,
            this.botService.getPendingExpense(chatId),
          )
        ) {
          await ctx.answerCbQuery();
          return;
        }
        try {
          const saved = await this.botService.createCost(chatId, fundId);
          await ctx.reply(saved);
          await ctx.answerCbQuery();
          return;
        } catch (err: any) {
          const apiError = err.response?.data?.error;
          if (
            typeof apiError === 'string' &&
            apiError.startsWith('Exchange rate not found')
          ) {
            // Retrying cannot help: the currency itself is unknown to the API.
            this.botService.clearPendingExpense(chatId);
            await ctx.answerCbQuery();
            await ctx.reply(`❌ Not saved: ${apiError}.`);
            return;
          }
          if (apiError === 'Insufficient funds') {
            await ctx.answerCbQuery();
            const pending = this.botService.getPendingExpense(chatId);
            if (pending) {
              const funds = await this.botService.getFunds(pending.telegramId);
              this.botService.setPendingExpense(chatId, { ...pending, funds });
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
      if (error instanceof TelegramAccountNotLinkedError) {
        this.botService.clearPendingExpense(chatId);
        await ctx.answerCbQuery().catch(() => undefined);
        await ctx.reply(NOT_LINKED_MESSAGE);
        return;
      }
      this.logger.error(`Callback error: ${error.message}`, error.stack);
      await ctx.answerCbQuery('Failed to save expense. Please try again.');
      return;
    }

    await ctx.answerCbQuery();
  }

  /**
   * Only the Telegram user who started a pending expense may complete it.
   * Pending expenses are kept per chat; this holds even if an update from a
   * shared chat ever gets past the private-chat guard.
   */
  private isPressedByOtherUser(
    ctx: Context,
    pending: PendingExpense | undefined,
  ): boolean {
    return pending !== undefined && ctx.from?.id !== pending.telegramId;
  }

  /** Removes the "without #tag" row from the message whose button was pressed. */
  private async dropWithoutTagButton(ctx: Context) {
    const msg = ctx.callbackQuery?.message;
    const markup = msg && 'reply_markup' in msg ? msg.reply_markup : undefined;
    if (!markup) return;
    const rows = markup.inline_keyboard.filter(
      (row) =>
        !row.some(
          (button) =>
            'callback_data' in button &&
            button.callback_data === WITHOUT_TAG_CALLBACK,
        ),
    );
    await ctx
      .editMessageReplyMarkup({ inline_keyboard: rows })
      .catch((error: Error) =>
        this.logger.warn(`Could not update the keyboard: ${error.message}`),
      );
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

    let categories: CoreCategory[];
    try {
      categories = await this.botService.getCategories(telegramId);
    } catch (error) {
      if (error instanceof TelegramAccountNotLinkedError) {
        await ctx.reply(message + '\n\n' + NOT_LINKED_MESSAGE);
        return;
      }
      throw error;
    }
    if (categories.length === 0) {
      await ctx.reply(
        message + '\n\nNo categories available. Add categories in the app to save expenses.',
      );
      return;
    }

    let activeTag: string | null = null;
    try {
      activeTag = (await this.botService.getMe(telegramId)).activeTag ?? null;
    } catch (error) {
      if (error instanceof TelegramAccountNotLinkedError) {
        await ctx.reply(message + '\n\n' + NOT_LINKED_MESSAGE);
        return;
      }
      // The API still applies the active tag; the saved reply will show it.
      this.logger.warn(`Could not read the active tag: ${error.message}`);
    }

    const dto = result as ReceiptResultDto;
    const date = dto.date || new Date().toISOString();
    this.botService.setPendingExpense(chatId, {
      amount: dto.total,
      currency: toCurrencyCode(dto.currency),
      comment: dto.merchant ?? undefined,
      date,
      telegramId,
      activeTag,
    });

    const tagLine = activeTag ? `🏷 Trip: #${activeTag}\n\n` : '';
    const keyboard = this.botService.buildCategoryKeyboard(
      categories,
      activeTag,
    );
    await ctx.reply(message + '\n' + tagLine + 'Choose a category to save:', {
      reply_markup: keyboard,
    });
  }
}

