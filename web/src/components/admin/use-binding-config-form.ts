import { useState } from "react";
import type {
  ChannelBindingDto,
  IgdbGameDto,
  UpdateChannelBindingDto,
} from "@raid-ledger/contract";
import {
  classifyBindingTriple,
  deriveBindingPurpose,
  pruneConfigForPurpose,
  type BindingPurpose,
} from "@raid-ledger/contract";

function toInitialGame(binding: ChannelBindingDto): IgdbGameDto | null {
  if (binding.gameId == null) return null;
  return {
    id: binding.gameId,
    igdbId: null,
    name: binding.gameName ?? `Game #${binding.gameId}`,
    slug: "",
    coverUrl: null,
  };
}

export function useBindingConfigForm(binding: ChannelBindingDto) {
  const [purpose, setPurpose] = useState<BindingPurpose>(
    binding.bindingPurpose,
  );
  const [game, setGame] = useState<IgdbGameDto | null>(() =>
    toInitialGame(binding),
  );
  const [minPlayers, setMinPlayers] = useState(binding.config?.minPlayers ?? 2);
  const [autoClose, setAutoClose] = useState(binding.config?.autoClose ?? true);
  const [gracePeriod, setGracePeriod] = useState(
    binding.config?.gracePeriod ?? 5,
  );
  const [allowJustChatting, setAllowJustChatting] = useState(
    binding.config?.allowJustChatting ?? false,
  );

  const channelType = binding.channelType;
  const gameId = game?.id ?? null;
  const violation = classifyBindingTriple(channelType, purpose, gameId);
  const gameRequired = violation?.code === "BINDING_MONITOR_REQUIRES_GAME";

  // Clearing the game auto-derives the purpose (voice → General Lobby) so the
  // triple stays valid without the operator touching the purpose select (AC6).
  const handleGameChange = (next: IgdbGameDto | null) => {
    setGame(next);
    if (next == null) setPurpose(deriveBindingPurpose(channelType, null));
  };

  const buildDto = (finalPurpose: BindingPurpose): UpdateChannelBindingDto => {
    const dto: UpdateChannelBindingDto = {
      config: pruneConfigForPurpose(
        { minPlayers, autoClose, gracePeriod, allowJustChatting },
        finalPurpose,
      ),
    };
    if (finalPurpose !== binding.bindingPurpose)
      dto.bindingPurpose = finalPurpose;
    // Codex P2: saving as General Lobby CLEARS the game explicitly — the
    // field is hidden for lobbies, so a silently-kept game would be
    // uneditable and contradict the form copy ("Voice, no game = lobby").
    const effectiveGameId = finalPurpose === "general-lobby" ? null : gameId;
    if (effectiveGameId !== (binding.gameId ?? null))
      dto.gameId = effectiveGameId;
    return dto;
  };

  return {
    purpose,
    setPurpose,
    game,
    handleGameChange,
    gameRequired,
    violation,
    channelType,
    gameId,
    buildDto,
    minPlayers,
    setMinPlayers,
    autoClose,
    setAutoClose,
    gracePeriod,
    setGracePeriod,
    allowJustChatting,
    setAllowJustChatting,
  };
}
