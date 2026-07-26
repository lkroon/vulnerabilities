import {
  EMPTY_SEVERITY_COUNTS,
  SEVERITIES,
  totalFindings,
  type SeverityCounts,
} from './severity';

describe('severity', () => {
  it('orders severities most to least urgent', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('starts empty counts at zero for every severity', () => {
    for (const severity of SEVERITIES) {
      expect(EMPTY_SEVERITY_COUNTS[severity]).toBe(0);
    }
  });

  it('sums findings across severities', () => {
    const counts: SeverityCounts = {
      critical: 1,
      high: 3,
      medium: 7,
      low: 0,
    };
    expect(totalFindings(counts)).toBe(11);
  });

  it('totals zero for empty counts', () => {
    expect(totalFindings(EMPTY_SEVERITY_COUNTS)).toBe(0);
  });
});
