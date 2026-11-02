import type { InternalAxiosRequestConfig } from 'axios';
import { expect, it } from 'vitest';
import apiClient from './client';
import { goalsApi } from './goals.api';
import { portfolioHistoryApi } from './portfolio-history.api';

it('gives goal insights as long as the portfolio history, since both wait for the same rebuild', async () => {
  const sent: InternalAxiosRequestConfig[] = [];
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    return { config, data: {}, status: 200, statusText: 'OK', headers: {} };
  };

  await portfolioHistoryApi.get('1Y', 'USD');
  await goalsApi.insights('7d3c3a3e-0d5c-4bb4-9a7e-0f3f4b6a1c2d');

  const [history, insights] = sent;
  expect(history.timeout).toBeGreaterThan(apiClient.defaults.timeout ?? 0);
  expect(insights.url).toBe('/goals/7d3c3a3e-0d5c-4bb4-9a7e-0f3f4b6a1c2d/insights');
  expect(insights.timeout).toBe(history.timeout);
});
