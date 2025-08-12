import { PrismaClient } from '@prisma/client';

let prismaSingleton: PrismaClient | undefined;

export const prisma = (() => {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
})();