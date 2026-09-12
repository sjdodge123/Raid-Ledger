import { cohortSizeBucket } from './cohort-frequency-section';

describe('cohortSizeBucket (ROK-1310)', () => {
  it('collapses 6 and 7 into 6+ and leaves 1 unbucketed', () => {
    expect(cohortSizeBucket(7)).toBe('6+');
    expect(cohortSizeBucket(6)).toBe('6+');
    expect(cohortSizeBucket(1)).toBeNull();
    expect(cohortSizeBucket(2)).toBe('2');
    expect(cohortSizeBucket(5)).toBe('5');
  });
});
