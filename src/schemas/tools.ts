/**
 * Per-tool input schemas.
 *
 * Each tool gets a dedicated schema export that combines base validators
 * and tool-specific constraints. These schemas are used to validate inputs
 * before any RPC calls are made.
 */

import { z } from "zod";

import {
  StellarPublicKeySchema,
  ContractIdSchema,
  XdrBase64Schema,
  NetworkSchema,
} from "./index.js";

/**
 * Schema for get_account_balance tool
 *
 * Inputs:
 * - account_id: Stellar public key (required)
 * - network: Optional network override
 */
export const GetAccountBalanceInputSchema = z.object({
  account_id: StellarPublicKeySchema,
  network: NetworkSchema.optional(),
  asset_code: z.string().optional(),
  asset_issuer: StellarPublicKeySchema.optional(),
});

export type GetAccountBalanceInput = z.infer<
  typeof GetAccountBalanceInputSchema
>;

/**
 * Schema for submit_transaction tool
 *
 * Inputs:
 * - xdr: Transaction envelope XDR (required, validated as base64)
 * - network: Optional network override
 * - sign: Whether to sign before submitting (default: false)
 * - wait_for_result: Whether to poll for result (default: false)
 * - wait_timeout_ms: Polling timeout in milliseconds (1000 - 120000, default: 30000)
 */
export const SubmitTransactionInputSchema = z.object({
  xdr: XdrBase64Schema,
  network: NetworkSchema.optional(),
  sign: z.boolean().default(false),
  wait_for_result: z.boolean().default(false),
  wait_timeout_ms: z
    .number()
    .int()
    .min(1000, { message: "wait_timeout_ms must be at least 1000 ms" })
    .max(120_000, { message: "wait_timeout_ms must not exceed 120000 ms" })
    .default(30_000),
});

export type SubmitTransactionInput = z.infer<
  typeof SubmitTransactionInputSchema
>;

/**
 * Schema for potential future contract_read tool.
 * Validates a contract ID, method name, and optional JSON parameters.
 */
export const ContractReadInputSchema = z.object({
  contract_id: ContractIdSchema,
  method: z
    .string()
    .min(1, { message: "Method name cannot be empty" })
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
      message: "Method name must be a valid identifier",
    }),
  args: z.record(z.unknown()).optional(),
});

export type ContractReadInput = z.infer<typeof ContractReadInputSchema>;

/**
 * Schema for simulate_transaction tool
 *
 * Inputs:
 * - xdr: Transaction envelope XDR (required, non-empty base64)
 * - network: Optional network override
 */
export const SimulateTransactionInputSchema = z.object({
  xdr: XdrBase64Schema,
  network: NetworkSchema.optional(),
});

export type SimulateTransactionInput = z.infer<
  typeof SimulateTransactionInputSchema
>;

/**
 * Schema for emergency_pause tool (circuit breaker)
 *
 * Inputs:
 * - contract_id: Soroban contract address (required)
 * - network: Optional network override
 * - action: inspect | pause | unpause (default: inspect)
 * - admin_address: Optional admin address for invocation args
 */
export const EmergencyPauseInputSchema = z.object({
  contract_id: ContractIdSchema,
  network: NetworkSchema.optional(),
  action: z.enum(["inspect", "pause", "unpause"]).default("inspect"),
  admin_address: z.string().optional(),
});

export type EmergencyPauseInput = z.infer<typeof EmergencyPauseInputSchema>;

/**
 * Schema for generate_contract_docs tool
 *
 * Inputs:
 * - contract_id: Soroban contract address (required)
 * - network: Optional network override
 * - format: markdown | text (default: markdown)
 * - include_events: Whether to include events (default: true)
 */
export const GenerateContractDocsInputSchema = z.object({
  contract_id: ContractIdSchema,
  network: NetworkSchema.optional(),
  format: z.enum(["markdown", "text"]).default("markdown"),
  include_events: z.boolean().default(true),
});

export type GenerateContractDocsInput = z.infer<typeof GenerateContractDocsInputSchema>;

