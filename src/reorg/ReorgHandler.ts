import { Block } from 'opnet';

export interface ReorgEvent {
    readonly fromHeight: bigint;
    readonly toHeight: bigint;
}

/**
 * Detects chain reorganizations by tracking a rolling buffer of block hashes
 * and comparing each new block's `previousBlockHash` against the stored hash.
 */
export class ReorgDetector {
    readonly #blockHashes: Map<bigint, string> = new Map();
    readonly #bufferSize: number;

    public constructor(bufferSize: number) {
        this.#bufferSize = bufferSize;
    }

    /**
     * Records a block hash at a given height.
     *
     * @param height - The block height.
     * @param hash - The block hash at that height.
     */
    public record(height: bigint, hash: string): void {
        this.#blockHashes.set(height, hash);
        this.#prune(height);
    }

    /**
     * Checks whether a block's `previousBlockHash` matches the hash stored
     * for the preceding height. Returns `true` if a reorg is detected.
     *
     * @param block - The block to check against the stored chain.
     * @returns `true` if the previous block hash does not match, indicating a reorg.
     */
    public isReorged(block: Block): boolean {
        const expectedPrevHash = this.#blockHashes.get(BigInt(block.height) - 1n);
        if (expectedPrevHash === undefined) {
            return false;
        }

        return block.previousBlockHash !== expectedPrevHash;
    }

    /**
     * Returns the stored hash for a given height, or `undefined` if not buffered.
     *
     * @param height - The block height to look up.
     * @returns The stored block hash, or `undefined`.
     */
    public getHash(height: bigint): string | undefined {
        return this.#blockHashes.get(height);
    }

    /**
     * Removes the stored hash at a given height (used during reorg rollback).
     *
     * @param height - The block height to evict.
     */
    public evict(height: bigint): void {
        this.#blockHashes.delete(height);
    }

    /**
     * Clears all stored hashes up to and including a given height
     * (used when reindexing from a lower block).
     *
     * @param fromHeight - Evict all entries at or above this height.
     */
    public evictFrom(fromHeight: bigint): void {
        for (const [h] of this.#blockHashes) {
            if (h >= fromHeight) {
                this.#blockHashes.delete(h);
            }
        }
    }

    #prune(currentHeight: bigint): void {
        const threshold = currentHeight - BigInt(this.#bufferSize);
        for (const [h] of this.#blockHashes) {
            if (h < threshold) {
                this.#blockHashes.delete(h);
            }
        }
    }
}
