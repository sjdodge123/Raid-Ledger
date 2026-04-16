import type { TreeResult, TreeHandler } from './tree.types';

/** Handle "Polls" tree path. Shows active schedule poll info. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const handlePolls: TreeHandler = (path, deps, session) => {
  return Promise.resolve<TreeResult>({
    data: null,
    emptyMessage: 'No active polls right now. Check back later!',
    buttons: [],
    isLeaf: true,
  });
};
