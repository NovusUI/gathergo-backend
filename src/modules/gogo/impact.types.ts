export type ImpactSuggestionConfidence = 'high' | 'medium' | 'low';
export type ImpactSuggestionSource = 'ai';
export type { RegistrationType as ImpactRegistrationType } from '@prisma/client';

export interface SuggestedSdgGoal {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  color: string;
  confidence: ImpactSuggestionConfidence;
  source: ImpactSuggestionSource;
}

export interface SuggestedImpactPath {
  id: string;
  title: string;
  summaryLabel: string;
  description: string;
  confidence: ImpactSuggestionConfidence;
  source: ImpactSuggestionSource;
}

export interface SuggestedImpactCommitment {
  id: string;
  type: string;
  value: number;
  unit: string;
  label: string;
  confidence: ImpactSuggestionConfidence;
  source: ImpactSuggestionSource;
}

export interface ImpactSuggestionData {
  sdgGoals: SuggestedSdgGoal[];
  impactPaths: SuggestedImpactPath[];
  commitments: SuggestedImpactCommitment[];
  source: ImpactSuggestionSource;
}

export type SdgGoalDefinition = Omit<SuggestedSdgGoal, 'confidence' | 'source'>;
export type ImpactPathDefinition = Omit<
  SuggestedImpactPath,
  'confidence' | 'source'
>;

export type AiImpactSuggestionData = {
  sdgGoals: Pick<SuggestedSdgGoal, 'id' | 'confidence'>[];
  impactPaths: Pick<SuggestedImpactPath, 'id' | 'confidence'>[];
  commitments: (Omit<SuggestedImpactCommitment, 'id' | 'source'> & {
    evidence: string;
  })[];
};
