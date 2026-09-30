export function computeRoi(input: { eligiblePerMonth: number; minutesSavedPerIncident: number; loadedHourlyCost: number }): {
  monthlyValue: number;
  formula: string;
} {
  const { eligiblePerMonth, minutesSavedPerIncident, loadedHourlyCost } = input;
  const monthlyValue = (eligiblePerMonth * minutesSavedPerIncident) / 60 * loadedHourlyCost;
  return {
    monthlyValue: Math.round(monthlyValue * 100) / 100,
    formula: `${eligiblePerMonth} × ${minutesSavedPerIncident} ÷ 60 × $${loadedHourlyCost}`,
  };
}

export const ROI_LOW = { eligiblePerMonth: 100, minutesSavedPerIncident: 25, loadedHourlyCost: 60 };
export const ROI_HIGH = { eligiblePerMonth: 500, minutesSavedPerIncident: 40, loadedHourlyCost: 100 };

// Wilson score lower bound (95%) for a pass rate. Point estimates on small
// suites overclaim; report this alongside raw counts, never instead of them.
export function wilsonLower95(passed: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96;
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.round(((center - margin) / denom) * 1000) / 1000;
}
