import type { AdaptEventPlanRequest, EventPlanInput } from "@shared/ipc/contracts";

export type AdaptationTuning = {
  intensityBias: number;
  volumeBias: number;
};

export type AdaptationDecision = {
  nextInput: EventPlanInput;
  tuning: AdaptationTuning;
  strategy: string;
  metadata: Record<string, unknown>;
};

export interface PlanAdaptationService {
  adapt(baseInput: EventPlanInput, request: AdaptEventPlanRequest): AdaptationDecision;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizePrompt = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

class DeterministicFallbackAdaptationService implements PlanAdaptationService {
  adapt(baseInput: EventPlanInput, request: AdaptEventPlanRequest): AdaptationDecision {
    const prompt = normalizePrompt(request.adaptationPrompt);
    const ftp = request.overrides?.currentFtp ?? baseInput.currentFtp;
    const eventDate = request.overrides?.eventDate ?? baseInput.eventDate;
    const weeklyAvailability = request.overrides?.weeklyAvailability ?? baseInput.weeklyAvailability;

    let intensityBias = 0;
    let volumeBias = 0;
    if (prompt.includes("fatigue") || prompt.includes("tired") || prompt.includes("recover")) {
      intensityBias -= 0.06;
      volumeBias -= 0.12;
    }
    if (prompt.includes("sick") || prompt.includes("injury")) {
      intensityBias -= 0.08;
      volumeBias -= 0.2;
    }
    if (prompt.includes("busy") || prompt.includes("travel") || prompt.includes("less time")) {
      volumeBias -= 0.15;
    }
    if (prompt.includes("harder") || prompt.includes("aggressive") || prompt.includes("peak")) {
      intensityBias += 0.04;
      volumeBias += 0.08;
    }

    return {
      nextInput: {
        ...baseInput,
        currentFtp: clamp(Math.round(ftp), 100, 600),
        eventDate,
        weeklyAvailability
      },
      tuning: {
        intensityBias: clamp(intensityBias, -0.2, 0.1),
        volumeBias: clamp(volumeBias, -0.3, 0.15)
      },
      strategy: "deterministic-fallback-v1",
      metadata: {
        provider: "deterministic-fallback",
        promptApplied: prompt.length > 0,
        overridesApplied: !!request.overrides
      }
    };
  }
}

export const createPlanAdaptationService = (): PlanAdaptationService => {
  const provider = process.env.KICKR_AI_ADAPTATION_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "deterministic") {
    return new DeterministicFallbackAdaptationService();
  }
  return new DeterministicFallbackAdaptationService();
};
