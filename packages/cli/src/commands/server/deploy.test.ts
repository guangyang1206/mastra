import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/api.js', () => ({
  fetchOrgs: vi.fn(),
}));

vi.mock('../auth/credentials.js', () => ({
  getToken: vi.fn(),
  getCurrentOrgId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../auth/client.js', () => ({
  MASTRA_STUDIO_URL: 'https://studio.example.com',
}));

import { fetchOrgs } from '../auth/api.js';
import { resolveOrg } from './deploy.js';

const mockFetchOrgs = vi.mocked(fetchOrgs);

describe('resolveOrg', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MASTRA_ORG_ID;
    delete process.env.MASTRA_API_TOKEN;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns MASTRA_ORG_ID from env without calling fetchOrgs', async () => {
    process.env.MASTRA_ORG_ID = 'env-org-123';

    const result = await resolveOrg('tok', null);

    expect(result).toEqual({ orgId: 'env-org-123', orgName: 'env-org-123' });
    expect(mockFetchOrgs).not.toHaveBeenCalled();
  });

  it('trusts projectConfig.organizationId when MASTRA_API_TOKEN is set (skips fetchOrgs)', async () => {
    process.env.MASTRA_API_TOKEN = 'api-token-abc';

    const result = await resolveOrg('tok', { organizationId: 'config-org-456' });

    expect(result).toEqual({ orgId: 'config-org-456', orgName: 'config-org-456' });
    expect(mockFetchOrgs).not.toHaveBeenCalled();
  });

  it('validates projectConfig.organizationId via fetchOrgs when no MASTRA_API_TOKEN', async () => {
    mockFetchOrgs.mockResolvedValue([{ id: 'config-org-456', name: 'My Org', role: 'admin', isCurrent: true }]);

    const result = await resolveOrg('tok', { organizationId: 'config-org-456' });

    expect(result).toEqual({ orgId: 'config-org-456', orgName: 'My Org' });
    expect(mockFetchOrgs).toHaveBeenCalledWith('tok');
  });

  it('falls through when projectConfig org not found in fetchOrgs (no MASTRA_API_TOKEN)', async () => {
    mockFetchOrgs.mockResolvedValue([{ id: 'other-org', name: 'Other', role: 'admin', isCurrent: true }]);

    // Should fall through to the single-org auto-select path
    const result = await resolveOrg('tok', { organizationId: 'missing-org' });

    expect(result).toEqual({ orgId: 'other-org', orgName: 'Other' });
  });

  it('uses flagOrg and validates via fetchOrgs', async () => {
    mockFetchOrgs.mockResolvedValue([{ id: 'flag-org', name: 'Flag Org', role: 'member', isCurrent: false }]);

    const result = await resolveOrg('tok', null, 'flag-org');

    expect(result).toEqual({ orgId: 'flag-org', orgName: 'Flag Org' });
    expect(mockFetchOrgs).toHaveBeenCalledWith('tok');
  });
});
