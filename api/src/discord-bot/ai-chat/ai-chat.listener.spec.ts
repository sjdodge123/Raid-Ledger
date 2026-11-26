/**
 * ROK-2354 — the AI chat DM and `ai:*` button handlers are AI-plugin
 * behaviours: while the `ai` plugin is off a DM is ignored and a press gets
 * the ephemeral "disabled" reply, with no AiChatService (LLM/DB) call.
 * With the plugin on both paths are unchanged.
 */
import { Test } from '@nestjs/testing';
import type { ButtonInteraction, Message } from 'discord.js';
import { AiChatListener, AI_CHAT_DISABLED_COPY } from './ai-chat.listener';
import { AiChatService, type AiChatResponse } from './ai-chat.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';

const RESPONSE: AiChatResponse = {
  content: 'Hello',
  embeds: [],
  components: [],
  rows: [],
};

function dm(): { msg: Message; reply: jest.Mock } {
  const reply = jest.fn().mockResolvedValue(undefined);
  const msg = {
    author: { id: 'u1', bot: false },
    content: 'what events are on?',
    reply,
  } as unknown as Message;
  return { msg, reply };
}

function press(): {
  interaction: ButtonInteraction;
  deferReply: jest.Mock;
  editReply: jest.Mock;
} {
  const deferReply = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId: 'ai:events',
    user: { id: 'u1' },
    deferReply,
    editReply,
  } as unknown as ButtonInteraction;
  return { interaction, deferReply, editReply };
}

describe('AiChatListener — AI plugin gate (ROK-2354)', () => {
  let listener: AiChatListener;
  let plugins: { isActive: jest.Mock };
  let chat: { handleInteraction: jest.Mock };

  beforeEach(async () => {
    plugins = { isActive: jest.fn().mockReturnValue(true) };
    chat = { handleInteraction: jest.fn().mockResolvedValue(RESPONSE) };
    const module = await Test.createTestingModule({
      providers: [
        AiChatListener,
        {
          provide: DiscordBotClientService,
          useValue: { getClient: jest.fn() },
        },
        { provide: AiChatService, useValue: chat },
        { provide: PluginRegistryService, useValue: plugins },
      ],
    }).compile();
    listener = module.get(AiChatListener);
  });

  it('ignores a DM (no chat call, no reply) while the AI plugin is off', async () => {
    plugins.isActive.mockReturnValue(false);
    const { msg, reply } = dm();
    await listener.handleDm(msg);
    expect(plugins.isActive).toHaveBeenCalledWith('ai');
    expect(chat.handleInteraction).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('answers a DM as before while the AI plugin is on', async () => {
    const { msg, reply } = dm();
    await listener.handleDm(msg);
    expect(chat.handleInteraction).toHaveBeenCalledWith(
      'u1',
      'what events are on?',
    );
    expect(reply).toHaveBeenCalledWith({ content: 'Hello' });
  });

  it('refuses a button press ephemerally with no chat call while the AI plugin is off', async () => {
    plugins.isActive.mockReturnValue(false);
    const { interaction, deferReply, editReply } = press();
    await listener.handleButton(interaction);
    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(chat.handleInteraction).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith({ content: AI_CHAT_DISABLED_COPY });
  });

  it('answers a button press as before while the AI plugin is on', async () => {
    const { interaction, editReply } = press();
    await listener.handleButton(interaction);
    expect(chat.handleInteraction).toHaveBeenCalledWith(
      'u1',
      undefined,
      'ai:events',
    );
    expect(editReply).toHaveBeenCalledWith({ content: 'Hello' });
  });
});
