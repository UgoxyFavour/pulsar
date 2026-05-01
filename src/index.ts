#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { config } from './config.js';
import { fetchContractSpec, fetchContractSpecSchema } from './tools/fetch_contract_spec.js';
import { submitTransaction } from './tools/submit_transaction.js';
import { simulateTransaction } from './tools/simulate_transaction.js';
import { getAccountBalance } from './tools/get_account_balance.js';
import { sorobanMath } from './tools/soroban_math.js';

// ✅ merged imports (FIXED)
import { decodeLedgerEntryTool, decodeLedgerEntrySchema } from './tools/decode_ledger_entry.js';
import { computeVestingSchedule } from './tools/compute_vesting_schedule.js';
import { deployContract } from './tools/deploy_contract.js';

import {
  GetAccountBalanceInputSchema,
  SubmitTransactionInputSchema,
  SimulateTransactionInputSchema,
  SorobanMathInputSchema,
  ComputeVestingScheduleInputSchema,
  DeployContractInputSchema,
} from './schemas/tools.js';

import logger from './logger.js';
import { PulsarError, PulsarNetworkError, PulsarValidationError } from './errors.js';

class PulsarServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'pulsar',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
      { name: 'pulsar', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
    this.handleErrors();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_account_balance',
          description:
            'Get the current XLM and issued asset balances for a Stellar account. Optionally filter by asset code and/or issuer.',
          description: 'Get balances for a Stellar account.',
          inputSchema: {
            type: 'object',
            properties: {
              account_id: { type: 'string' },
            },
            required: ['account_id'],
          },
        },
        {
          name: 'decode_ledger_entry',
          description: 'Decode LedgerEntry XDR to JSON.',
          inputSchema: {
            type: 'object',
            properties: {
              xdr: { type: 'string' },
            },
            required: ['xdr'],
          },
        },
        {
          name: 'submit_transaction',
          description: 'Submit a signed transaction.',
          inputSchema: {
            type: 'object',
            properties: {
              xdr: { type: 'string' },
            },
            required: ['xdr'],
          },
        },
        {
          name: 'fetch_contract_spec',
          description:
            'Fetch the ABI/interface spec of a deployed Soroban contract. Returns decoded function signatures, parameter types, and emitted event schemas.',
          inputSchema: {
            type: 'object',
            properties: {
              contract_id: {
                type: 'string',
                description: 'The Soroban contract address (C...)',
              },
              network: {
                type: 'string',
                enum: ['mainnet', 'testnet', 'futurenet', 'custom'],
                description: 'Override the active network for this call.',
              },
          description: 'Fetch contract ABI/spec.',
          inputSchema: {
            type: 'object',
            properties: {
              contract_id: { type: 'string' },
            },
            required: ['contract_id'],
          },
        },
        {
          name: 'simulate_transaction',
          description:
            'Simulates a transaction on the Soroban RPC and returns results, footprint, fees, and events.',
          description: 'Simulate transaction.',
          inputSchema: {
            type: 'object',
            properties: {
              xdr: { type: 'string' },
            },
            required: ['xdr'],
          },
        },
        {
          name: 'soroban_math',
          description:
            'Perform financial math on Soroban fixed-point integers (scaled by 10^decimals, default 7). ' +
            'Operations: fixed_add, fixed_sub, fixed_mul, fixed_div (fixed-point arithmetic); ' +
            'mean, weighted_mean, std_dev (statistics); twap (time-weighted average price); ' +
            'compound_interest (compound growth using basis-point rate); ' +
            'basis_points_to_percent, percent_to_basis_points (unit conversions). ' +
            'All integer arguments are passed as decimal strings to preserve BigInt precision.',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                enum: [
                  'fixed_add',
                  'fixed_sub',
                  'fixed_mul',
                  'fixed_div',
                  'mean',
                  'weighted_mean',
                  'std_dev',
                  'twap',
                  'compound_interest',
                  'basis_points_to_percent',
                  'percent_to_basis_points',
                ],
                description: 'The math operation to perform.',
              },
              a: { type: 'string', description: 'First operand (fixed-point ops).' },
              b: { type: 'string', description: 'Second operand (fixed-point ops).' },
              decimals: {
                type: 'number',
                description: 'Decimal places in the fixed-point scale (default 7).',
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Array of fixed-point values as strings (mean, weighted_mean, std_dev).',
              },
              weights: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of weights as strings (weighted_mean).',
              },
              prices: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    price: { type: 'string' },
                    timestamp: { type: 'number' },
                  },
                  required: ['price', 'timestamp'],
                },
                description: 'Array of {price, timestamp} entries for TWAP.',
              },
              principal: {
                type: 'string',
                description: 'Principal amount as fixed-point string (compound_interest).',
              },
              rate_bps: {
                type: 'number',
                description: 'Annual rate in basis points, e.g. 500 = 5% (compound_interest).',
              },
              periods: { type: 'number', description: 'Number of periods (compound_interest).' },
              compounds_per_period: {
                type: 'number',
                description: 'Compounding frequency per period, default 1 (compound_interest).',
              },
              value: { type: 'number', description: 'Numeric value for basis-point conversion.' },
            },
            required: ['operation'],
          name: 'compute_vesting_schedule',
          description: 'Calculate vesting schedule.',
          inputSchema: {
            type: 'object',
            properties: {
              total_amount: { type: 'number' },
              start_timestamp: { type: 'number' },
              cliff_seconds: { type: 'number' },
              vesting_duration_seconds: { type: 'number' },
              release_frequency_seconds: { type: 'number' },
              beneficiary_type: { type: 'string' },
            },
            required: [
              'total_amount',
              'start_timestamp',
              'cliff_seconds',
              'vesting_duration_seconds',
              'release_frequency_seconds',
              'beneficiary_type',
            ],
          },
        },
        {
          name: 'deploy_contract',
          description: 'Build deploy transaction.',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string' },
              source_account: { type: 'string' },
            },
            required: ['mode', 'source_account'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_account_balance': {
            const parsed = GetAccountBalanceInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(
                `Invalid input for get_account_balance`,
                parsed.error.format()
              );
            }
            const result = await getAccountBalance(parsed.data);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
            };
          }

          case 'fetch_contract_spec': {
            const parsed = fetchContractSpecSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(
                `Invalid input for fetch_contract_spec`,
                parsed.error.format()
              );
            }
            const result = await fetchContractSpec(parsed.data);
            const parsed = GetAccountBalanceInputSchema.parse(args);
            const result = await getAccountBalance(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'fetch_contract_spec': {
            const parsed = fetchContractSpecSchema.parse(args);
            const result = await fetchContractSpec(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'submit_transaction': {
            const parsed = SubmitTransactionInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(
                `Invalid input for submit_transaction`,
                parsed.error.format()
              );
            }
            const result = await submitTransaction(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
          }

          case 'simulate_transaction': {
            const parsed = SimulateTransactionInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(
                `Invalid input for simulate_transaction`,
                parsed.error.format()
              );
            }
            const result = await simulateTransaction(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
            const parsed = SubmitTransactionInputSchema.parse(args);
            const result = await submitTransaction(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'decode_ledger_entry': {
            const parsed = decodeLedgerEntrySchema.parse(args);
            const result = await decodeLedgerEntryTool(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'simulate_transaction': {
            const parsed = SimulateTransactionInputSchema.parse(args);
            const result = await simulateTransaction(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'soroban_math': {
            const parsed = SorobanMathInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(
                `Invalid input for soroban_math`,
                parsed.error.format()
              );
            }
            const result = await sorobanMath(parsed.data);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          case 'compute_vesting_schedule': {
            const parsed = ComputeVestingScheduleInputSchema.parse(args);
            const result = await computeVestingSchedule(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          case 'deploy_contract': {
            const parsed = DeployContractInputSchema.parse(args);
            const result = await deployContract(parsed);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
        }
      } catch (error) {
        logger.error(error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: String(error) }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private handleToolError(error: unknown, toolName: string) {
    let pulsarError: PulsarError;

    if (error instanceof PulsarError) {
      pulsarError = error;
    } else if (error instanceof McpError) {
      // Pass through MCP errors directly if they are already well-formed
      throw error;
    } else {
      // Convert unknown errors to PulsarNetworkError as per requirements
      pulsarError = new PulsarNetworkError(error instanceof Error ? error.message : String(error), {
        originalError: error,
      });
    }

    logger.error(
      {
        tool: toolName,
        errorCode: pulsarError.code,
        error: pulsarError.message,
        details: pulsarError.details,
      },
      `Error executing tool ${toolName}`
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            error_code: pulsarError.code,
            message: pulsarError.message,
            details: pulsarError.details,
          }),
        },
      ],
      isError: true,
    };
  }

  private handleErrors() {
    this.server.onerror = (error) => {
      logger.error({ error }, '[MCP Error]');
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info(`pulsar MCP server v1.0.0 is running on ${config.stellarNetwork}...`);
  }
}

const pulsar = new PulsarServer();
pulsar.run().catch((error) => {
  logger.fatal({ error }, '❌ Fatal error in pulsar server');
  process.exit(1);
});
    logger.info(`pulsar MCP server running on ${config.stellarNetwork}`);
  }
}

new PulsarServer().run();
