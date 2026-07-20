import type { Prisma, PrismaClient } from "../../db/generated/client";

/**
 * Accepted by every Prisma*Repository constructor so the same class works
 * both as the app's default singleton (server/db/client.ts) and bound to one
 * leg of an interactive transaction (see ./prisma-transaction-runner.ts) —
 * Prisma.TransactionClient is PrismaClient minus the connection-management
 * methods ($transaction itself, $connect, $disconnect, ...), which a
 * repository never calls anyway.
 */
export type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;
