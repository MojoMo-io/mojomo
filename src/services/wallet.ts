// Sprint 11.4 — the MOJO hot wallet.
//
// MOJO is on Polygon today. The chain is configuration, not code: switching to
// Ethereum is an env change, not a code change. Nothing here hardcodes a chain
// id, an RPC URL or a token address.
//
// This wallet holds a float that payouts draw from. Two rules, both deliberate:
//
//   1. It is a *hot* wallet. It holds only what payouts need, never treasury.
//   2. It refuses to send while the project is in MVP. Ledger-only until
//      go-live; the wallet stages, it does not settle.
//
// The private key is read from env and never logged, never returned, never
// written to the database.
//
// MVP = Minimum Viable Product. MOJO_STAGE=mvp means pre-launch: the economy runs
// entirely on the ledger and nothing moves on-chain. MOJO_STAGE=live enables
// settlement. Any value other than 'live' is treated as MVP.

import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, isAddress } from 'ethers';
import * as db from './db';

export interface ChainConfig {
  name: 'polygon' | 'ethereum';
  chainId: number;
  rpcUrl: string;
  tokenAddress: string;
  explorer: string;
  decimals: number;
}

const CHAINS: Record<string, ChainConfig> = {
  polygon: {
    name: 'polygon',
    chainId: 137,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    tokenAddress: process.env.MOJO_TOKEN_POLYGON || '',
    explorer: 'https://polygonscan.com',
    decimals: 18,
  },
  ethereum: {
    name: 'ethereum',
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    tokenAddress: process.env.MOJO_TOKEN_ETHEREUM || '',
    explorer: 'https://etherscan.io',
    decimals: 18,
  },
};

/** The active chain. MOJO_CHAIN=polygon|ethereum. Defaults to polygon. */
export function activeChain(): ChainConfig {
  const name = (process.env.MOJO_CHAIN || 'polygon').toLowerCase();
  const c = CHAINS[name];
  if (!c) throw new Error(`Unknown MOJO_CHAIN: ${name}`);
  return c;
}

/** True while the project is pre-launch. Payouts are ledger-only. */
export function isLedgerOnly(): boolean {
  return (process.env.MOJO_STAGE || 'mvp').toLowerCase() !== 'live';
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

function provider(c: ChainConfig): JsonRpcProvider {
  return new JsonRpcProvider(c.rpcUrl, c.chainId);
}

function signer(c: ChainConfig): Wallet {
  const pk = process.env.MOJO_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('MOJO_WALLET_PRIVATE_KEY is not set');
  return new Wallet(pk, provider(c));
}

/** The wallet address we control, without touching the key. */
export function walletAddress(): string {
  const pk = process.env.MOJO_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('MOJO_WALLET_PRIVATE_KEY is not set');
  return new Wallet(pk).address;
}

/** On-chain MOJO balance of the hot wallet. */
export async function onChainBalance(): Promise<{ chain: string; address: string; balance: string }> {
  const c = activeChain();
  if (!c.tokenAddress) throw new Error(`No MOJO token address configured for ${c.name}`);
  const w = signer(c);
  const token = new Contract(c.tokenAddress, ERC20_ABI, provider(c));
  const raw = await token.balanceOf(w.address);
  return { chain: c.name, address: w.address, balance: formatUnits(raw, c.decimals) };
}

/**
 * Send MOJO. Refuses while ledger-only, refuses an invalid address, refuses
 * more than the float holds.
 */
export async function sendMojo(to: string, amount: string): Promise<{ txHash: string; chain: string }> {
  if (isLedgerOnly()) {
    throw new Error('Ledger-only: project is in MVP. On-chain settlement is disabled until go-live.');
  }
  if (!isAddress(to)) throw new Error('Invalid recipient address');
  const c = activeChain();
  if (!c.tokenAddress) throw new Error(`No MOJO token address configured for ${c.name}`);

  const w = signer(c);
  const token = new Contract(c.tokenAddress, ERC20_ABI, w);
  const raw = parseUnits(amount, c.decimals);

  const bal = await token.balanceOf(w.address);
  if (bal < raw) throw new Error(`Insufficient float: have ${formatUnits(bal, c.decimals)}, need ${amount}`);

  const tx = await token.transfer(to, raw);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, chain: c.name };
}

/** Record the float in the database so payouts can draw against it. */
export async function syncFloat(): Promise<any> {
  const c = activeChain();
  const { address, balance } = await onChainBalance();
  const r = await db.query(
    `INSERT INTO mojomo.payout_float (chain, token_symbol, wallet_address, balance, is_test_float)
     VALUES ($1,'MOJO',$2,$3,$4)
     ON CONFLICT (chain, wallet_address)
     DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()
     RETURNING *`,
    [c.name, address, balance, (process.env.MOJO_TEST_FLOAT || 'true') === 'true']
  );
  return r.rows[0];
}
