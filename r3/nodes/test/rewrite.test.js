import { queryRewriteNode } from '../rewrite.js';

jest.mock('../../../utils/query_rewrite.js', () => ({
    rewriteQuery: jest.fn().mockResolvedValue("Reranking 架构 检索增强")
}));

import { rewriteQuery } from '../../../utils/query_rewrite.js';

test('queryRewriteNode should return rewritten keywords in currentRewrites', async () => {
    const state = { query: 'original query' };
    const result = await queryRewriteNode(state);
    
    console.log('Test Result:', result);
    expect(result.currentRewrites).toEqual(['Reranking 架构 检索增强']);
    expect(rewriteQuery).toHaveBeenCalledWith('original query', []);
});

