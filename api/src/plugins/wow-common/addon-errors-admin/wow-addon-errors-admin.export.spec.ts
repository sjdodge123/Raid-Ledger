import {
  capRows,
  EXPORT_ROW_CAP_HEADER,
  EXPORT_TRUNCATED_HEADER,
  exportTruncationHeaders,
} from './wow-addon-errors-admin.export';

describe('capRows (ROK-2099 S3)', () => {
  it('keeps every row and is not truncated when the fetch fits the cap', () => {
    expect(capRows([1, 2, 3], 3)).toEqual({
      rows: [1, 2, 3],
      truncated: false,
    });
    expect(capRows([], 3)).toEqual({ rows: [], truncated: false });
  });

  it('drops the probe row and flags truncation when the fetch exceeds the cap', () => {
    expect(capRows([1, 2, 3, 4], 3)).toEqual({
      rows: [1, 2, 3],
      truncated: true,
    });
  });
});

describe('exportTruncationHeaders (ROK-2099 S3)', () => {
  it('names the cap when the export was cut', () => {
    expect(exportTruncationHeaders(true, 10_000)).toEqual({
      [EXPORT_TRUNCATED_HEADER]: 'true',
      [EXPORT_ROW_CAP_HEADER]: '10000',
    });
  });

  it('sets nothing for a complete export', () => {
    expect(exportTruncationHeaders(false, 10_000)).toEqual({});
  });
});
