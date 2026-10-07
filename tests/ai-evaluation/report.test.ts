import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Load the same pure ESM grading functions used by the Node report runner.
const require = createRequire(import.meta.url);
const { mapAssertions, validateCases } = require('../../evals/ai/report.mjs') as {
  mapAssertions: (cases: {id:string}[], run:unknown) => {status:string}[];
  validateCases: (cases:unknown[],sources:unknown[]) => unknown[];
};
describe('AI evaluation result integrity', () => {
  it('does not mark a declared, skipped or duplicated case PASS', () => {
    const cases=[{id:'OPS-001'},{id:'OPS-002'},{id:'OPS-003'},{id:'OPS-004'}];
    const actual={testResults:[{assertionResults:[
      {title:'OPS-001: actually ran',fullName:'suite OPS-001: actually ran',status:'passed'},
      {title:'OPS-002 skipped',status:'pending'},
      {title:'OPS-003 duplicate',status:'passed'},
      {title:'OPS-003 duplicate again',status:'passed'},
      {title:'OPS-0040 substring collision',status:'passed'},
    ]}]};
    expect(mapAssertions(cases,actual).map(x=>x.status)).toEqual(['PASS','SKIP','NOT_RUN','NOT_RUN']);
  });
  it('reports an actually failing case and rejects an empty dataset', () => {
    expect(mapAssertions([{id:'OPS-001'}],{testResults:[{assertionResults:[{title:'OPS-001 failed',status:'failed',failureMessages:['synthetic failure']}]}]})[0].status).toBe('FAIL');
    expect(()=>validateCases([],[])).toThrow('Empty case manifest');
  });
  it('does not reuse one assertion or an ancestor title for multiple cases', () => {
    const run={testResults:[{assertionResults:[{title:'OPS-001 OPS-002',status:'passed'},
      {title:'ordinary test',fullName:'OPS-003 ordinary test',status:'passed'}]}]};
    expect(mapAssertions([{id:'OPS-001'},{id:'OPS-002'},{id:'OPS-003'}],run).map(x=>x.status)).toEqual(['NOT_RUN','NOT_RUN','NOT_RUN']);
  });
});
