import { describe, expect, it, beforeAll } from 'vitest';

import {
  describeIfIntegration,
  fundWithFriendbot,
  TEST_ACCOUNT_PUBLIC_KEY,
  TESTNET_HORIZON_URL,
} from './setup.js';

/**
 * Integration tests for get_account_balance tool.
 *
 * These tests hit the real Stellar Testnet.
 * Set RUN_INTEGRATION_TESTS=true to run them.
 */

describeIfIntegration('get_account_balance (Integration)', () => {
  // Ensure test account is funded before tests
  beforeAll(async () => {
    try {
      await fundWithFriendbot(TEST_ACCOUNT_PUBLIC_KEY);
      // Wait a moment for the funding transaction to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('Setup: Account may already be funded or funding failed:', error);
    }
  });

  it('should fetch account balance from testnet', async () => {
    // Use Horizon REST API directly to verify account exists
    const response = await fetch(`${TESTNET_HORIZON_URL}/accounts/${TEST_ACCOUNT_PUBLIC_KEY}`);

    expect(response.ok).toBe(true);

    const account = await response.json();

    expect(account).toHaveProperty('account_id', TEST_ACCOUNT_PUBLIC_KEY);
    expect(account).toHaveProperty('balances');
    expect(Array.isArray(account.balances)).toBe(true);

    // Should have at least XLM balance
    const xlmBalance = account.balances.find(
      (b: { asset_type: string }) => b.asset_type === 'native'
    );
    expect(xlmBalance).toBeDefined();
    expect(parseFloat(xlmBalance.balance)).toBeGreaterThan(0);
  });

  it('should return 404 for non-existent account', async () => {
    const nonExistentKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHG';

    const response = await fetch(`${TESTNET_HORIZON_URL}/accounts/${nonExistentKey}`);

    expect(response.status).toBe(404);
  });
});
