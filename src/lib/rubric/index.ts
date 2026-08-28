export type {
  AuthoredCriterion,
  AuthoredLevel,
  AuthoredRubric,
  BandEdges,
  CriterionOutcome,
  Level,
  NormalCriterion,
  NormalLevel,
  NormalRubric,
  Nudge,
  ScoreResult,
  Selection,
} from "./types";

export {
  BAND_PRESETS,
  DEFAULT_BAND_EDGES,
  DEFAULT_LETTER_SCALE,
  HOUSE_LABELS,
  bandEdgesProblem,
  fractionFor,
  letterFor,
  levelFractions,
  round1,
} from "./bands";

export { bandTable, computeScore, criterionPoints, previewOutcomes } from "./score";
export type { PreviewRow } from "./score";

export { repairMessage, validateRubric } from "./validate";
export type { Issue, ValidationResult } from "./validate";

export { convertLegacyRubric } from "./legacy";
export type { ConversionNote, ConversionResult, LegacyCriterion, LegacyLevel, LegacyRubric } from "./legacy";

export { fromSelections, isShareModel, toNormalRubric, toSelections } from "./adapter";
export type { DbCriterionRow, DbLevelRow, DbRubricRow, DbSelectionRow } from "./adapter";
