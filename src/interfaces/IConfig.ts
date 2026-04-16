import type { Network } from '@btc-vision/bitcoin';
import type { ReorgEvent } from '../reorg/ReorgHandler.js';

export interface ScannerConfig {
    readonly network: Network;
    readonly rpcUrl: string;
    readonly wsUrl: string;
    readonly contractAddress: string;

    readonly reorgBufferSize: number;
    readonly pollIntervalMs: number;
    readonly startBlock?: bigint;

    /**
     * Optional callback invoked when a chain reorganization is detected.
     * Use this to roll back database state, invalidate caches, etc.
     */
    readonly onReorg?: (reorg: ReorgEvent) => void;
}
