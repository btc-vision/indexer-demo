import {
    type Block,
    getContract,
    type IOP20Contract,
    JSONRpcProvider,
    OP_20_ABI,
    OPNetEvent,
    type TransferredEvent,
} from 'opnet';
import { ReorgDetector, type ReorgEvent } from '../reorg/ReorgHandler.js';
import { BlockParser, type ParsedOP20TransferTransaction } from '../block-processor/BlockParser.js';
import type { ScannerConfig } from '../interfaces/IConfig.js';
import { Logger } from '@btc-vision/logger';
import { ConnectionManager } from '../io/ConnectionManager.js';

/**
 * @example
 * ```typescript
 * const scanner = new BlockScanner(config);
 * await scanner.start();
 * // later:
 * await scanner.reindexFrom(14000n);
 * // shutdown:
 * await scanner.stop();
 * ```
 */
export class BlockScanner extends Logger {
    public override readonly logColor: string = '#8b39e3';

    readonly #httpProvider: JSONRpcProvider;
    readonly #reorgDetector: ReorgDetector;
    readonly #blockParser: BlockParser;
    readonly #connectionManager: ConnectionManager;
    readonly #config: ScannerConfig;

    #lastProcessedHeight: bigint = 0n;
    #running: boolean = false;

    readonly #contractAddress: string;

    public constructor(config: ScannerConfig) {
        super();

        this.#config = config;

        this.#httpProvider = new JSONRpcProvider({
            url: config.rpcUrl,
            network: config.network,
        });

        const contract = getContract<IOP20Contract>(
            config.contractAddress,
            OP_20_ABI,
            this.#httpProvider,
            config.network,
        );

        this.#contractAddress = config.contractAddress;

        this.#reorgDetector = new ReorgDetector(config.reorgBufferSize);
        this.#blockParser = new BlockParser(contract);
        this.#connectionManager = new ConnectionManager(
            this.#httpProvider,
            config.wsUrl,
            config.network,
            config.pollIntervalMs,
            (height: bigint) => this.#onNewBlock(height),
        );
    }

    /**
     * Starts the scanner. Catches up from `startBlock` (or chain tip) to the
     * current height, then subscribes to live blocks.
     */
    public async start(): Promise<void> {
        this.#running = true;

        if (this.#config.startBlock !== undefined) {
            this.#lastProcessedHeight = this.#config.startBlock - 1n;
        } else {
            const tip = await this.#httpProvider.getBlockNumber();
            this.#lastProcessedHeight = tip - 1n;
        }

        this.log(`Scanner starting from block ${this.#lastProcessedHeight + 1n}`);

        const tip = await this.#httpProvider.getBlockNumber();
        if (tip > this.#lastProcessedHeight) {
            this.log(`Catching up: blocks ${this.#lastProcessedHeight + 1n} to ${tip}`);

            await this.#processBlockRange(this.#lastProcessedHeight + 1n, tip);

            this.log(`Catch-up complete, now at block ${this.#lastProcessedHeight}`);
        }

        await this.#connectionManager.connect();
    }

    /**
     * Stops the scanner, disconnects all providers, and releases resources.
     */
    public async stop(): Promise<void> {
        this.#running = false;

        await this.#connectionManager.disconnect();
        await this.#httpProvider.close();

        this.log('Scanner stopped');
    }

    /**
     * Re-scans from a given block height. Clears stored hashes at and above
     * that height, resets the cursor, and re-processes the range up to the
     * current chain tip. Useful for manual corrections or forced reindexing.
     *
     * @param height - The block height to start reindexing from.
     */
    public async reindexFrom(height: bigint): Promise<void> {
        this.log(`Reindexing from block ${height}`);
        this.#reorgDetector.evictFrom(height);
        this.#lastProcessedHeight = height - 1n;

        const tip = await this.#httpProvider.getBlockNumber();
        await this.#processBlockRange(height, tip);
        this.log(`Reindex complete, now at block ${this.#lastProcessedHeight}`);
    }

    async #onNewBlock(height: bigint): Promise<void> {
        if (!this.#running) return;

        try {
            await this.#processBlockRange(this.#lastProcessedHeight + 1n, height);
        } catch (err: unknown) {
            this.error('Block processing error:', (err as Error).message);
        }
    }

    async #processBlockRange(from: bigint, to: bigint): Promise<void> {
        for (let h = from; h <= to; h++) {
            if (!this.#running) return;

            const block = await this.#httpProvider.getBlock(h, true);
            if (this.#reorgDetector.isReorged(block)) {
                await this.#handleReorg(h);
                return;
            }

            this.#reorgDetector.record(h, block.hash);

            await this.#processBlock(block);

            this.#lastProcessedHeight = h;
        }
    }

    async #processBlock(block: Block): Promise<void> {
        const interactions = this.#blockParser.parse(block);
        const op20Transfers = this.#blockParser.parseOP20Transfers(interactions);

        // Filter transactions that are not op20 transfer
        if (op20Transfers.length) {
            await this.#processOP20Transfers(op20Transfers);
        }

        this.log(
            `Processed block ${block.height} (${interactions.length} opnet txs) at ${block.hash} (${block.checksumRoot}), decoded ${op20Transfers.length} op20 transfer`,
        );
    }

    async #processOP20Transfers(transactions: ParsedOP20TransferTransaction[]): Promise<void> {
        await Promise.resolve();

        for (const tx of transactions) {
            this.info(
                `Found an op20 transfer in ${tx.transaction.id}, ${tx.events.length} transfers`,
            );

            if (this.#contractAddress && tx.transaction.contractAddress !== this.#contractAddress) {
                this.warn(
                    `Found a transaction that does not make a transaction with the filtered contract address: ${tx.transaction.contractAddress}!`,
                );

                continue;
            }

            for (const event of tx.events) {
                const transferEvent: OPNetEvent<TransferredEvent> =
                    event as OPNetEvent<TransferredEvent>;

                const eventProperties = transferEvent.properties;

                this.debug(
                    `Transferred event, from: ${eventProperties.from}, to: ${eventProperties.to}, value: ${eventProperties.amount}, operator: ${eventProperties.operator}`,
                );
            }
        }
    }

    async #handleReorg(divergenceHeight: bigint): Promise<void> {
        if (!this.#running) return;

        let forkHeight = divergenceHeight - 1n;
        let bufferExhausted = false;

        while (forkHeight > 0n) {
            const storedHash = this.#reorgDetector.getHash(forkHeight);
            if (storedHash === undefined) {
                bufferExhausted = true;
                break;
            }

            const block = await this.#httpProvider.getBlock(forkHeight, false);
            if (block.hash === storedHash) break;

            this.#reorgDetector.evict(forkHeight);
            forkHeight--;
        }

        if (bufferExhausted) {
            this.warn(
                `Reorg depth exceeded buffer size (${this.#config.reorgBufferSize} blocks). ` +
                    `Fork point could not be determined precisely. ` +
                    `Reindexing from the oldest buffered height ${forkHeight + 1n}.`,
            );
        }

        const reorg: ReorgEvent = {
            fromHeight: forkHeight + 1n,
            toHeight: this.#lastProcessedHeight,
        };

        this.#emitReorg(reorg);

        this.#lastProcessedHeight = forkHeight;

        if (!this.#running) return;

        const currentHeight = await this.#httpProvider.getBlockNumber();
        await this.#processBlockRange(forkHeight + 1n, currentHeight);
    }

    #emitReorg(reorg: ReorgEvent): void {
        this.warn(
            `Blocks ${reorg.fromHeight} to ${reorg.toHeight} invalidated. ` +
                `Roll back any state derived from these blocks.`,
        );

        if (this.#config.onReorg) {
            this.#config.onReorg(reorg);
        }
    }
}
