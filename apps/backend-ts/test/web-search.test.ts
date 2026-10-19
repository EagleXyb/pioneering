/**
 * 联网搜索：DeepSeek Search 优先 + Bing 懒提炼降级
 *
 * 覆盖：
 *   - DeepSeek 请求/响应映射（含 128 字截断、Bearer 鉴权）
 *   - 降级链：DeepSeek 成功不触发 refine/Bing；失败/空结果才 refine + Bing
 *   - 全链路失败返回 null
 *   - summary / site_name 的消费（模型上下文与来源卡片）
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// 隔离真实 .env：web-search 只依赖这三个字段
vi.mock('../src/config/env.js', () => ({
  env: {
    LLM_BASE_URL: 'https://api.deepseek.com/v1',
    LLM_API_KEY: 'test-key',
    LLM_DEFAULT_MODEL: 'deepseek-flash',
    // 让 resolveLlmSecrets 走 env 分支，不读取真实密钥文件
    SECRET_PROVIDER: 'env',
    LLM_SECRET_FILE: '',
  },
}));

import {
  webSearch,
  searchDeepSeek,
  formatSearchContext,
  toSourceItems,
} from '../src/core/web-search.js';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('searchDeepSeek', () => {
  afterEach(() => vi.restoreAllMocks());

  it('请求 DeepSeek Search 端点并映射响应字段', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: '标题',
            url: 'https://a.com/x',
            snippet: '短摘要',
            summary: '长摘要',
            site_name: 'A站点',
          },
        ],
      }),
    );

    const results = await searchDeepSeek('问题', 6, '原始问题');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: '标题',
      url: 'https://a.com/x',
      snippet: '短摘要',
      summary: '长摘要',
      siteName: 'A站点',
      source: 'DeepSeek',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: '问题',
      count: 6,
      ori_question: '原始问题',
      need_content: false,
    });
  });

  it('query / ori_question 超过 128 字时按 Unicode 截断', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ results: [] }));

    const long = '长'.repeat(200);
    await searchDeepSeek(long, 6, long);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { query: string; ori_question: string };
    expect(Array.from(body.query)).toHaveLength(128);
    expect(Array.from(body.ori_question)).toHaveLength(128);
  });

  it('HTTP 非 200（不可重试）时立即抛错', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 400 }),
    );
    await expect(searchDeepSeek('q', 6, 'q')).rejects.toThrow(
      'DeepSeek Search HTTP 400',
    );
    // 400 属不可重试错误，只请求一次
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('429 时退避重试，成功后返回结果', async () => {
    let calls = 0;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return new Response('', { status: 429 });
        return jsonResponse({
          results: [{ title: 'T', url: 'https://a.com', snippet: 'S' }],
        });
      });

    const results = await searchDeepSeek('q', 6, 'q');
    expect(results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe('webSearch 降级链', () => {
  afterEach(() => vi.restoreAllMocks());

  it('DeepSeek 有结果时直接返回，不再调用 refine / Bing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [{ title: 'T', url: 'https://a.com', snippet: 'S' }],
      }),
    );

    const outcome = await webSearch('测试问题');

    expect(outcome?.source).toBe('deepseek');
    expect(outcome?.results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('DeepSeek 失败时懒提炼关键词并降级 Bing', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/tools/search')) {
          // 400 不可重试，确保降级链只走一次 Search
          return new Response('err', { status: 400 });
        }
        if (url.includes('/chat/completions')) {
          return jsonResponse({
            choices: [{ message: { content: '提炼关键词' } }],
          });
        }
        if (url.includes('bing.com/search')) {
          return new Response(
            '<li class="b_algo"><h2><a href="https://b.com/page">B 标题</a></h2>'
              + '<p class="b_lineclamp">B 摘要</p></li>',
            { status: 200 },
          );
        }
        throw new Error(`unexpected url: ${url}`);
      });

    const outcome = await webSearch('一段很长的自然语言问题');

    expect(outcome?.source).toBe('bing');
    expect(outcome?.results[0]).toMatchObject({
      title: 'B 标题',
      url: 'https://b.com/page',
    });
    // 1 = DeepSeek 失败, 2 = refine, 3 = Bing
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const bingUrl = decodeURIComponent(String(fetchSpy.mock.calls[2][0]));
    expect(bingUrl).toContain('提炼关键词');
  });

  it('DeepSeek 返回空结果时也降级 Bing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/tools/search')) return jsonResponse({ results: [] });
      if (url.includes('/chat/completions')) {
        return jsonResponse({ choices: [{ message: { content: 'kw' } }] });
      }
      return new Response(
        '<li class="b_algo"><h2><a href="https://b.com">B</a></h2></li>',
        { status: 200 },
      );
    });

    const outcome = await webSearch('问题');
    expect(outcome?.source).toBe('bing');
  });

  it('全链路失败返回 null（不抛错）', async () => {
    // 用 400（不可重试）避免触发 Search 退避等待，专注验证降级收敛
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('err', { status: 400 }),
    );

    await expect(webSearch('问题')).resolves.toBeNull();
  });

  it('问题过短时直接返回 null，不发请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(webSearch('a')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('结果消费', () => {
  it('formatSearchContext 优先使用 summary', () => {
    const ctx = formatSearchContext('问题', {
      source: 'deepseek',
      results: [
        {
          title: 'T',
          url: 'https://a.com',
          snippet: '短文本',
          summary: '长文本摘要',
          source: 'DeepSeek',
        },
      ],
    });
    expect(ctx).toContain('长文本摘要');
    expect(ctx).not.toContain('短文本');
  });

  it('toSourceItems 优先使用 siteName', () => {
    const items = toSourceItems({
      source: 'deepseek',
      results: [
        {
          title: 'T',
          url: 'https://www.a.com/x',
          snippet: 's',
          siteName: 'A站点',
          source: 'DeepSeek',
        },
      ],
    });
    expect(items[0].site).toBe('A站点');
  });
});
