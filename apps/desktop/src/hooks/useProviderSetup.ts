import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderCapability } from "@cemeworm/shared";
import {
  BUILT_IN_PROVIDER_IDS,
  PROVIDER_PRESETS,
  buildProviderCatalog,
  buildProviderConfigFromDraft,
  createDraftFromPreset,
  createDraftFromProvider,
  createModelProviderId,
  findPresetById,
  getModelProviderBaseId,
  type ProviderCatalogEntry,
  type ProviderDraft,
} from "../lib/providerPresets";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";
import type { OraProviderConfig, OraProviderStatus } from "../lib/runtimeClient";

interface UseProviderSetupOptions {
  initialPresetId?: string;
  syncSelectedProvider?: boolean;
  selectSavedProvider?: boolean;
}

function emptyDraft(): ProviderDraft {
  return createDraftFromPreset(PROVIDER_PRESETS[0], []);
}

export function useProviderSetup({
  initialPresetId,
  syncSelectedProvider = true,
  selectSavedProvider = true,
}: UseProviderSetupOptions = {}) {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const didInitializeRef = useRef(false);
  const providers = state.providerRegistry?.providers ?? [];
  const selectedProvider = providers.find(
    (provider) => provider.id === state.selectedProviderId,
  );
  const providerCatalog = useMemo(
    () => buildProviderCatalog(providers),
    [providers],
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [providerDraft, setProviderDraft] =
    useState<ProviderDraft>(emptyDraft);
  const [providerActionError, setProviderActionError] = useState<string>();

  const activePreset = useMemo(
    () => findPresetById(providerDraft.presetId),
    [providerDraft.presetId],
  );
  const selectedCatalogEntry = useMemo(
    () =>
      providerCatalog.find((entry) => entry.key === selectedProviderKey) ??
      providerCatalog.find((entry) =>
        entry.providers.some((provider) => provider.id === providerDraft.id),
      ) ??
      providerCatalog.find((entry) => entry.draft.id === providerDraft.id),
    [providerCatalog, providerDraft.id, selectedProviderKey],
  );
  const draftProvider = useMemo(
    () => buildProviderConfigFromDraft(providerDraft),
    [providerDraft],
  );
  const draftSecretStatus = state.providerSecretStatuses.find(
    (status) => status.providerId === providerDraft.id,
  );
  const draftProviderStatus: OraProviderStatus =
    state.providerStatuses.find(
      (status) => status.providerId === providerDraft.id,
    ) ??
    (draftProvider.type === "local_smoke"
      ? {
          providerId: providerDraft.id,
          state: "verified",
          detail: "Local smoke provider is ready.",
        }
      : draftSecretStatus?.hasSecret
        ? {
            providerId: providerDraft.id,
            state: "key_stored",
            detail: "API key stored. Run verify to confirm connectivity.",
          }
        : {
            providerId: providerDraft.id,
            state: "needs_key",
            detail: "API key required before verification.",
          });
  const modelProviderByModelId = useMemo(() => {
    return new Map(
      (selectedCatalogEntry?.providers ?? []).map((provider) => [
        provider.modelId,
        provider,
      ]),
    );
  }, [selectedCatalogEntry]);
  const isBuiltInProvider = BUILT_IN_PROVIDER_IDS.has(providerDraft.id);
  const isSavedProvider = providers.some(
    (provider) => provider.id === providerDraft.id,
  );
  const canDeleteProvider = isSavedProvider && !isBuiltInProvider;
  const needsSecret = providerDraft.type !== "local_smoke";
  const saveDisabled =
    !providerDraft.label.trim() ||
    !providerDraft.modelId.trim() ||
    ((providerDraft.type === "openai_compatible" ||
      providerDraft.type === "anthropic_compatible") &&
      !providerDraft.baseUrl.trim()) ||
    state.busyCommand !== undefined;

  useEffect(() => {
    if (didInitializeRef.current || providerCatalog.length === 0) {
      return;
    }
    const initialEntry =
      (initialPresetId
        ? providerCatalog.find((entry) => entry.preset.id === initialPresetId)
        : undefined) ?? providerCatalog[0];
    didInitializeRef.current = true;
    setSelectedProviderKey(initialEntry.key);
    setProviderDraft(initialEntry.draft);
  }, [initialPresetId, providerCatalog]);

  useEffect(() => {
    if (
      !syncSelectedProvider ||
      !selectedProvider ||
      selectedProvider.type === "local_smoke"
    ) {
      return;
    }
    const entry = providerCatalog.find((candidate) =>
      candidate.providers.some(
        (provider) => provider.id === selectedProvider.id,
      ),
    );
    setSelectedProviderKey(
      entry?.key ?? `provider:${getModelProviderBaseId(selectedProvider.id)}`,
    );
    setProviderDraft(createDraftFromProvider(selectedProvider));
  }, [providerCatalog, selectedProvider, syncSelectedProvider]);

  function updateDraft(patch: Partial<ProviderDraft>) {
    setProviderActionError(undefined);
    setProviderDraft((current) => ({ ...current, ...patch }));
  }

  function selectProviderEntry(entry: ProviderCatalogEntry) {
    setProviderActionError(undefined);
    setSelectedProviderKey(entry.key);
    setProviderDraft(entry.draft);
    if (selectSavedProvider && entry.provider) {
      dispatch({ type: "SET_PROVIDER", providerId: entry.provider.id });
    }
  }

  function addCustomProvider() {
    const preset = findPresetById("openai-compatible-generic");
    const draft = createDraftFromPreset(preset, providers);
    setProviderActionError(undefined);
    setSelectedProviderKey(`draft:${draft.id}`);
    setProviderDraft(draft);
  }

  async function saveProviderSecret(secret: string) {
    const trimmed = secret.trim();
    if (!trimmed) {
      setProviderActionError("Enter an API key before saving.");
      return false;
    }
    setProviderActionError(undefined);
    await actions.storeProviderSecret(providerDraft.id, trimmed);
    return true;
  }

  function buildProviderConfigForModel(modelId: string, enabled: boolean) {
    const existingProvider = modelProviderByModelId.get(modelId);
    const baseProviderId = getModelProviderBaseId(providerDraft.id);
    const providerId =
      existingProvider?.id ??
      (modelId === activePreset.defaultModelId
        ? baseProviderId
        : createModelProviderId(baseProviderId, modelId));
    return buildProviderConfigFromDraft({
      ...providerDraft,
      id: providerId,
      label: providerDraft.label.trim() || activePreset.label,
      modelId,
      enabled,
    });
  }

  async function verifyAndEnableProvider(secret?: string) {
    if (saveDisabled) {
      setProviderActionError("Complete the provider details before verifying.");
      return undefined;
    }
    if (needsSecret) {
      const trimmed = secret?.trim() ?? "";
      if (trimmed) {
        const saved = await saveProviderSecret(trimmed);
        if (!saved) {
          return undefined;
        }
      } else if (!draftSecretStatus?.hasSecret) {
        setProviderActionError("Enter an API key before verifying.");
        return undefined;
      }
    }

    const provider = buildProviderConfigForModel(providerDraft.modelId, true);
    const status = await actions.verifyProvider(provider);
    if (status?.state !== "verified") {
      setProviderActionError(
        status?.detail ?? "Provider verification failed.",
      );
      return status;
    }

    setProviderActionError(undefined);
    updateDraft({ enabled: true });
    await actions.upsertCustomProvider(provider, { select: true });
    return status;
  }

  async function saveProviderConfig(provider: OraProviderConfig) {
    await actions.upsertCustomProvider(provider, {
      select: provider.enabled !== false,
    });
  }

  function toggleCapability(capability: ProviderCapability) {
    updateDraft({
      capabilities: providerDraft.capabilities.includes(capability)
        ? providerDraft.capabilities.filter((entry) => entry !== capability)
        : [...providerDraft.capabilities, capability],
    });
  }

  return {
    actions,
    activePreset,
    canDeleteProvider,
    draftProvider,
    draftProviderStatus,
    draftSecretStatus,
    isSavedProvider,
    modelProviderByModelId,
    needsSecret,
    providerActionError,
    providerCatalog,
    providerDraft,
    providers,
    saveDisabled,
    selectedCatalogEntry,
    selectedProvider,
    selectedProviderKey,
    addCustomProvider,
    buildProviderConfigForModel,
    saveProviderConfig,
    saveProviderSecret,
    selectProviderEntry,
    setProviderDraft,
    setProviderKey: setSelectedProviderKey,
    setProviderActionError,
    toggleCapability,
    updateDraft,
    verifyAndEnableProvider,
  };
}
