import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const countries = [
    { code: 'USA', name: 'USA' },
    { code: 'CHN', name: 'China' },
    { code: 'DEU', name: 'Germany' },
    { code: 'JPN', name: 'Japan' },
    { code: 'IND', name: 'India' },
  ];

  const products = [
    { code: 'STEEL', name: 'Steel' },
    { code: 'GRAIN', name: 'Grain' },
    { code: 'OIL', name: 'Oil' },
    { code: 'ELEC', name: 'Electronics' },
    { code: 'TEXT', name: 'Textiles' },
  ];

  for (const c of countries) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: c,
      update: {},
    });
  }

  for (const p of products) {
    await prisma.product.upsert({
      where: { code: p.code },
      create: p,
      update: {},
    });
  }

  await prisma.appUser.upsert({
    where: { username: 'pavan' },
    create: { username: 'pavan', role: 'operator' },
    update: { role: 'operator' },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });