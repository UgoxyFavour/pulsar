#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { config } from "./config.js";
import { fetchContractSpec, fetchContractSpecSchema } from "./tools/fetch_contract_spec.js";
import { submitTransaction } from './tools/submit_transaction.js';
import { simulateTransaction } from './tools/simulate_transaction.js';
import { getAccountBalance } from './tools/get_account_balance.js';
import { emergencyPause } from './tools/emergency_pause.js';
import { generateContractDocs } from './tools/generate_contract_docs.js';
import {
  GetAccountBalanceInputSchema,
  SubmitTransactionInputSchema,
  SimulateTransactionInputSchema,
  EmergencyPauseInputSchema,
  GenerateContractDocsInputSchema,
} from './schemas/tools.js';
import logger from './logger.js';
import { PulsarError, PulsarNetworkError, PulsarValidationError } from './errors.js';

/**
 * Initialize the pulsar MCP server.
 * Communicates with AI assistants via stdio (stdin/stdout).
 * Every tool input/output is validated with Zod.
 */
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
      },
    );

    this.setupHandlers();
    this.handleErrors();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_account_balance',
          description: 'Get the current XLM and issued asset balances for a Stellar account. Optionally filter by asset code and/or issuer.',
          inputSchema: {
            type: 'object',
            properties: {
              account_id: {
                type: 'string',
                description: 'The Stellar public key (G...)',
              },
              asset_code: {
                type: 'string',
                description: 'Optional: Filter by asset code (e.g. USDC)',
              },
              asset_issuer: {
                type: 'string',
                description: 'Optional: Filter by asset issuer (G...)',
              },
              network: {
                type: 'string',
                enum: ['mainnet', 'testnet', 'futurenet', 'custom'],
                description: 'Override the configured network for this call.',
              },
            },
            required: ['account_id'],
          },
        },
        {
          name: 'submit_transaction',
          description:
            '⚠️ IRREVERSIBLE. Always simulate first.\n\n' +
            'Submits a signed transaction envelope (XDR) to the Stellar network via Horizon. ' +
            'Optionally signs the transaction in-process using the configured STELLAR_SECRET_KEY ' +
            '(the key is never logged or passed as a CLI argument). ' +
            'Optionally waits up to 30 s for a SUCCESS or FAILED result from the Soroban RPC.',
          inputSchema: {
            type: 'object',
            properties: {
              xdr: {
                type: 'string',
                description: 'Base64-encoded XDR of the transaction envelope.',
              },
              network: {
                type: 'string',
                enum: ['mainnet', 'testnet', 'futurenet', 'custom'],
                description: 'Override the configured network for this call.',
              },
              sign: {
                type: 'boolean',
                default: false,
                description:
                  'Sign the transaction in-process before submitting. Requires STELLAR_SECRET_KEY to be configured.',
              },
              wait_for_result: {
                type: 'boolean',
                default: false,
                description: 'Poll until SUCCESS or FAILED (max 30 s).',
              },
              wait_timeout_ms: {
                type: 'number',
                default: 30000,
                description: 'Polling timeout in milliseconds (1 000 – 120 000).',
              },
            },
            required: ['xdr'],
          },
        },
        {
          name: "fetch_contract_spec",
          description:
            "Fetch the ABI/interface spec of a deployed Soroban contract. Returns decoded function signatures, parameter types, and emitted event schemas.",
          inputSchema: {
            type: "object",
            properties: {
              contract_id: {
                type: "string",
                description: "The Soroban contract address (C...)",
              },
              network: {
                type: "string",
                enum: ["mainnet", "testnet", "futurenet", "custom"],
                description: "Override the active network for this call.",
              },
            },
            required: ["contract_id"],
          },
        },
        {
          name: 'simulate_transaction',
          description: 'Simulates a transaction on the Soroban RPC and returns results, footprint, fees, and events.',
          inputSchema: {
            type: 'object',
            properties: {
              xdr: {
                type: 'string',
                description: 'Base64-encoded XDR of the transaction envelope.',
              },
              network: {
                type: 'string',
                enum: ['mainnet', 'testnet', 'futurenet', 'custom'],
                description: 'Override the configured network for this call.',
              },
            },
            required: ['xdr'],
          },
        },
        {
          name: 'emergency_pause',
          description:
            'Circuit breaker: inspect a Soroban contract for pause/unpause capability and generate the recommended invocation. ' +
            'Use action=inspect to check support, action=pause/unpause to get the invocation args. ' +
            'Does NOT submit transactions — use submit_transaction to execute.',
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
                description: 'Override the configured network for this call.',
              },
              action: {
                type: 'string',
                enum: ['inspect', 'pause', 'unpause'],
                default: 'inspect',
                description: 'inspect: report pause capability; pause/unpause: return recommended invocation args.',
              },
              admin_address: {
                type: 'string',
                description: 'Optional admin/owner address to include in the recommended invocation.',
              },
            },
            required: ['contract_id'],
          },
        },
        {
          name: 'generate_contract_docs',
          description:
            'Generate human-readable documentation for a Soroban contract. ' +
            'Extracts function signatures, doc-comments, parameter types, and emitted event schemas from the contract ABI.',
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
                description: 'Override the configured network for this call.',
              },
              format: {
                type: 'string',
                enum: ['markdown', 'text'],
                default: 'markdown',
                description: 'Output format: markdown (default) or plain text.',
              },
              include_events: {
                type: 'boolean',
                default: true,
                description: 'Include emitted event schemas in the output.',
              },
            },
            required: ['contract_id'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        logger.debug({ tool: name, arguments: args }, `Executing tool: ${name}`);

        switch (name) {
          case 'get_account_balance': {
            const parsed = GetAccountBalanceInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(`Invalid input for get_account_balance`, parsed.error.format());
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
              throw new PulsarValidationError(`Invalid input for fetch_contract_spec`, parsed.error.format());
            }
            const result = await fetchContractSpec(parsed.data);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          }

          case 'submit_transaction': {
            const parsed = SubmitTransactionInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(`Invalid input for submit_transaction`, parsed.error.format());
            }
            const result = await submitTransaction(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
          }

          case 'simulate_transaction': {
            const parsed = SimulateTransactionInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(`Invalid input for simulate_transaction`, parsed.error.format());
            }
            const result = await simulateTransaction(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
          }

          case 'emergency_pause': {
            const parsed = EmergencyPauseInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(`Invalid input for emergency_pause`, parsed.error.format());
            }
            const result = await emergencyPause(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
          }

          case 'generate_contract_docs': {
            const parsed = GenerateContractDocsInputSchema.safeParse(args);
            if (!parsed.success) {
              throw new PulsarValidationError(`Invalid input for generate_contract_docs`, parsed.error.format());
            }
            const result = await generateContractDocs(parsed.data);
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
        }
      } catch (error) {
        return this.handleToolError(error, name);
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
      pulsarError = new PulsarNetworkError(
        error instanceof Error ? error.message : String(error),
        { originalError: error }
      );
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
    logger.info(
      `pulsar MCP server v1.0.0 is running on ${config.stellarNetwork}...`,
    );
  }
}

const pulsar = new PulsarServer();
pulsar.run().catch((error) => {
  logger.fatal({ error }, '❌ Fatal error in pulsar server');
  process.exit(1);
});

