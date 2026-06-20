export * from './config.js';
export {
  computeProForma,
  suggestOffer,
  smallerSqftVariant,
  type ProFormaResult,
} from './proforma.js';
export { deriveFlags, type ResearchBag } from './flags.js';
export { computeScore, type ScoreInput, type ScoreBreakdown } from './score.js';
export {
  synthesizeFeasibility,
  type Feasibility,
  type FeasibilityInput,
} from './feasibility.js';
