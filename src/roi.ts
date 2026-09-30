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
